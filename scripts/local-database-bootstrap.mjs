import { createHash } from 'node:crypto';
import console from 'node:console';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import {
  LocalDatabaseError,
  assertLocalCluster,
  localDatabaseBaseRoles,
  localDatabaseRoles,
  localDatabaseRoot,
  localDatabaseUrl,
  main,
} from './local-database.mjs';
import { runMigrations } from '../packages/database/src/migrate.mjs';
import { verifyDatabaseContract } from '../packages/database/src/verify.mjs';
import { validateConnectionTarget } from '../packages/database/src/connection-policy.mjs';
import {
  buildLegacySignalArchivePlan,
  applyLegacySignalArchive,
} from '../packages/database/src/legacy-signal-archive.mjs';
import { inspectUnifiedSignalMigration } from '../packages/database/src/unified-signal-preflight.mjs';
import {
  applyUnifiedSignalBackfill,
  verifyUnifiedSignalBackfill,
} from '../packages/database/src/unified-signal-backfill.mjs';
import { syncTopics } from '../packages/database/src/topic-sync.mjs';
import {
  prepareLocalBackendRoles,
  resumeLocalBackendReader,
  verifyLocalBackendRoles,
} from './local-database-backend.mjs';

const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { Client } = require('pg');
const database = 'hzense_local';
const owner = 'hzense_local_owner';
const stop = (message) => {
  throw new LocalDatabaseError(message);
};
const roleSql = (role) => {
  if (!localDatabaseRoles.includes(role)) stop('未知的本地数据库角色');
  return `"${role}"`;
};

export const localRuntimeGrants = `
GRANT CONNECT ON DATABASE hzense_local TO hzense_runtime;
GRANT USAGE ON SCHEMA public TO hzense_runtime;
GRANT USAGE ON TYPE public.topic_status TO hzense_runtime;
GRANT SELECT(id,title,parent_id,status,runtime_enabled) ON public.topics TO hzense_runtime;
GRANT SELECT(source_id,source_type,title,summary,href,keywords,body,document_date,
  normalized_title,normalized_summary,normalized_keywords,normalized_body)
  ON public.search_documents TO hzense_runtime;
GRANT INSERT(unified_content) ON public.editorial_signal_revisions TO hzense_editorial_writer;
GRANT SELECT(publication_basis),INSERT(publication_basis)
  ON public.editorial_signal_revisions TO hzense_editorial_writer;
GRANT SELECT(snapshot) ON public.signal_generation_runs TO hzense_editorial_writer;
GRANT SELECT(publication_basis) ON public.editorial_public_signals TO hzense_editorial_reader;
GRANT SELECT(signal_id,version,origin,publication_basis,content,recorded_at)
  ON public.unified_public_signals TO hzense_editorial_reader;
GRANT SELECT(ready) ON public.unified_public_status TO hzense_editorial_reader;
`;

export function localMigrationOptions(credentials) {
  return { connectionString: localDatabaseUrl(credentials), baselineChecksum: null };
}

async function connect(connectionString) {
  validateConnectionTarget({ connectionString, profile: 'local-test' });
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ssl: false,
    sslnegotiation: 'postgres',
    options: '-c search_path=pg_catalog,public',
    replication: 'false',
    application_name: 'hzense-local-development',
  });
  await client.connect();
  return client;
}

function marker(credentials) {
  return `HZense isolated local development v1 ${createHash('sha256').update(credentials.developmentPassword).digest('hex')}`;
}

async function assertDatabaseIdentity(admin, credentials) {
  await assertLocalCluster(admin);
  const ownerRole = (
    await admin.query(
      `SELECT rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls,rolconfig,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS membership
    FROM pg_roles r WHERE rolname=$1`,
      [owner],
    )
  ).rows[0];
  if (
    !ownerRole?.rolcanlogin ||
    ownerRole.rolsuper ||
    ownerRole.rolinherit ||
    ownerRole.rolcreatedb ||
    ownerRole.rolcreaterole ||
    ownerRole.rolreplication ||
    ownerRole.rolbypassrls ||
    ownerRole.rolconfig !== null ||
    ownerRole.membership
  )
    stop('本地迁移 owner 不满足受限角色要求；不会自动修正权限');
  const row = (
    await admin.query(
      `SELECT pg_get_userbyid(datdba) AS owner,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`,
      [database],
    )
  ).rows[0];
  if (!row || row.owner !== owner || row.marker !== marker(credentials))
    stop('数据库不属于本工作区的本地初始化；拒绝修改未知库');
}

async function createLocalDatabase(admin, credentials) {
  await assertLocalCluster(admin);
  const unknownRoles = (
    await admin.query(
      `SELECT rolname FROM pg_roles
    WHERE rolname <> 'postgres' AND rolname NOT LIKE 'pg\\_%' ESCAPE '\\'
      AND NOT (rolname=ANY($1::text[]))`,
      [localDatabaseRoles],
    )
  ).rows;
  if (unknownRoles.length) stop('本地集群含未知角色，拒绝修改共享集群');
  const ownerInfo = (await admin.query(`SELECT rolname FROM pg_roles WHERE rolname=$1`, [owner]))
    .rows[0];
  if (!ownerInfo) {
    await admin.query(
      `CREATE ROLE ${roleSql(owner)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.roles[owner]}'`,
    );
    await admin.query(`COMMENT ON ROLE ${roleSql(owner)} IS '${marker(credentials)}'`);
  } else {
    const existingMarker = (
      await admin.query(
        "SELECT shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",
        [owner],
      )
    ).rows[0]?.marker;
    if (existingMarker !== marker(credentials)) stop('已存在的数据库 owner 不属于本工作区');
  }
  const existing = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]))
    .rowCount;
  if (!existing) {
    await admin.query(`CREATE DATABASE hzense_local OWNER ${roleSql(owner)} TEMPLATE template0`);
    await admin.query(`COMMENT ON DATABASE hzense_local IS '${marker(credentials)}'`);
  }
  await assertDatabaseIdentity(admin, credentials);
  // This cluster is dedicated to this workspace and contains only known defaults.
  // Do not share it with tests or other applications.
  for (const name of ['postgres', 'template1', database])
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
  const target = new URL(localDatabaseUrl(credentials, 'postgres'));
  target.pathname = `/${database}`;
  const extensionAdmin = await connect(target.toString());
  try {
    await extensionAdmin.query('CREATE EXTENSION IF NOT EXISTS vector');
    const version = (
      await extensionAdmin.query("SELECT extversion FROM pg_extension WHERE extname='vector'")
    ).rows[0]?.extversion;
    if (version !== '0.8.6') stop('本地 pgvector 版本不匹配，未降级结构要求');
    await extensionAdmin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  } finally {
    await extensionAdmin.end();
  }
}

async function prepareServiceRoles(admin, client, credentials, root) {
  let editorialCreated = 0;
  for (const role of localDatabaseBaseRoles.filter((name) => name !== owner)) {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
    if (!exists) {
      await admin.query(
        `CREATE ROLE ${roleSql(role)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${role === 'hzense_runtime' ? 20 : 2} PASSWORD '${credentials.roles[role]}'`,
      );
      await admin.query(`COMMENT ON ROLE ${roleSql(role)} IS '${marker(credentials)}'`);
      if (role.startsWith('hzense_editorial_')) editorialCreated += 1;
    }
    const info = (
      await admin.query(
        `SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
      rolcanlogin,rolconnlimit,shobj_description(oid,'pg_authid') AS marker
      FROM pg_roles WHERE rolname=$1`,
        [role],
      )
    ).rows[0];
    if (
      info.marker !== marker(credentials) ||
      info.rolsuper ||
      info.rolcreatedb ||
      info.rolcreaterole ||
      info.rolreplication ||
      info.rolbypassrls ||
      info.rolinherit ||
      !info.rolcanlogin ||
      info.rolconnlimit !== (role === 'hzense_runtime' ? 20 : 2)
    )
      stop('已有本地服务角色属性不匹配；不会重置权限或密码');
  }
  await admin.query('ALTER ROLE hzense_runtime SET default_transaction_read_only=on');
  const editorialAcl = (
    await client.query(`SELECT
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','request_id','INSERT') AS writer,
    has_table_privilege('hzense_editorial_reader','public.editorial_public_signals','SELECT') AS reader`)
  ).rows[0];
  if (!editorialAcl.writer && !editorialAcl.reader) {
    await client.query(
      await readFile(resolve(root, 'db/roles/configure_editorial_roles.sql'), 'utf8'),
    );
  } else if (!editorialAcl.writer || !editorialAcl.reader || editorialCreated !== 0) {
    stop('本地发布角色存在不完整授权，已停止；不会放宽或覆盖未知授权');
  }
  await client.query(localRuntimeGrants);
}

async function assertMinimumRoles(client) {
  const valid = (
    await client.query(
      `SELECT
    has_column_privilege('hzense_runtime','public.topics','id','SELECT')
    AND NOT has_any_column_privilege('hzense_runtime','public.ai_connections','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_runtime','public.import_outputs','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_runtime','public.signals','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.signals','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.signal_versions','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.ai_connections','SELECT,INSERT,UPDATE')
    AND NOT has_any_column_privilege('hzense_editorial_writer','public.ai_connections','SELECT,INSERT,UPDATE')
    AND has_column_privilege('hzense_editorial_reader','public.unified_public_status','ready','SELECT')
    AND has_column_privilege('hzense_editorial_reader','public.unified_public_signals','content','SELECT')
    AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN
      (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))) AS valid`,
      [localDatabaseRoles.slice(1)],
    )
  ).rows[0]?.valid;
  if (valid !== true) stop('本地运行角色最小读取权限核验失败');
}

export async function initializeLocalDatabase({ credentials, root = localDatabaseRoot } = {}) {
  const admin = await connect(localDatabaseUrl(credentials, 'postgres'));
  let client;
  try {
    await createLocalDatabase(admin, credentials);
    const migrationOptions = localMigrationOptions(credentials);
    const { connectionString } = migrationOptions;
    await runMigrations(migrationOptions);
    client = await connect(connectionString);
    await resumeLocalBackendReader({ admin, client, credentials, root });
    await verifyDatabaseContract({
      connectionString,
      profile: 'local-test',
      expectedDatabase: database,
      expectedUser: owner,
      expectedPgvectorVersion: '0.8.6',
    });
    const state = (
      await client.query(
        'SELECT ready,plan_hash FROM public.unified_signal_cutover WHERE singleton',
      )
    ).rows[0];
    await prepareServiceRoles(admin, client, credentials, root);
    await prepareLocalBackendRoles({ admin, client, credentials, root });
    await assertMinimumRoles(client);
    const content = await import(
      pathToFileURL(resolve(root, 'packages/content/dist/src/index.js')).href
    );
    const catalog = await content.loadSeedCatalog(
      resolve(root, 'data/seed'),
      resolve(root, 'data/taxonomy/taxonomy.yaml'),
    );
    // Explicit local init also updates the runtime catalog after initial cutover.
    // Existing Signals are not re-imported; the Topic sync is locked and idempotent.
    await syncTopics(
      client,
      content.buildTopicDatabaseProjection(catalog.taxonomy, catalog.topics),
      {
        dryRun: false,
      },
    );
    if (!state?.ready) {
      const { projectLegacySignalEntries } = await import(
        pathToFileURL(resolve(root, 'apps/web/lib/legacy-signal-projection.ts')).href
      );
      const plan = buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog));
      await client.query('BEGIN');
      try {
        await applyLegacySignalArchive(client, plan);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      const inspected = await inspectUnifiedSignalMigration(client);
      const expectedPlanHash = inspected.summary.plan_hash;
      await applyUnifiedSignalBackfill(client, {
        expectedPlanHash,
        checkBeforeCommit: async () => {
          await assertDatabaseIdentity(admin, credentials);
          const changed = await client.query(
            'UPDATE public.unified_signal_cutover SET ready=true,plan_hash=$1 WHERE singleton AND NOT ready',
            [expectedPlanHash],
          );
          if (changed.rowCount !== 1) stop('本地统一数据启用状态冲突');
        },
      });
      await verifyUnifiedSignalBackfill(client, { expectedPlanHash });
    }
  } finally {
    await client?.end();
    await admin.end();
  }
  return verifyLocalDatabase({ credentials, root });
}

export async function verifyLocalDatabase({ credentials, root = localDatabaseRoot } = {}) {
  const admin = await connect(localDatabaseUrl(credentials, 'postgres'));
  try {
    await assertDatabaseIdentity(admin, credentials);
  } finally {
    await admin.end();
  }
  const result = await verifyDatabaseContract({
    connectionString: localDatabaseUrl(credentials),
    profile: 'local-test',
    expectedDatabase: database,
    expectedUser: owner,
    expectedPgvectorVersion: '0.8.6',
  });
  const ownerClient = await connect(localDatabaseUrl(credentials));
  let roleAdmin;
  let backendReady;
  try {
    roleAdmin = await connect(localDatabaseUrl(credentials, 'postgres'));
    await assertMinimumRoles(ownerClient);
    backendReady = await verifyLocalBackendRoles({
      admin: roleAdmin,
      client: ownerClient,
      credentials,
      connect,
      root,
    });
  } finally {
    await ownerClient.end();
    await roleAdmin?.end();
  }
  const reader = await connect(localDatabaseUrl(credentials, 'hzense_editorial_reader'));
  try {
    if (
      (await reader.query('SELECT ready FROM public.unified_public_status')).rows[0]?.ready !== true
    )
      stop('本地统一 Signal 尚未初始化');
    const row = (
      await reader.query('SELECT count(*)::int AS count FROM public.unified_public_signals')
    ).rows[0];
    return { ...result, publicSignals: row.count, backendReady };
  } finally {
    await reader.end();
  }
}

// This internal entry is launched with an allowlisted environment. Reuse main's
// argument, Docker, container, and private-file checks before touching any DB.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['init', 'verify'].includes(args[0])) {
    console.error('[local-database] bootstrap 仅支持 init 或 verify');
    process.exitCode = 1;
  } else {
    main({
      args,
      initialize: initializeLocalDatabase,
      verify: verifyLocalDatabase,
      log: () => {},
    }).catch((error) => {
      console.error(
        `[local-database] ${error instanceof LocalDatabaseError ? error.message : '操作失败；已保留本地数据。诊断未输出连接串或密码。'}`,
      );
      process.exitCode = 1;
    });
  }
}
