import { createHash } from 'node:crypto';
import {
  productionDependencies,
  assertUnifiedMaintenanceManifest,
} from './unified-signal-maintenance.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const gate = (ok, code) => {
  if (!ok) throw new Error(`unified-signal-${code}`);
};
export class UnifiedSignalMaintenanceError extends Error {
  constructor(cause, operation, mayHaveCommitted) {
    super('Unified Signal maintenance stopped', { cause });
    this.operation = operation;
    this.mayHaveCommitted = mayHaveCommitted;
  }
}
export const unifiedCutoverGrantSql = `GRANT INSERT(unified_content) ON public.editorial_signal_revisions TO hzense_editorial_writer;
GRANT SELECT(signal_id,version,origin,publication_basis,content,recorded_at) ON public.unified_public_signals TO hzense_editorial_reader;
GRANT SELECT(ready) ON public.unified_public_status TO hzense_editorial_reader;`;
export async function inspectUnifiedCutoverGrants(client) {
  const result = await client.query(`SELECT
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','unified_content','INSERT')
    AND NOT has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','unified_content','SELECT,UPDATE,REFERENCES,INSERT WITH GRANT OPTION')
    AND NOT has_any_column_privilege('hzense_editorial_writer','public.signals','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_any_column_privilege('hzense_editorial_writer','public.signal_versions','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.signals','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.signal_versions','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_any_column_privilege('hzense_editorial_reader','public.unified_signal_cutover','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_any_column_privilege('hzense_editorial_writer','public.unified_signal_cutover','SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT EXISTS(SELECT 1
      FROM unnest(ARRAY['hzense_editorial_writer','hzense_editorial_reader']) r
      CROSS JOIN unnest(ARRAY['public.signals','public.signal_versions','public.unified_signal_cutover','public.unified_public_signals','public.unified_public_status']) t
      WHERE has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
    AND NOT EXISTS(SELECT 1
      FROM unnest(ARRAY['hzense_editorial_writer','hzense_editorial_reader']) r
      CROSS JOIN unnest(ARRAY['public.hzense_unified_canonical(jsonb)','public.hzense_write_unified_editorial()','public.hzense_require_unified_editorial()']) f
      WHERE has_function_privilege(r,f,'EXECUTE'))
    AND has_column_privilege('hzense_editorial_reader','public.unified_public_status','ready','SELECT')
    AND NOT has_column_privilege('hzense_editorial_reader','public.unified_public_status','ready','SELECT WITH GRANT OPTION,INSERT,UPDATE,REFERENCES')
    AND (SELECT bool_and(has_column_privilege('hzense_editorial_reader','public.unified_public_signals',name,'SELECT')
      AND NOT has_column_privilege('hzense_editorial_reader','public.unified_public_signals',name,'SELECT WITH GRANT OPTION,INSERT,UPDATE,REFERENCES'))
      FROM unnest(ARRAY['signal_id','version','origin','publication_basis','content','recorded_at']) name) AS valid`);
  gate(result.rows[0]?.valid === true, 'minimal-grants-required');
}

/** The shared dispatcher provides current-main/CI, recovery and run-bound approval. */
export async function executeUnifiedSignalApply(env, request, context, injected) {
  const { operation, approval } = request;
  gate(['unified-signal-apply', 'unified-signal-verify'].includes(operation), 'operation-required');
  gate(
    typeof context?.checkFreshness === 'function' && typeof context?.checkApproval === 'function',
    'context-required',
  );
  const applying = operation === 'unified-signal-apply';
  const deps = injected ?? {
    ...(await productionDependencies(env)),
    ...(await import('../../packages/database/src/unified-signal-backfill.mjs')),
    ...(await import('../../packages/database/src/verify.mjs')),
    ...(await import('../../packages/database/src/runtime-acl-baseline.mjs')),
    inspectUnifiedCutoverGrants,
  };
  const options = deps.options,
    policy = deps.validateConnectionTarget(options);
  const migrations = await deps.loadMigrations();
  await deps.verifyMigrationManifest(migrations);
  const manifestFingerprint = assertUnifiedMaintenanceManifest(migrations);
  let mayHaveCommitted = false;
  const session = async (work) => {
    await context.checkFreshness();
    const client = deps.createClient({
      connectionString: options.connectionString,
      application_name: 'hzense-unified-signal-maintenance',
      connectionTimeoutMillis: 10000,
      query_timeout: 60000,
    });
    let failed = false,
      locked = false;
    client.on('error', () => {
      failed = true;
    });
    const healthy = () => gate(!failed, 'connection-failed');
    try {
      await client.connect();
      if (applying) {
        locked =
          (
            await client.query(
              'SELECT pg_try_advisory_lock($1,$2) AS locked',
              deps.migrationLockKeys,
            )
          ).rows[0]?.locked === true;
        gate(locked, 'migration-lock-required');
      }
      const preflight = await deps.inspectDatabasePreflight(client, {
        ...options,
        expectedHost: policy.host,
      });
      gate(
        preflight.pendingMigrations.length === 0 &&
          preflight.database === policy.database &&
          preflight.user === policy.user,
        'applied-schema-required',
      );
      healthy();
      const result = await work(client, healthy);
      healthy();
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      if (locked)
        await client
          .query('SELECT pg_advisory_unlock($1,$2)', deps.migrationLockKeys)
          .catch(() => undefined);
      await client.end();
    }
  };
  const targetFingerprint = hash(
    `hzense/unified-signal-preflight-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, policy.database, policy.user])}`,
  );
  const schema = await deps.verifyDatabaseContract(options);
  gate(schema.migrationCount === 31 && schema.tableCount === 62, 'schema-required');
  let expectedPlanHash = approval?.planFingerprint;
  let result;
  try {
    if (applying) {
      gate(
        approval?.manifestFingerprint === manifestFingerprint &&
          approval.targetFingerprint === targetFingerprint &&
          approval.backupIdSha256 === hash(env.MAINTENANCE_BACKUP_ID ?? ''),
        'binding-required',
      );
      result = await session(async (client, healthy) => {
        const state = (
          await client.query(
            'SELECT ready,plan_hash FROM public.unified_signal_cutover WHERE singleton',
          )
        ).rows;
        gate(
          state.length === 1 && !state[0].ready && state[0].plan_hash === null,
          'fresh-cutover-required',
        );
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        let acl;
        try {
          acl = await deps.inspectRuntimeAclBaseline(client, {
            expectedDatabase: policy.database,
            expectedUser: policy.user,
            expectedPostgresMajor: options.expectedPostgresMajor,
            backupReference: deps.runtimeAclBackupReference(env.MAINTENANCE_BACKUP_ID),
          });
        } finally {
          await client.query('ROLLBACK');
        }
        gate(acl.fingerprint === approval.aclFingerprint, 'acl-drift');
        await context.checkFreshness();
        await context.checkApproval();
        healthy();
        return deps.applyUnifiedSignalBackfill(client, {
          expectedPlanHash,
          checkBeforeCommit: async () => {
            await client.query(unifiedCutoverGrantSql);
            await deps.inspectUnifiedCutoverGrants(client);
            const activated = await client.query(
              'UPDATE public.unified_signal_cutover SET ready=true,plan_hash=$1 WHERE singleton AND NOT ready',
              [expectedPlanHash],
            );
            gate(activated.rowCount === 1, 'activation-conflict');
            await context.checkFreshness();
            await context.checkApproval();
            healthy();
            mayHaveCommitted = true;
          },
        });
      });
      gate(result.committed === true, 'fresh-apply-required');
    }
    // A distinct connection reads committed rows, including the activation flag.
    const verified = await session(async (client, healthy) => {
      const state = (
        await client.query(
          'SELECT ready,plan_hash FROM public.unified_signal_cutover WHERE singleton',
        )
      ).rows;
      gate(
        state.length === 1 && state[0].ready === true && /^[a-f0-9]{64}$/.test(state[0].plan_hash),
        'activated-state-required',
      );
      if (expectedPlanHash) gate(state[0].plan_hash === expectedPlanHash, 'plan-binding-required');
      expectedPlanHash = state[0].plan_hash;
      await deps.inspectUnifiedCutoverGrants(client);
      const receipt = await deps.verifyUnifiedSignalBackfill(client, { expectedPlanHash });
      await context.checkFreshness();
      healthy();
      return receipt;
    });
    return {
      ...schema,
      ...verified,
      manifestFingerprint,
      targetFingerprint,
      committed: applying,
      inserted: result?.inserted ?? 0,
      verificationCompleted: true,
      cutoverReady: true,
      pendingMigrations: [],
    };
  } catch (error) {
    throw new UnifiedSignalMaintenanceError(
      error,
      operation,
      mayHaveCommitted || error?.mayHaveCommitted === true,
    );
  }
}
