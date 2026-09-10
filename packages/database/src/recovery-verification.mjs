import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { validateConnectionTarget } from './connection-policy.mjs';
import { inspectProductionTls } from './preflight.mjs';
import { inspectRuntimeAclBaseline, runtimeAclBackupReference } from './runtime-acl-baseline.mjs';
import { runRestoredRuntimeReaderPreflight } from './runtime-reader-preflight.mjs';
import { withRecoveryReadClient } from './recovery-read-client.mjs';

const captureSql = await readFile(
  new URL('../../../db/roles/fts_acl_recovery_state.sql', import.meta.url),
  'utf8',
);
export const recoveryStateQuery = captureSql
  .split('-- BEGIN SHARED ACL STATE QUERY')[1]
  .split('-- END SHARED ACL STATE QUERY')[0];

export const recoveryIdentityQuery = `SELECT
  current_database() AS database_name, session_user AS authenticated_role,
  current_user AS effective_role, current_setting('transaction_read_only') AS read_only,
  current_setting('server_version_num')::integer AS version,
  (SELECT count(*)::integer FROM pg_event_trigger WHERE evtenabled <> 'D') AS event_triggers,
  (SELECT count(*)::integer FROM pg_attribute
   WHERE attrelid = to_regclass('public.search_documents') AND attnum > 0 AND NOT attisdropped) AS search_columns,
  (SELECT CASE WHEN count(*) = 3 AND bool_and(context = 'postmaster' AND setting <> '')
    THEN jsonb_object_agg(name, setting) ELSE NULL END FROM pg_settings
    WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id')) AS identity,
  (SELECT CASE WHEN count(*) = 3 AND bool_and(context = 'postmaster' AND setting <> '')
    THEN encode(sha256(convert_to(jsonb_object_agg(name, setting ORDER BY name)::text, 'UTF8')), 'hex')
    ELSE NULL END FROM pg_settings
    WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id')) AS fingerprint`;

export async function beginRecoveryRead(client) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
  await client.query("SET LOCAL timezone = 'UTC'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '45s'");
}

export async function inspectRecoveryIdentity(client, approval, role, database = 'hzense') {
  const result = await client.query(recoveryIdentityQuery);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    row?.database_name !== database ||
    row.authenticated_role !== role ||
    row.effective_role !== role ||
    row.read_only !== 'on' ||
    Math.floor(row.version / 10_000) !== 18 ||
    row.event_triggers !== 0 ||
    row.identity?.['neon.project_id'] !== approval.projectId ||
    row.identity?.['neon.branch_id'] !== approval.targetBranchId ||
    row.fingerprint !== approval.targetFingerprint ||
    [approval.sourceFingerprint, approval.productionFingerprint].includes(row.fingerprint)
  ) {
    throw new Error('Recovery live target identity mismatch');
  }
  if (
    database === 'hzense' &&
    row.search_columns !== (approval.operation === 'capture-r0' ? 10 : 18)
  ) {
    throw new Error('Recovery stage schema mismatch');
  }
}

export async function collectRecoveryVerification(env, approval, guard) {
  const runtime = approval.operation === 'verify-restored';
  const options = {
    connectionString: runtime ? env.RECOVERY_RUNTIME_URL : env.RECOVERY_OWNER_URL,
    profile: 'production',
    expectedHost: runtime ? approval.runtimeHost : approval.directHost,
    expectedPort: '5432',
    expectedDatabase: 'hzense',
    expectedUser: runtime ? 'hzense_runtime' : 'hzense_migrator',
    nodeTlsRejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED,
  };
  validateConnectionTarget(options);
  if (!new URL(options.connectionString).password)
    throw new Error('Recovery dedicated credential required');
  if (runtime) {
    const result = await runRestoredRuntimeReaderPreflight(options, async (client, database) => {
      await guard();
      await beginRecoveryRead(client);
      await inspectRecoveryIdentity(client, approval, 'hzense_runtime', database);
      if (database === 'hzense') {
        const state = (await client.query(recoveryStateQuery)).rows[0];
        if (state?.fingerprint !== approval.r1Fingerprint)
          throw new Error('Recovery R1 state mismatch');
      }
    });
    // These are successful assertion outcomes, not raw query rows or a separate
    // attestation: preflight must complete identity, ACL, read probes and cleanup.
    return {
      verificationBasis: 'completed-runtime-preflight-assertions',
      targetFingerprint: approval.targetFingerprint,
      r1Fingerprint: approval.r1Fingerprint,
      runtimeAuthenticated: true,
      topicColumnCount: result.topicColumns.length,
      searchColumnCount: result.searchColumns.length,
      verifiedReservedDatabaseCount: result.verifiedNeonReservedDatabases.length,
      negativeReadsDenied: true,
    };
  }

  async function capture() {
    await guard();
    const client = new pg.Client({
      connectionString: options.connectionString,
      application_name: 'hzense-isolated-recovery-read',
      connectionTimeoutMillis: 10_000,
      query_timeout: 35_000,
      enableChannelBinding: true,
    });
    return withRecoveryReadClient(client, async () => {
      await beginRecoveryRead(client);
      await inspectProductionTls(client, options.expectedHost);
      await inspectRecoveryIdentity(client, approval, 'hzense_migrator');
      const baseline = await inspectRuntimeAclBaseline(client, {
        ...options,
        backupReference: runtimeAclBackupReference(approval.sourceBranchId),
      });
      const state = (await client.query(recoveryStateQuery)).rows[0];
      if (
        !/^[a-f0-9]{64}$/.test(state?.fingerprint ?? '') ||
        state.summary?.format !== 'hzense-fts-acl-state/v1'
      ) {
        throw new Error('Recovery state result invalid');
      }
      if (approval.operation === 'capture-r3' && state.fingerprint !== approval.r1Fingerprint) {
        throw new Error('Recovery R3 differs from reviewed R1');
      }
      await guard();
      return { baseline, state };
    });
  }
  const first = await capture();
  const second = await capture();
  if (
    first.baseline.fingerprint !== second.baseline.fingerprint ||
    first.state.fingerprint !== second.state.fingerprint
  ) {
    throw new Error('Recovery independent captures differ');
  }
  return {
    targetFingerprint: approval.targetFingerprint,
    independentCapturesMatch: true,
    captures: [first, second],
  };
}
