// Local-only bootstrap. Production SQL and role checks remain unchanged.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  LocalDatabaseError,
  assertLocalCluster,
  localDatabaseBackendRoles,
  localDatabaseRoot,
  localDatabaseUrl,
  validateLocalDatabaseCredentials,
} from './local-database.mjs';
import { assertEditorialRole } from '../packages/database/src/editorial-signal-role.mjs';
import { assertCandidateReviewRole } from '../packages/database/src/candidate-review-role.mjs';
import { assertImportRole } from '../packages/database/src/import-role.mjs';
import { assertCandidateEnrichmentRole } from '../packages/database/src/signal-generation-role.mjs';
import {
  candidateEnrichmentRoleCheckSQL,
  generationRoleCheckSQL,
} from '../packages/database/src/signal-generation-role-check.mjs';
import { candidateEnrichmentRoleColumns } from '../packages/database/src/signal-generation-role-columns.mjs';
import {
  assertAutomationRole,
  automationRoleColumns,
  automationUpdateColumns,
} from '../packages/database/src/automation-role.mjs';

export const localBackendRolePlan = Object.freeze([
  { role: 'hzense_ai_admin', file: 'configure_ai_admin.sql', verifyTag: 'ai_admin_verify' },
  {
    role: 'hzense_import_admin',
    file: 'configure_import_admin.sql',
    verifyTag: 'import_admin_verify',
  },
  { role: 'hzense_generation_admin', file: 'configure_generation_admin.sql' },
  { role: 'hzense_candidate_reviewer', file: 'configure_candidate_reviewer.sql' },
  {
    role: 'hzense_signal_admin_reader',
    file: 'configure_signal_admin_reader.sql',
    verifyTag: 'signal_admin_reader_verify',
  },
  { role: 'hzense_automation_admin', file: 'configure_automation_config_admin.sql' },
  { role: 'hzense_insight_reader' },
]);
const stop = (message) => {
  throw new LocalDatabaseError(message);
};
const marker = (credentials) =>
  `HZense isolated local development v1 ${createHash('sha256').update(credentials.developmentPassword).digest('hex')}`;

export function localRoleVerificationBlock(script, tag) {
  if (
    ![
      'ai_admin_verify',
      'import_admin_verify',
      'signal_admin_reader_verify',
      'verify_acl',
    ].includes(tag)
  )
    stop('未知的本地角色核验块');
  const blocks = [...script.matchAll(new RegExp(`DO \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`, 'g'))];
  if (blocks.length !== 1) stop('角色核验块缺失或不唯一，拒绝初始化');
  return blocks[0][0];
}

export async function assertLocalBackendTarget(client) {
  const row = (
    await client.query(`SELECT current_database() AS database,
    current_user AS role,session_user AS session,
    current_setting('cluster_name') AS cluster,
    pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()`)
  ).rows[0];
  if (
    row?.database !== 'hzense_local' ||
    row.role !== 'hzense_local_owner' ||
    row.session !== row.role ||
    row.owner !== row.role ||
    row.cluster !== 'hzense-local-development'
  )
    stop('后台授权仅允许本地专用集群中的 hzense_local owner');
}

async function inspectRole(admin, role, credentials) {
  if (!localDatabaseBackendRoles.includes(role)) stop('未知本地后台角色');
  const row = (
    await admin.query(
      `SELECT rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls,rolconnlimit,rolconfig,
    shobj_description(r.oid,'pg_authid') AS marker,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership,
    EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid) AS settings,
    EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o') AS ownership,
    EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='a') AS acl
    FROM pg_roles r WHERE rolname=$1`,
      [role],
    )
  ).rows[0];
  if (
    row &&
    (!row.rolcanlogin ||
      row.rolsuper ||
      row.rolinherit ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.rolreplication ||
      row.rolbypassrls ||
      row.rolconnlimit !== 2 ||
      row.rolconfig !== null ||
      row.membership ||
      row.settings ||
      row.ownership ||
      row.marker !== marker(credentials))
  )
    stop('已有后台角色属性或归属不匹配；不会修复未知权限或重置密码');
  return row;
}

// The production upgrade is deliberately pinned to database "hzense". Do not
// rewrite that guard. Use the same exported column matrix in this local-only
// transaction and run the exact production pre/post capability checks instead.
export const localCandidateEnrichmentGrants = Object.entries(candidateEnrichmentRoleColumns)
  .map(
    ([privilege, columns]) =>
      `GRANT ${privilege}(${columns.join(',')}) ON public.candidate_enrichment_runs TO hzense_generation_admin;`,
  )
  .join('\n');

// The production config-only provisioner is pinned to hzense. Keep that guard
// and apply its exported column matrix only after the strict local owner check,
// reusing its exact
// post-grant audit before committing. The existing deletion upgrade subsequently
// accepts only this exact baseline or its already-upgraded column ACL.
export const localAutomationGrants = [
  'GRANT CONNECT ON DATABASE hzense_local TO hzense_automation_admin;',
  'GRANT USAGE ON SCHEMA public TO hzense_automation_admin;',
  ...Object.entries(automationRoleColumns).map(
    ([table, columns]) =>
      `GRANT SELECT(${columns.join(',')}), INSERT(${columns.join(',')}), UPDATE(${automationUpdateColumns[table].join(',')}) ON public.${table} TO hzense_automation_admin;`,
  ),
].join('\n');

// This reader has only the existing filtered publication view. Never reuse the
// production two-role provisioner: an initialized local admin already has ACLs.
export const localInsightReaderGrants = [
  'GRANT CONNECT ON DATABASE hzense_local TO hzense_insight_reader;',
  'GRANT USAGE ON SCHEMA public TO hzense_insight_reader;',
  'GRANT SELECT(id,result,published_at) ON public.published_topic_insights TO hzense_insight_reader;',
].join('\n');

export async function prepareLocalInsightReader(client) {
  await assertLocalBackendTarget(client);
  await client.query('BEGIN');
  try {
    if (
      (await client.query('SELECT pg_try_advisory_xact_lock(1215921955,1298498925) AS locked'))
        .rows[0]?.locked !== true
    )
      stop('本地数据库维护锁忙，未修改权限');
    await client.query(localInsightReaderGrants);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function prepareLocalAutomationAdmin(client, root = localDatabaseRoot) {
  await assertLocalBackendTarget(client);
  const script = await readFile(
    resolve(root, 'db/roles/configure_automation_config_admin.sql'),
    'utf8',
  );
  const audit = localRoleVerificationBlock(script, 'verify_acl');
  await client.query('BEGIN');
  try {
    if (
      (await client.query('SELECT pg_try_advisory_xact_lock(1215921955,1298498925) AS locked'))
        .rows[0]?.locked !== true
    )
      stop('本地数据库维护锁忙，未修改权限');
    await client.query(localAutomationGrants);
    await client.query(audit);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function prepareLocalCandidateEnrichment(client) {
  await assertLocalBackendTarget(client);
  await client.query('BEGIN');
  try {
    if (
      (await client.query('SELECT pg_try_advisory_xact_lock(1215921955,1298498925) AS locked'))
        .rows[0]?.locked !== true
    )
      stop('本地数据库维护锁忙，未修改权限');
    if ((await client.query(candidateEnrichmentRoleCheckSQL)).rows[0]?.safe === true) {
      await client.query('COMMIT');
      return;
    }
    if ((await client.query(generationRoleCheckSQL)).rows[0]?.safe !== true)
      stop('生成角色不是已审核的精确基线，拒绝升级');
    await client.query(localCandidateEnrichmentGrants);
    if ((await client.query(candidateEnrichmentRoleCheckSQL)).rows[0]?.safe !== true)
      stop('本地补全最小权限核验失败');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function verifyOne(client, descriptor, root) {
  if (!descriptor.verifyTag) return;
  const script = await readFile(resolve(root, 'db/roles', descriptor.file), 'utf8');
  await client.query('BEGIN READ ONLY');
  try {
    await client.query(localRoleVerificationBlock(script, descriptor.verifyTag));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function provisionRole({ admin, client, credentials, root, descriptor }) {
  let row = await inspectRole(admin, descriptor.role, credentials);
  let created = false;
  if (!row) {
    await admin.query(
      `CREATE ROLE "${descriptor.role}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '${credentials.roles[descriptor.role]}'`,
    );
    await admin.query(`COMMENT ON ROLE "${descriptor.role}" IS '${marker(credentials)}'`);
    created = true;
    row = await inspectRole(admin, descriptor.role, credentials);
  }
  try {
    if (!row.acl) {
      if (descriptor.role === 'hzense_automation_admin')
        await prepareLocalAutomationAdmin(client, root);
      else if (descriptor.role === 'hzense_insight_reader') await prepareLocalInsightReader(client);
      else await client.query(await readFile(resolve(root, 'db/roles', descriptor.file), 'utf8'));
    }
    if (descriptor.role === 'hzense_automation_admin') {
      await assertLocalBackendTarget(client);
      await client.query(
        await readFile(resolve(root, 'db/roles/upgrade_automation_config_deletion.sql'), 'utf8'),
      );
    }
    if (descriptor.role === 'hzense_generation_admin')
      await prepareLocalCandidateEnrichment(client);
    await verifyOne(client, descriptor, root);
  } catch (error) {
    // Provisioning SQL uses a transaction. Reset a failed transaction before
    // checking whether our newly-created role is still empty. Never drop a
    // pre-existing role, a partly granted role, or any role owning data.
    await client.query('ROLLBACK');
    if (created) {
      const after = await inspectRole(admin, descriptor.role, credentials);
      if (after && !after.acl) await admin.query(`DROP ROLE "${descriptor.role}"`);
    }
    throw error;
  }
}

// A process interrupted between role creation and transactional GRANT can leave
// a known empty optional reader. Complete only this exact empty local role before
// the global schema verifier (which intentionally rejects an unconfigured reader).
export async function resumeLocalBackendReader({
  admin,
  client,
  credentials,
  root = localDatabaseRoot,
}) {
  validateLocalDatabaseCredentials(credentials);
  if (credentials.version < 2) return;
  await assertLocalCluster(admin);
  await assertLocalBackendTarget(client);
  const descriptor = localBackendRolePlan.find(({ role }) => role === 'hzense_signal_admin_reader');
  const row = await inspectRole(admin, descriptor.role, credentials);
  if (row && !row.acl) await provisionRole({ admin, client, credentials, root, descriptor });
}

export async function prepareLocalBackendRoles({
  admin,
  client,
  credentials,
  root = localDatabaseRoot,
}) {
  validateLocalDatabaseCredentials(credentials);
  if (credentials.version !== 4) stop('请先升级本地凭据；不会修改现有密码');
  await assertLocalCluster(admin);
  await assertLocalBackendTarget(client);
  for (const descriptor of localBackendRolePlan)
    await provisionRole({ admin, client, credentials, root, descriptor });
}

export async function verifyLocalBackendRoles({
  admin,
  client,
  credentials,
  connect,
  root = localDatabaseRoot,
}) {
  validateLocalDatabaseCredentials(credentials);
  await assertLocalCluster(admin);
  await assertLocalBackendTarget(client);
  const checks = [
    ['hzense_editorial_writer', (roleClient) => assertEditorialRole(roleClient, 'writer')],
    ['hzense_editorial_reader', (roleClient) => assertEditorialRole(roleClient, 'reader')],
  ];
  if (credentials.version >= 2) {
    for (const descriptor of localBackendRolePlan.filter(({ role }) => credentials.roles[role])) {
      const row = await inspectRole(admin, descriptor.role, credentials);
      if (!row?.acl) stop('本地后台角色尚未配置；请运行 local:db:init');
      await verifyOne(client, descriptor, root);
    }
    checks.push(
      ['hzense_import_admin', assertImportRole],
      ['hzense_generation_admin', assertCandidateEnrichmentRole],
      ['hzense_candidate_reviewer', assertCandidateReviewRole],
      ['hzense_ai_admin', async () => {}],
      ['hzense_signal_admin_reader', async () => {}],
    );
    if (credentials.version >= 3) checks.push(['hzense_automation_admin', assertAutomationRole]);
    if (credentials.version >= 4)
      checks.push([
        'hzense_insight_reader',
        (roleClient) => assertAutomationRole(roleClient, 'reader'),
      ]);
  }
  for (const [role, check] of checks) {
    const roleClient = await connect(localDatabaseUrl(credentials, role));
    try {
      await roleClient.query('BEGIN READ ONLY');
      if (
        (
          await roleClient.query('SELECT session_user=$1 AND current_user=session_user AS safe', [
            role,
          ])
        ).rows[0]?.safe !== true
      )
        stop('本地后台角色认证身份不匹配');
      await check(roleClient);
      await roleClient.query('ROLLBACK');
    } finally {
      await roleClient.end();
    }
  }
  return credentials.version === 4;
}
