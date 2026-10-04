import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

export const legacyMigrationName = '0028_legacy_signal_archive.sql';
export const legacyMigrationChecksum =
  '9f2b64e199d4c7cb8cd47d6cff39d5f17c12c0350122944b5a9092bf6c7e9781';
const historicalManifestHash = 'c112d0d465a80763696321340fe25d1521cc57809d4cba592aefe75db843bd7f';
const digest = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const requireGate = (condition, gate) => {
  if (!condition) throw new Error(`legacy-signal-${gate}`);
};
export class LegacySignalMaintenanceError extends Error {
  constructor(cause, operation, mayHaveCommitted) {
    super('Legacy Signal maintenance stopped', { cause });
    this.operation = operation;
    this.mayHaveCommitted = mayHaveCommitted;
  }
}

/** Binds the exact checked artifact, target, backup and immutable public archive. */
export function legacySignalMaintenancePlan({
  migrations,
  preflight,
  policy,
  backupId,
  archivePlan,
}) {
  const pairs = migrations.map(({ name, checksum }) => [name, checksum]);
  requireGate(
    migrations.length === 29 &&
      hash(JSON.stringify(pairs.slice(0, 28))) === historicalManifestHash &&
      migrations[28].name === legacyMigrationName &&
      migrations[28].checksum === legacyMigrationChecksum &&
      migrations.every(
        (entry) => digest.test(entry.checksum) && hash(entry.sql) === entry.checksum,
      ),
    'manifest-required',
  );
  requireGate(
    Array.isArray(preflight.pendingMigrations) &&
      (preflight.pendingMigrations.length === 0 ||
        (preflight.pendingMigrations.length === 1 &&
          preflight.pendingMigrations[0] === legacyMigrationName)),
    'migration-scope-required',
  );
  requireGate(
    archivePlan.count === 110 && digest.test(archivePlan.plan_hash),
    'frozen-content-required',
  );
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight.database === policy.database &&
      preflight.user === policy.user,
    'target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'backup-required',
  );
  const result = {
    manifestFingerprint: hash(`hzense/legacy-signal-manifest/v1\0${JSON.stringify(pairs)}`),
    targetFingerprint: hash(
      `hzense/legacy-signal-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, preflight.database, preflight.user])}`,
    ),
    backupIdSha256: hash(backupId),
    contentFingerprint: archivePlan.plan_hash,
  };
  return {
    ...result,
    planFingerprint: hash(
      `hzense/legacy-signal-plan/v1\0${JSON.stringify({ ...result, pendingMigrations: preflight.pendingMigrations, count: archivePlan.count })}`,
    ),
  };
}

async function productionDependencies(env) {
  const connection = await import('../../packages/database/src/connection-policy.mjs');
  const preflight = await import('../../packages/database/src/preflight.mjs');
  const migrations = await import('../../packages/database/src/migrate.mjs');
  const acl = await import('../../packages/database/src/runtime-acl-baseline.mjs');
  const archive = await import('../../packages/database/src/legacy-signal-archive.mjs');
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const databaseRequire = createRequire(
    new URL('../../packages/database/package.json', import.meta.url),
  );
  const { loadSeedCatalog } = await import(
    pathToFileURL(webRequire.resolve('@hzense/content')).href
  );
  const { projectLegacySignalEntries } =
    await import('../../apps/web/lib/legacy-signal-projection.ts');
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('../../data/seed/', import.meta.url)),
    fileURLToPath(new URL('../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  );
  const { Client } = databaseRequire('pg');
  return {
    ...connection,
    ...preflight,
    ...migrations,
    ...acl,
    ...archive,
    verifyDatabaseContract,
    archivePlan: archive.buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog)),
    options: connection.productionDatabaseOptions(env),
    createClient: (options) => new Client(options),
  };
}

async function readAcl(client, deps, options, policy, backupId) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    return await deps.inspectRuntimeAclBaseline(client, {
      expectedDatabase: policy.database,
      expectedUser: policy.user,
      expectedPostgresMajor: options.expectedPostgresMajor,
      backupReference: deps.runtimeAclBackupReference(backupId),
    });
  } finally {
    await client.query('ROLLBACK');
  }
}

async function inspectReader(client, granted) {
  const role = (
    await client.query(
      `SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS valid FROM pg_roles WHERE rolname='hzense_editorial_reader'`,
    )
  ).rows;
  requireGate(role.length === 1 && role[0].valid === true, 'reader-role-required');
  if (!granted) return;
  const result = (
    await client.query(`SELECT
    NOT has_table_privilege('hzense_editorial_reader','public.legacy_signal_archive','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.legacy_signal_archive','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_table_privilege('hzense_editorial_reader','public.legacy_public_signals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.legacy_public_signals','INSERT,UPDATE,REFERENCES')
    AND has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','signal_id','SELECT')
    AND has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','content','SELECT')
    AND has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','content_hash','SELECT')
    AND NOT has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','signal_id','SELECT WITH GRANT OPTION')
    AND NOT has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','content','SELECT WITH GRANT OPTION')
    AND NOT has_column_privilege('hzense_editorial_reader','public.legacy_public_signals','content_hash','SELECT WITH GRANT OPTION') AS valid`)
  ).rows;
  requireGate(result.length === 1 && result[0].valid === true, 'reader-grant-required');
}

/** The caller provides the shared hosted main/CI, run binding and recovery gates. */
export async function executeLegacySignalMaintenance(env, request, context, injectedDependencies) {
  const { operation, approval } = request;
  requireGate(
    ['legacy-signal-dry-run', 'legacy-signal-apply', 'legacy-signal-verify'].includes(operation),
    'operation-required',
  );
  requireGate(
    typeof context.checkFreshness === 'function' && typeof context.checkApproval === 'function',
    'context-required',
  );
  const applying = operation === 'legacy-signal-apply';
  const deps = injectedDependencies ?? (await productionDependencies(env));
  const options = deps.options;
  const policy = deps.validateConnectionTarget(options);
  const migrations = await deps.loadMigrations();
  await deps.verifyMigrationManifest(migrations);
  const archivePlan = deps.archivePlan;
  let mayHaveCommitted = false;
  let executedPlan;
  const session = async (work) => {
    await context.checkFreshness();
    const client = deps.createClient({
      connectionString: options.connectionString,
      application_name: 'hzense-legacy-signal-maintenance',
      connectionTimeoutMillis: 10_000,
    });
    let failed = false,
      connected = false,
      locked = false,
      result,
      error;
    client.on('error', () => {
      failed = true;
    });
    const healthy = () => requireGate(!failed, 'connection-failed');
    try {
      await client.connect();
      connected = true;
      healthy();
      await client.query("SET statement_timeout='60s'");
      await client.query("SET lock_timeout='5s'");
      await client.query("SET idle_in_transaction_session_timeout='90s'");
      if (applying) {
        locked =
          (
            await client.query(
              'SELECT pg_try_advisory_lock($1,$2) AS locked',
              deps.migrationLockKeys,
            )
          ).rows[0]?.locked === true;
        requireGate(locked, 'migration-lock-required');
      }
      const current = await deps.inspectDatabasePreflight(client, {
        ...options,
        expectedHost: policy.host,
      });
      healthy();
      result = await work(client, current, healthy);
      healthy();
    } catch (cause) {
      error = cause;
    }
    if (connected) {
      try {
        await client.query('ROLLBACK');
      } catch (cause) {
        error ??= cause;
      }
      if (locked)
        try {
          await client.query('SELECT pg_advisory_unlock($1,$2)', deps.migrationLockKeys);
        } catch (cause) {
          error ??= cause;
        }
    }
    try {
      await client.end();
    } catch (cause) {
      error ??= cause;
    }
    if (failed) error ??= new Error('legacy-signal-connection-failed');
    if (error) throw error;
    return result;
  };
  const binding = (current) =>
    legacySignalMaintenancePlan({
      migrations,
      preflight: current,
      policy,
      backupId: env.MAINTENANCE_BACKUP_ID,
      archivePlan,
    });
  const verifyRows = async (client) => {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const state = await deps.reconcileLegacySignalArchive(client, archivePlan);
      requireGate(
        Array.isArray(state.missing) && state.missing.length === 0 && state.existing === 110,
        'archive-incomplete',
      );
      await inspectReader(client, true);
      return state;
    } finally {
      await client.query('ROLLBACK');
    }
  };
  try {
    if (operation === 'legacy-signal-dry-run') {
      const capture = () =>
        session(async (client, current) => {
          const plan = binding(current);
          if (current.pendingMigrations.length === 0) await verifyRows(client);
          const baseline = await readAcl(client, deps, options, policy, env.MAINTENANCE_BACKUP_ID);
          requireGate(digest.test(baseline.fingerprint ?? ''), 'acl-fingerprint-required');
          return {
            ...plan,
            aclFingerprint: baseline.fingerprint,
            pendingMigrations: current.pendingMigrations,
            desiredCount: archivePlan.count,
            committed: false,
          };
        });
      const first = await capture(),
        second = await capture();
      requireGate(JSON.stringify(first) === JSON.stringify(second), 'dry-run-drift');
      return first;
    }
    if (applying)
      await session(async (client, current, healthy) => {
        requireGate(
          current.pendingMigrations.length === 1 &&
            current.pendingMigrations[0] === legacyMigrationName,
          'exact-pending-migration-required',
        );
        const plan = binding(current);
        executedPlan = plan;
        requireGate(
          Object.entries(plan).every(([key, value]) => approval[key] === value),
          'approved-plan-mismatch',
        );
        const baseline = await readAcl(client, deps, options, policy, env.MAINTENANCE_BACKUP_ID);
        requireGate(baseline.fingerprint === approval.aclFingerprint, 'acl-drift');
        await inspectReader(client, false);
        await context.checkFreshness();
        healthy();
        context.checkApproval();
        await client.query('BEGIN');
        await client.query(migrations[28].sql);
        healthy();
        await client.query(
          'INSERT INTO public.hzense_schema_migrations(name,checksum) VALUES($1,$2)',
          [migrations[28].name, migrations[28].checksum],
        );
        const imported = await deps.applyLegacySignalArchive(client, archivePlan);
        healthy();
        requireGate(
          imported.count === 110 && imported.inserted === 110,
          'complete-import-required',
        );
        await client.query(
          'GRANT SELECT(signal_id,content,content_hash) ON public.legacy_public_signals TO hzense_editorial_reader',
        );
        await inspectReader(client, true);
        healthy();
        await context.checkFreshness();
        healthy();
        context.checkApproval();
        mayHaveCommitted = true;
        await client.query('COMMIT');
        healthy();
      });
    await context.checkFreshness();
    const verification = await deps.verifyDatabaseContract(options);
    requireGate(
      verification.migrationCount === 29 && verification.tableCount === 61,
      'schema-verification-required',
    );
    const verified = await session(async (client, current) => {
      requireGate(current.pendingMigrations.length === 0, 'complete-migrations-required');
      await verifyRows(client);
      return binding(current);
    });
    return {
      ...(executedPlan ?? verified),
      ...verification,
      desiredCount: 110,
      ...(applying ? { inserted: 110 } : {}),
      committed: applying,
      verificationCompleted: true,
      pendingMigrations: [],
    };
  } catch (cause) {
    throw new LegacySignalMaintenanceError(cause, operation, mayHaveCommitted);
  }
}
