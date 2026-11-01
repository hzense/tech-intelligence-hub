import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

const digest = /^[a-f0-9]{64}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const operations = new Set(['topic-plan', 'topic-apply', 'topic-verify']);
const safeGates = new Set([
  'operation-required',
  'context-required',
  'dedicated-credential-required',
  'dedicated-target-required',
  'applied-schema-required',
  'authoritative-catalog-required',
  'publication-freeze-required',
  'reviewed-plan-required',
  'reviewed-plan-mismatch',
  'reviewed-backup-required',
  'active-seals-present',
  'seals-changed',
  'inventory-invalid',
  'connection-failed',
  'verification-required',
  'catalog-drift',
  'unavailable',
]);
const safePhases = new Set([
  'initialization',
  'freshness-check',
  'approval-check',
  'dependencies',
  'owner-target',
  'dedicated-target',
  'migration-manifest',
  'projection',
  'schema-verification',
  'owner-connect',
  'owner-session',
  'owner-preflight',
  'owner-read',
  'owner-rollback',
  'plan',
  'plan-approval',
  'seal-check',
  'dedicated-connect',
  'dedicated-session',
  'dedicated-preflight',
  'topic-sync',
  'topic-verification',
  'final-plan',
]);
const codeReasons = new Map([
  ['28P01', 'authentication-failed'],
  ['28000', 'authentication-failed'],
  ['42501', 'permission-denied'],
  ['53300', 'connection-limit'],
  ['57014', 'query-cancelled'],
  ['55P03', 'lock-unavailable'],
  ['40001', 'serialization-failed'],
  ['40P01', 'deadlock'],
  ['ECONNRESET', 'connection-failed'],
  ['ECONNREFUSED', 'connection-failed'],
  ['ENOTFOUND', 'dns-failed'],
  ['EAI_AGAIN', 'dns-failed'],
  ['ETIMEDOUT', 'timeout'],
  ...[
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ].map((code) => [code, 'tls-validation-failed']),
]);
const roleReasonPrefixes = new Map([
  ['Topic sync role must be LOGIN and NOINHERIT', 'role-login-inherit-invalid'],
  ['Topic sync role connection limit mismatch;', 'role-connection-limit-invalid'],
  ['Topic sync role has elevated PostgreSQL role attributes', 'role-attributes-invalid'],
  ['Topic sync role must not own the target database', 'role-owner-invalid'],
  ['Topic sync role requires CONNECT only,', 'role-database-privileges-invalid'],
  ['Topic sync role requires public schema USAGE', 'role-schema-privileges-invalid'],
  ['Topic sync role lacks USAGE on public.topic_status', 'role-type-privileges-invalid'],
  ['Topic sync role must not inherit or be able to SET ROLE', 'role-membership-invalid'],
  ['Topic sync role has privileges on extra schemas:', 'role-schema-privileges-invalid'],
  ['Topic sync role privileges on ', 'role-table-privileges-invalid'],
  ['Topic sync role must not hold grant options on ', 'role-table-privileges-invalid'],
  ['Topic sync role has privileges on unrelated tables:', 'role-table-privileges-invalid'],
  ['Topic sync role must not receive column-level privileges:', 'role-column-privileges-invalid'],
  ['Topic sync role must not own schema objects:', 'role-object-ownership-invalid'],
  [
    'Topic sync role must not execute SECURITY DEFINER routines:',
    'role-routine-privileges-invalid',
  ],
  ['Topic sync role must not have sequence privileges', 'role-sequence-privileges-invalid'],
  [
    'Topic sync role must not receive future table or sequence default privileges',
    'role-default-privileges-invalid',
  ],
  ['Topic sync public relation ', 'relation-contract-invalid'],
  ['Topic sync current public Signal view relation ', 'relation-contract-invalid'],
  ['Topic sync Signal immutability contract mismatch:', 'immutability-contract-invalid'],
]);
const safeReasons = new Set([
  ...codeReasons.values(),
  ...roleReasonPrefixes.values(),
  'tls-policy-invalid',
  'connection-policy-invalid',
  'projection-drift',
  'unavailable',
]);
const ownValue = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.value;
// Only recognize local validators' fixed message families. Neither messages nor
// arbitrary driver codes are emitted, including from nested errors or getters.
function safeReason(error, phase) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'unavailable';
  const code = ownValue(error, 'code');
  if (typeof code === 'string' && codeReasons.has(code)) return codeReasons.get(code);
  const message = ownValue(error, 'message');
  if (typeof message !== 'string') return 'unavailable';
  if (phase === 'owner-target' || phase === 'dedicated-target') {
    if (
      message === 'Production database URL must set sslmode=verify-full exactly once' ||
      message === 'Production database connections refuse NODE_TLS_REJECT_UNAUTHORIZED=0'
    )
      return 'tls-policy-invalid';
    if (
      /^(Database connection string |Production database (endpoint|URL identity) |database (connection string|configuration prefix|profile) |Topic sync requires a reviewed direct\/session endpoint)/.test(
        message,
      )
    )
      return 'connection-policy-invalid';
  }
  if (phase === 'dedicated-preflight') {
    for (const [prefix, reason] of roleReasonPrefixes)
      if (message.startsWith(prefix)) return reason;
  }
  if (phase === 'topic-verification' && message.startsWith('Database Topic projection drift:'))
    return 'projection-drift';
  return 'unavailable';
}
class TopicGateError extends Error {
  constructor(gate) {
    super(gate);
    this.gate = gate;
  }
}
const requireGate = (condition, gate) => {
  if (!condition) throw new TopicGateError(gate);
};

/** Only fixed diagnostic labels cross the public maintenance boundary. */
export class TopicMaintenanceError extends Error {
  constructor(error, operation, mayHaveCommitted, phase = 'initialization') {
    super('Topic maintenance stopped');
    this.operation = operations.has(operation) ? operation : 'topic-plan';
    this.mayHaveCommitted = mayHaveCommitted === true;
    const wrapped = error instanceof TopicMaintenanceError;
    const observedGate =
      wrapped || error instanceof TopicGateError ? ownValue(error, 'gate') : undefined;
    this.gate = safeGates.has(observedGate) ? observedGate : 'unavailable';
    const observedPhase = wrapped ? ownValue(error, 'phase') : phase;
    this.phase = safePhases.has(observedPhase) ? observedPhase : 'initialization';
    const reason = wrapped ? ownValue(error, 'reason') : safeReason(error, this.phase);
    this.reason = safeReasons.has(reason) ? reason : 'unavailable';
  }
}

async function productionDependencies(env) {
  const connection = await import('../../packages/database/src/connection-policy.mjs');
  const preflight = await import('../../packages/database/src/preflight.mjs');
  const migrations = await import('../../packages/database/src/migrate.mjs');
  const topics = await import('../../packages/database/src/topic-sync.mjs');
  const topicPreflight = await import('../../packages/database/src/topic-sync-preflight.mjs');
  const topicVerification = await import('../../packages/database/src/topic-projection-verify.mjs');
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  const content = await import('../../packages/content/dist/src/index.js');
  const databaseRequire = createRequire(
    new URL('../../packages/database/package.json', import.meta.url),
  );
  const { Client } = databaseRequire('pg');
  const contentRoot = fileURLToPath(new URL('../../content/', import.meta.url));
  const seedRoot = fileURLToPath(new URL('../../data/seed/', import.meta.url));
  const taxonomyFile = fileURLToPath(new URL('../../data/taxonomy/taxonomy.yaml', import.meta.url));
  await content.loadContent({ contentRoot, seedRoot, taxonomyFile });
  const catalog = await content.loadSeedCatalog(seedRoot, taxonomyFile);
  return {
    ...connection,
    ...preflight,
    ...migrations,
    ...topics,
    ...topicPreflight,
    ...topicVerification,
    verifyDatabaseContract,
    desiredTopics: content.buildTopicDatabaseProjection(catalog.taxonomy, catalog.topics),
    options: connection.productionDatabaseOptions(env),
    createClient: (options) => new Client(options),
  };
}

const readTopicsSql = `SELECT id,title,parent_id AS "parentId",status::text AS status,
  runtime_enabled AS "runtimeEnabled" FROM public.topics ORDER BY id`;
const readSealsSql = `SELECT count(*)::text AS total,
  count(*) FILTER (WHERE NOT invalidated)::text AS active
  FROM public.signal_verification_dependency_seals`;
function count(value) {
  requireGate(
    (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= 0,
    'inventory-invalid',
  );
  return Number(value);
}
function summary(plan, state, desiredTopics, manifestFingerprint, targetFingerprint) {
  const roots = desiredTopics.filter((topic) => topic.parentId === null);
  const available = new Set(
    state.rows
      .filter((row) => row.runtimeEnabled && row.status !== 'archived')
      .map((row) => row.id),
  );
  return {
    fingerprint: plan.fingerprint,
    projectionFingerprint: plan.fingerprint,
    planFingerprint: plan.planFingerprint,
    manifestFingerprint,
    targetFingerprint,
    desiredCount: desiredTopics.length,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged.length,
    enabledCount: desiredTopics.filter((row) => row.runtimeEnabled).length,
    rootTopicCount: roots.length,
    currentEnabledCount: available.size,
    missingRootCount: roots.filter((row) => !available.has(row.id)).length,
    activeSealCount: state.activeSealCount,
    sealTotalCount: state.sealTotalCount,
    roleExists: state.roleExists,
  };
}

/**
 * The owner connection only inspects the physical schema and reads a plan.
 * All Topic DML uses the independently validated, restricted Topic sync role.
 * A publication freeze is required because Topic UPDATE invalidates historical
 * verification seals; this runner refuses any active seal rather than silently
 * withdrawing qualified publications. Counts are also checked before commit.
 */
export async function executeTopicMaintenance(env, request, context, injectedDependencies) {
  const { operation, approval } = request;
  let mayHaveCommitted = false;
  // Nested steps preserve the innermost failure, including owner checks made
  // from inside the write transaction. Cleanup cannot reset the COMMIT marker.
  const step = async (phase, work) => {
    try {
      return await work();
    } catch (error) {
      throw new TopicMaintenanceError(error, operation, mayHaveCommitted, phase);
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
    const applying = operation === 'topic-apply';
    if (operation !== 'topic-plan')
      requireGate(
        typeof env.HZENSE_TOPIC_SYNC_DATABASE_URL === 'string' &&
          env.HZENSE_TOPIC_SYNC_DATABASE_URL.trim().length > 0,
        'dedicated-credential-required',
      );
    if (applying) {
      requireGate(approval?.publicationFreezeConfirmed === true, 'publication-freeze-required');
      requireGate(
        [
          'projectionFingerprint',
          'planFingerprint',
          'manifestFingerprint',
          'targetFingerprint',
        ].every((key) => digest.test(approval?.[key] ?? '')),
        'reviewed-plan-required',
      );
      requireGate(
        typeof env.MAINTENANCE_BACKUP_ID === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(env.MAINTENANCE_BACKUP_ID) &&
          approval.backupIdSha256 === hash(env.MAINTENANCE_BACKUP_ID),
        'reviewed-backup-required',
      );
    }
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
    const migrations = await step('migration-manifest', async () => {
      const rows = await deps.loadMigrations();
      await deps.verifyMigrationManifest(rows);
      return rows;
    });
    const manifestFingerprint = hash(
      `hzense/topic-maintenance-manifest/v1\0${JSON.stringify(migrations.map(({ name, checksum }) => [name, checksum]))}`,
    );
    const desiredTopics = await step('projection', () => {
      const rows = deps.normalizeDesiredTopics(deps.desiredTopics);
      requireGate(
        rows.length === 62 &&
          rows.some((row) => row.parentId === null) &&
          rows.filter((row) => row.parentId === null).every((row) => row.runtimeEnabled),
        'authoritative-catalog-required',
      );
      return rows;
    });
    // Include both identities: the owner validates the target, the fixed scoped
    // writer performs DML. No URL or credential becomes part of the public result.
    const targetFingerprint = hash(
      `hzense/topic-maintenance-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, policy.database, policy.user, 'hzense_topic_sync'])}`,
    );
    let scopedOptions;
    if (operation !== 'topic-plan') {
      scopedOptions = {
        ...options,
        connectionString: env.HZENSE_TOPIC_SYNC_DATABASE_URL,
        expectedUser: 'hzense_topic_sync',
        configurationPrefix: 'HZENSE_TOPIC_SYNC',
        expectedConnectionLimit: 2,
      };
      await step('dedicated-target', () => {
        const scopedPolicy = deps.validateConnectionTarget(scopedOptions);
        requireGate(
          scopedPolicy.host === policy.host &&
            scopedPolicy.port === policy.port &&
            scopedPolicy.database === policy.database &&
            scopedPolicy.user === 'hzense_topic_sync',
          'dedicated-target-required',
        );
        deps.assertDirectTopicSyncEndpoint(scopedPolicy.host);
      });
    }
    const session = async (sessionOptions, label, work) => {
      await fresh();
      const prefix = label === 'plan' ? 'owner' : 'dedicated';
      const client = await step(`${prefix}-connect`, () =>
        deps.createClient({
          connectionString: sessionOptions.connectionString,
          application_name: `hzense-topic-${label}`,
          connectionTimeoutMillis: 10_000,
          query_timeout: 60_000,
        }),
      );
      let failure;
      client.on('error', (error) => {
        if (!failure) {
          failure = new TopicMaintenanceError(
            error,
            operation,
            mayHaveCommitted,
            `${prefix}-session`,
          );
          failure.gate = 'connection-failed';
        }
      });
      const healthy = () => {
        if (failure) throw failure;
      };
      try {
        await step(`${prefix}-connect`, () => client.connect());
        healthy();
        await step(`${prefix}-session`, async () => {
          await client.query("SET statement_timeout='60s'");
          await client.query("SET lock_timeout='5s'");
          await client.query("SET idle_in_transaction_session_timeout='90s'");
        });
        const result = await work(client, healthy);
        healthy();
        return result;
      } finally {
        try {
          await client.end();
        } catch {
          /* Connection cleanup must not replace the diagnostic. */
        }
      }
    };
    const inspectOwner = async () =>
      session(options, 'plan', async (client, healthy) => {
        await step('owner-preflight', async () => {
          const preflight = await deps.inspectDatabasePreflight(client, {
            ...options,
            expectedHost: policy.host,
          });
          requireGate(
            preflight.database === policy.database &&
              preflight.user === policy.user &&
              Array.isArray(preflight.pendingMigrations) &&
              preflight.pendingMigrations.length === 0,
            'applied-schema-required',
          );
        });
        await step('owner-read', () =>
          client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'),
        );
        let readFailure;
        try {
          return await step('owner-read', async () => {
            const rows = (await client.query(readTopicsSql)).rows;
            const seals = (await client.query(readSealsSql)).rows[0];
            const roles = (
              await client.query(
                "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hzense_topic_sync') AS present",
              )
            ).rows;
            requireGate(typeof roles[0]?.present === 'boolean', 'inventory-invalid');
            const state = {
              rows,
              activeSealCount: count(seals?.active),
              sealTotalCount: count(seals?.total),
              roleExists: roles[0].present,
            };
            healthy();
            return state;
          });
        } catch (error) {
          readFailure = error;
          throw error;
        } finally {
          // Preserve the original failed read if rollback also fails.
          if (readFailure) {
            try {
              await client.query('ROLLBACK');
            } catch {
              /* Keep the original failed read. */
            }
          } else await step('owner-rollback', () => client.query('ROLLBACK'));
        }
      });
    // The restricted role preflight cannot replace the owner schema contract.
    const verification = await step('schema-verification', () =>
      deps.verifyDatabaseContract(options),
    );
    const initialState = await inspectOwner();
    const initialPlan = await step('plan', () =>
      deps.planTopicSync(desiredTopics, initialState.rows),
    );
    const initialSummary = summary(
      initialPlan,
      initialState,
      desiredTopics,
      manifestFingerprint,
      targetFingerprint,
    );
    if (operation === 'topic-plan')
      return {
        ...initialSummary,
        migrationCount: verification.migrationCount,
        tableCount: verification.tableCount,
        previewOnly: true,
        committed: false,
      };

    if (applying) {
      await step('plan-approval', () =>
        requireGate(
          approval.projectionFingerprint === initialPlan.fingerprint &&
            approval.planFingerprint === initialPlan.planFingerprint &&
            approval.manifestFingerprint === manifestFingerprint &&
            approval.targetFingerprint === targetFingerprint,
          'reviewed-plan-mismatch',
        ),
      );
      await step('seal-check', () =>
        requireGate(initialState.activeSealCount === 0, 'active-seals-present'),
      );
      await session(scopedOptions, 'apply', async (client, healthy) => {
        await step('dedicated-preflight', () =>
          deps.inspectTopicSyncPreflight(client, scopedOptions),
        );
        await fresh();
        await approved();
        healthy();
        const trackedClient = {
          query: async (...args) => {
            if (args[0] === 'COMMIT') mayHaveCommitted = true;
            return client.query(...args);
          },
        };
        const result = await step('topic-sync', () =>
          deps.syncTopics(trackedClient, desiredTopics, {
            dryRun: false,
            expectedProjectionFingerprint: approval.projectionFingerprint,
            expectedPlanFingerprint: approval.planFingerprint,
            beforeVerification: async () => {
              const current = await inspectOwner();
              await step('seal-check', () => {
                requireGate(current.activeSealCount === 0, 'active-seals-present');
                requireGate(
                  current.sealTotalCount === initialState.sealTotalCount,
                  'seals-changed',
                );
              });
              await fresh();
              await approved();
              healthy();
            },
          }),
        );
        await step('topic-sync', () =>
          requireGate(result.committed === true, 'verification-required'),
        );
      });
    }
    const independent = await session(scopedOptions, 'verify', async (client, healthy) => {
      const verified = await step('topic-verification', () =>
        deps.verifyTopicProjectionReadOnly(client, desiredTopics, {
          expectedFingerprint: initialPlan.fingerprint,
          expectedCount: 62,
          beforeRead: (connected) =>
            step('dedicated-preflight', () =>
              deps.inspectTopicSyncPreflight(connected, {
                ...scopedOptions,
                expectedTransactionReadOnly: true,
              }),
            ),
        }),
      );
      healthy();
      return verified;
    });
    await step('topic-verification', () =>
      requireGate(independent.verified === true, 'verification-required'),
    );
    const finalState = await inspectOwner();
    const finalPlan = await step('final-plan', () =>
      deps.planTopicSync(desiredTopics, finalState.rows),
    );
    await step('final-plan', () =>
      requireGate(
        finalPlan.inserts.length === 0 && finalPlan.updates.length === 0,
        'catalog-drift',
      ),
    );
    await fresh();
    return {
      ...summary(finalPlan, finalState, desiredTopics, manifestFingerprint, targetFingerprint),
      ...(applying
        ? {
            inserted: initialPlan.inserts.length,
            updated: initialPlan.updates.length,
            unchanged: initialPlan.unchanged.length,
            planFingerprint: initialPlan.planFingerprint,
          }
        : {}),
      migrationCount: verification.migrationCount,
      tableCount: verification.tableCount,
      previewOnly: false,
      verificationCompleted: true,
      committed: applying,
    };
  } catch (error) {
    throw new TopicMaintenanceError(error, operation, mayHaveCommitted);
  }
}
