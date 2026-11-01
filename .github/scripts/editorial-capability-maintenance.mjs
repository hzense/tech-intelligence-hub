import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { TopicMaintenanceError } from './topic-maintenance.mjs';

const digest = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const operations = new Set(['editorial-capability-plan', 'editorial-capability-grant']);
const phases = new Set([
  'initialization',
  'freshness-check',
  'approval-check',
  'dependencies',
  'owner-target',
  'migration-manifest',
  'role-script',
  'schema-verification',
  'owner-connect',
  'owner-session',
  'owner-preflight',
  'maintenance-lock',
  'role-preflight',
  'acl-baseline',
  'plan-approval',
  'grant',
  'commit',
  'independent-verification',
]);
const gates = new Set([
  'operation-required',
  'context-required',
  'reviewed-backup-required',
  'role-script-mismatch',
  'reviewed-schema-required',
  'applied-schema-required',
  'connection-failed',
  'migration-lock-required',
  'capability-state-invalid',
  'reader-capability-required',
  'partial-writer-capabilities',
  'acl-evidence-invalid',
  'acl-baseline-changed',
  'plan-binding-required',
  'approval-required',
  'verification-required',
  'unrelated-acl-changed',
  'unavailable',
]);
const own = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.value;
class CapabilityGateError extends Error {
  constructor(gate) {
    super(gate);
    this.gate = gate;
  }
}
const requireGate = (condition, gate) => {
  if (!condition) throw new CapabilityGateError(gate);
};

export const editorialCapabilityRoleUpgradeSha256 =
  '14304aa16b84e8f3598eac1bee0e51faefb0865aa834e669715247e30827502e';
const reviewedManifest = 'd5d838fdbdb11ad92148d2b0c6616a5ebb8829a4f5e5e1b604fca268a77e4ad7';

/** No raw SQL, driver error, identifier or connection value reaches public output. */
export class EditorialCapabilityMaintenanceError extends Error {
  constructor(error, operation, mayHaveCommitted, phase = 'initialization') {
    super('Editorial capability maintenance stopped');
    const wrapped = error instanceof EditorialCapabilityMaintenanceError;
    this.operation = operations.has(operation) ? operation : 'editorial-capability-plan';
    this.mayHaveCommitted = mayHaveCommitted === true;
    const gate = wrapped || error instanceof CapabilityGateError ? own(error, 'gate') : undefined;
    this.gate = gates.has(gate) ? gate : 'unavailable';
    const observedPhase = wrapped ? own(error, 'phase') : phase;
    this.phase = phases.has(observedPhase) ? observedPhase : 'initialization';
    // Reuse the existing fixed driver/TLS vocabulary, never its operation or gate.
    const diagnostic = new TopicMaintenanceError(error, 'topic-plan', false, this.phase);
    const previousReason = wrapped ? own(error, 'reason') : undefined;
    const previous = new TopicMaintenanceError(new Error(), 'topic-plan', false);
    if (wrapped) previous.reason = previousReason;
    this.reason = wrapped
      ? previousReason === 'role-contract-invalid'
        ? previousReason
        : new TopicMaintenanceError(previous, 'topic-plan', false).reason
      : ['role-preflight', 'grant'].includes(this.phase) && error && own(error, 'code') === 'P0001'
        ? 'role-contract-invalid'
        : diagnostic.reason;
  }
}

export function editorialCapabilityRoleUpgradeSql(sql) {
  requireGate(
    typeof sql === 'string' && hash(sql) === editorialCapabilityRoleUpgradeSha256,
    'role-script-mismatch',
  );
  return sql;
}
export function assertEditorialCapabilityManifest(migrations) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === 33 &&
      migrations.every((row) => typeof row.sql === 'string' && hash(row.sql) === row.checksum) &&
      hash(JSON.stringify(migrations.map(({ name, checksum }) => [name, checksum]))) ===
        reviewedManifest,
    'reviewed-schema-required',
  );
  return hash(`hzense/editorial-capability-manifest/v1\0${reviewedManifest}`);
}

const bindingFields = [
  'manifestFingerprint',
  'targetFingerprint',
  'backupIdSha256',
  'roleUpgradeSha256',
  'aclFingerprint',
  'unchangedAclFingerprint',
];
export function editorialCapabilityPlan(binding) {
  requireGate(
    bindingFields.every((key) => digest.test(binding?.[key] ?? '')) &&
      binding.roleUpgradeSha256 === editorialCapabilityRoleUpgradeSha256 &&
      [0, 3].includes(binding.writerMissingCount),
    'plan-binding-required',
  );
  const plan = Object.fromEntries(bindingFields.map((key) => [key, binding[key]]));
  plan.writerMissingCount = binding.writerMissingCount;
  return {
    ...plan,
    planFingerprint: hash(`hzense/editorial-capability-plan/v1\0${JSON.stringify(plan)}`),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const canonicalJson = (value) => JSON.stringify(canonical(value));
const writerGrants = new Set([
  'editorial_signal_revisions|publication_basis|SELECT',
  'editorial_signal_revisions|publication_basis|INSERT',
  'signal_generation_runs|snapshot|SELECT',
]);

/** Compare the complete baseline, permitting only the three reviewed writer ACL entries. */
export function editorialUnchangedAclFingerprint(baseline, roleStateFingerprint) {
  requireGate(
    digest.test(roleStateFingerprint ?? '') && baseline?.categories?.columns?.records,
    'acl-evidence-invalid',
  );
  const categories = Object.fromEntries(
    Object.entries(baseline.categories).map(([name, item]) => [name, item.records]),
  );
  const columns = [],
    targeted = new Map();
  for (const row of categories.columns) {
    const selected =
      row.schema === 'public' &&
      ((row.relation === 'editorial_signal_revisions' && row.column === 'publication_basis') ||
        (row.relation === 'signal_generation_runs' && row.column === 'snapshot'));
    if (!selected) {
      columns.push(row);
      continue;
    }
    const key = `${row.schema}|${row.relation}|${row.column}|${row.position}`;
    if (!targeted.has(key))
      targeted.set(key, {
        schema: row.schema,
        relation: row.relation,
        column: row.column,
        position: row.position,
        grants: [],
      });
    if (
      row.grantee === 'hzense_editorial_writer' &&
      writerGrants.has(`${row.relation}|${row.column}|${row.privilege}`)
    ) {
      requireGate(
        row.grantable === false && row.grantor === baseline.identity.databaseOwner,
        'acl-evidence-invalid',
      );
      continue;
    }
    if (
      row.privilege === null &&
      row.grantee === null &&
      row.grantor === null &&
      row.grantable === null
    )
      continue;
    targeted.get(key).grants.push({
      grantee: row.grantee,
      grantor: row.grantor,
      privilege: row.privilege,
      grantable: row.grantable,
    });
  }
  requireGate(targeted.size === 2, 'acl-evidence-invalid');
  for (const row of targeted.values()) {
    row.grants.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'));
    columns.push(row);
  }
  categories.columns = columns.sort((a, b) =>
    canonicalJson(a).localeCompare(canonicalJson(b), 'en'),
  );
  return hash(
    canonicalJson({
      identity: baseline.identity,
      backup: baseline.backup,
      categories,
      roleStateFingerprint,
    }),
  );
}

export async function inspectEditorialCapabilities(client) {
  const result = await client.query(`/* editorial-capability:state */ SELECT
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','publication_basis','SELECT') AS "writerBasisSelect",
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','publication_basis','INSERT') AS "writerBasisInsert",
    has_column_privilege('hzense_editorial_writer','public.signal_generation_runs','snapshot','SELECT') AS "writerSnapshotSelect",
    has_column_privilege('hzense_editorial_reader','public.editorial_public_signals','publication_basis','SELECT') AS "readerBasisSelect",
    encode(sha256(convert_to(jsonb_build_object(
      'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.rolname) FROM pg_catalog.pg_roles r),
      'settings',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole),'[]'::jsonb) FROM pg_catalog.pg_db_role_setting s)
    )::text,'UTF8')),'hex') AS "roleStateFingerprint"`);
  return result.rows[0];
}

async function productionDependencies(env) {
  const connection = await import('../../packages/database/src/connection-policy.mjs');
  const preflight = await import('../../packages/database/src/preflight.mjs');
  const migrations = await import('../../packages/database/src/migrate.mjs');
  const acl = await import('../../packages/database/src/runtime-acl-baseline.mjs');
  const { assertDirectTopicSyncEndpoint } =
    await import('../../packages/database/src/topic-sync-preflight.mjs');
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  const require = createRequire(new URL('../../packages/database/package.json', import.meta.url));
  const { Client } = require('pg');
  return {
    ...connection,
    ...preflight,
    ...migrations,
    ...acl,
    verifyDatabaseContract,
    assertDirectTopicSyncEndpoint,
    inspectCapabilities: inspectEditorialCapabilities,
    options: connection.productionDatabaseOptions(env),
    createClient: (options) => new Client(options),
    readRoleUpgradeSql: () =>
      readFile(
        new URL('../../db/roles/upgrade_editorial_publication_writer.sql', import.meta.url),
        'utf8',
      ),
  };
}

/** Hosted dispatcher supplies run-bound approval, recovery evidence and main CI. */
export async function executeEditorialCapabilityMaintenance(
  env,
  { operation, approval },
  context,
  injectedDependencies,
) {
  let mayHaveCommitted = false;
  const step = async (phase, work) => {
    try {
      return await work();
    } catch (error) {
      throw new EditorialCapabilityMaintenanceError(error, operation, mayHaveCommitted, phase);
    }
  };
  const fresh = () => step('freshness-check', () => context.checkFreshness());
  const approved = () => step('approval-check', () => context.checkApproval());
  try {
    requireGate(operations.has(operation), 'operation-required');
    requireGate(
      typeof context?.checkFreshness === 'function' && typeof context?.checkApproval === 'function',
      'context-required',
    );
    const applying = operation === 'editorial-capability-grant';
    await fresh();
    const deps = await step(
      'dependencies',
      () => injectedDependencies ?? productionDependencies(env),
    );
    const options = deps.options;
    const policy = await step('owner-target', () => {
      const target = deps.validateConnectionTarget(options);
      deps.assertDirectTopicSyncEndpoint(target.host);
      return target;
    });
    const backupReference = await step('initialization', () =>
      deps.runtimeAclBackupReference(env.MAINTENANCE_BACKUP_ID),
    );
    const binding = {
      backupIdSha256: hash(env.MAINTENANCE_BACKUP_ID),
      targetFingerprint: hash(
        `hzense/editorial-capability-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, policy.database, policy.user])}`,
      ),
      roleUpgradeSha256: editorialCapabilityRoleUpgradeSha256,
    };
    const migrations = await step('migration-manifest', async () => {
      const rows = await deps.loadMigrations();
      await deps.verifyMigrationManifest(rows);
      binding.manifestFingerprint = assertEditorialCapabilityManifest(rows);
      return rows;
    });
    const sql = await step('role-script', async () =>
      editorialCapabilityRoleUpgradeSql(await deps.readRoleUpgradeSql()),
    );
    const schema = await step('schema-verification', async () => {
      const result = await deps.verifyDatabaseContract(options);
      requireGate(
        result.migrationCount === migrations.length && result.tableCount === 58,
        'reviewed-schema-required',
      );
      return result;
    });

    const session = async (work, lock = false) => {
      await fresh();
      const client = await step('owner-connect', () =>
        deps.createClient({
          connectionString: options.connectionString,
          application_name: 'hzense-editorial-capability-maintenance',
          connectionTimeoutMillis: 10000,
          query_timeout: 60000,
        }),
      );
      let failed = false,
        locked = false,
        connectionFailure;
      client.on('error', (error) => {
        failed = true;
        connectionFailure = error;
      });
      const healthy = () => {
        if (!failed) return;
        const error = new EditorialCapabilityMaintenanceError(
          connectionFailure,
          operation,
          mayHaveCommitted,
          'owner-session',
        );
        error.gate = 'connection-failed';
        throw error;
      };
      try {
        await step('owner-connect', () => client.connect());
        await step('owner-session', async () => {
          healthy();
          await client.query("SET statement_timeout='30s'");
          await client.query("SET lock_timeout='5s'");
          await client.query("SET idle_in_transaction_session_timeout='90s'");
        });
        if (lock)
          await step('maintenance-lock', async () => {
            locked =
              (
                await client.query(
                  'SELECT pg_try_advisory_lock($1,$2) AS locked',
                  deps.migrationLockKeys,
                )
              ).rows[0]?.locked === true;
            requireGate(locked, 'migration-lock-required');
          });
        await step('owner-preflight', async () => {
          const result = await deps.inspectDatabasePreflight(client, {
            ...options,
            expectedHost: policy.host,
          });
          requireGate(
            result.database === policy.database &&
              result.user === policy.user &&
              Array.isArray(result.pendingMigrations) &&
              result.pendingMigrations.length === 0,
            'applied-schema-required',
          );
          healthy();
        });
        const result = await work(client, healthy);
        healthy();
        return result;
      } finally {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* Never mask first failure. */
        }
        if (locked)
          try {
            await client.query('SELECT pg_advisory_unlock($1,$2)', deps.migrationLockKeys);
          } catch {
            /* Closing releases lock. */
          }
        try {
          await client.end();
        } catch {
          /* Preserve the real COMMIT boundary. */
        }
      }
    };
    const snapshot = (client, healthy) =>
      step('acl-baseline', async () => {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        let failed = false;
        try {
          await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
          await client.query("SET LOCAL hzense.editorial_capability_operation='plan'");
          await step('role-preflight', () => client.query(editorialCapabilityRoleUpgradeSql(sql)));
          return await step('acl-baseline', async () => {
            const raw = await deps.inspectRuntimeAclBaseline(client, {
              expectedDatabase: policy.database,
              expectedUser: policy.user,
              expectedPostgresMajor: options.expectedPostgresMajor,
              backupReference,
            });
            const baseline = deps.buildRuntimeAclBaseline({
              identity: raw.identity,
              categories: Object.fromEntries(
                Object.entries(raw.categories).map(([name, item]) => [name, item.records]),
              ),
              capturedAt: raw.capturedAt,
              backupReference,
            });
            requireGate(baseline.fingerprint === raw.fingerprint, 'acl-evidence-invalid');
            const capabilities = await deps.inspectCapabilities(client);
            requireGate(
              capabilities &&
                [
                  'writerBasisSelect',
                  'writerBasisInsert',
                  'writerSnapshotSelect',
                  'readerBasisSelect',
                ].every((key) => typeof capabilities[key] === 'boolean'),
              'capability-state-invalid',
            );
            requireGate(capabilities.readerBasisSelect === true, 'reader-capability-required');
            const granted = [
              'writerBasisSelect',
              'writerBasisInsert',
              'writerSnapshotSelect',
            ].filter((key) => capabilities[key]).length;
            requireGate(granted === 0 || granted === 3, 'partial-writer-capabilities');
            healthy();
            return editorialCapabilityPlan({
              ...binding,
              aclFingerprint: baseline.fingerprint,
              unchangedAclFingerprint: editorialUnchangedAclFingerprint(
                baseline,
                capabilities.roleStateFingerprint,
              ),
              writerMissingCount: 3 - granted,
            });
          });
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          if (failed)
            try {
              await client.query('ROLLBACK');
            } catch {
              /* Preserve first failure. */
            }
          else await client.query('ROLLBACK');
        }
      });
    let original;
    if (!applying) {
      original = await session(snapshot);
      const second = await session(snapshot);
      await step('acl-baseline', () =>
        requireGate(original.planFingerprint === second.planFingerprint, 'acl-baseline-changed'),
      );
      await fresh();
      return {
        ...schema,
        ...original,
        writerGrantedCount: 3 - original.writerMissingCount,
        readerUnchanged: true,
        committed: false,
        previewOnly: true,
        verificationCompleted: false,
        roleUpgradeCompleted: false,
      };
    }
    requireGate(
      approval?.operation === operation &&
        approval.roleUpgradeApproved === true &&
        approval.publicationFreezeConfirmed === true &&
        (!approval.recoveryPolicy || approval.recoveryPolicy === 'verified'),
      'approval-required',
    );
    await approved();
    await session(async (client, healthy) => {
      original = await snapshot(client, healthy);
      await step('plan-approval', () =>
        requireGate(
          Object.entries(original).every(([key, value]) => approval[key] === value),
          'plan-binding-required',
        ),
      );
      await fresh();
      await approved();
      healthy();
      await step('grant', async () => {
        await client.query('BEGIN');
        await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
        await client.query("SET LOCAL hzense.editorial_capability_operation='grant'");
        await client.query(editorialCapabilityRoleUpgradeSql(sql));
        healthy();
      });
      await fresh();
      await approved();
      healthy();
      await step('commit', async () => {
        mayHaveCommitted = true;
        await client.query('COMMIT');
        healthy();
      });
    }, true);
    const verified = await step('independent-verification', () => session(snapshot));
    await step('independent-verification', () => {
      requireGate(verified.writerMissingCount === 0, 'verification-required');
      requireGate(
        verified.unchangedAclFingerprint === original.unchangedAclFingerprint,
        'unrelated-acl-changed',
      );
    });
    await step('schema-verification', async () => {
      const finalSchema = await deps.verifyDatabaseContract(options);
      requireGate(
        finalSchema.migrationCount === 33 && finalSchema.tableCount === 58,
        'reviewed-schema-required',
      );
    });
    await fresh();
    return {
      ...schema,
      ...original,
      verifiedAclFingerprint: verified.aclFingerprint,
      writerGrantedCount: 3,
      readerUnchanged: true,
      committed: true,
      previewOnly: false,
      roleUpgradeCompleted: true,
      verificationCompleted: true,
    };
  } catch (error) {
    throw new EditorialCapabilityMaintenanceError(error, operation, mayHaveCommitted);
  }
}
