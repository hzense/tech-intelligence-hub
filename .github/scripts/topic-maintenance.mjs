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
  constructor(error, operation, mayHaveCommitted) {
    super('Topic maintenance stopped');
    this.operation = operations.has(operation) ? operation : 'topic-plan';
    this.mayHaveCommitted = mayHaveCommitted;
    this.gate =
      error instanceof TopicGateError && safeGates.has(error.gate) ? error.gate : 'unavailable';
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
    await context.checkFreshness();
    const deps = injectedDependencies ?? (await productionDependencies(env));
    const options = deps.options;
    const policy = deps.validateConnectionTarget(options);
    deps.assertDirectTopicSyncEndpoint(policy.host);
    const migrations = await deps.loadMigrations();
    await deps.verifyMigrationManifest(migrations);
    const manifestFingerprint = hash(
      `hzense/topic-maintenance-manifest/v1\0${JSON.stringify(migrations.map(({ name, checksum }) => [name, checksum]))}`,
    );
    const desiredTopics = deps.normalizeDesiredTopics(deps.desiredTopics);
    requireGate(
      desiredTopics.length === 62 &&
        desiredTopics.some((row) => row.parentId === null) &&
        desiredTopics.filter((row) => row.parentId === null).every((row) => row.runtimeEnabled),
      'authoritative-catalog-required',
    );
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
      const scopedPolicy = deps.validateConnectionTarget(scopedOptions);
      requireGate(
        scopedPolicy.host === policy.host &&
          scopedPolicy.port === policy.port &&
          scopedPolicy.database === policy.database &&
          scopedPolicy.user === 'hzense_topic_sync',
        'dedicated-target-required',
      );
      deps.assertDirectTopicSyncEndpoint(scopedPolicy.host);
    }
    const session = async (sessionOptions, label, work) => {
      await context.checkFreshness();
      const client = deps.createClient({
        connectionString: sessionOptions.connectionString,
        application_name: `hzense-topic-${label}`,
        connectionTimeoutMillis: 10_000,
        query_timeout: 60_000,
      });
      let failed = false;
      client.on('error', () => {
        failed = true;
      });
      const healthy = () => requireGate(!failed, 'connection-failed');
      try {
        await client.connect();
        healthy();
        await client.query("SET statement_timeout='60s'");
        await client.query("SET lock_timeout='5s'");
        await client.query("SET idle_in_transaction_session_timeout='90s'");
        const result = await work(client, healthy);
        healthy();
        return result;
      } finally {
        await client.end().catch(() => undefined);
      }
    };
    const inspectOwner = async () =>
      session(options, 'plan', async (client, healthy) => {
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
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
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
        } finally {
          await client.query('ROLLBACK');
        }
      });
    // The restricted role preflight cannot replace the owner schema contract.
    const verification = await deps.verifyDatabaseContract(options);
    const initialState = await inspectOwner();
    const initialPlan = deps.planTopicSync(desiredTopics, initialState.rows);
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
      requireGate(
        approval.projectionFingerprint === initialPlan.fingerprint &&
          approval.planFingerprint === initialPlan.planFingerprint &&
          approval.manifestFingerprint === manifestFingerprint &&
          approval.targetFingerprint === targetFingerprint,
        'reviewed-plan-mismatch',
      );
      requireGate(initialState.activeSealCount === 0, 'active-seals-present');
      await session(scopedOptions, 'apply', async (client, healthy) => {
        await deps.inspectTopicSyncPreflight(client, scopedOptions);
        await context.checkFreshness();
        await context.checkApproval();
        healthy();
        const trackedClient = {
          query: async (...args) => {
            if (args[0] === 'COMMIT') mayHaveCommitted = true;
            return client.query(...args);
          },
        };
        const result = await deps.syncTopics(trackedClient, desiredTopics, {
          dryRun: false,
          expectedProjectionFingerprint: approval.projectionFingerprint,
          expectedPlanFingerprint: approval.planFingerprint,
          beforeVerification: async () => {
            const current = await inspectOwner();
            requireGate(current.activeSealCount === 0, 'active-seals-present');
            requireGate(current.sealTotalCount === initialState.sealTotalCount, 'seals-changed');
            await context.checkFreshness();
            await context.checkApproval();
            healthy();
          },
        });
        requireGate(result.committed === true, 'verification-required');
      });
    }
    const independent = await session(scopedOptions, 'verify', async (client, healthy) => {
      const verified = await deps.verifyTopicProjectionReadOnly(client, desiredTopics, {
        expectedFingerprint: initialPlan.fingerprint,
        expectedCount: 62,
        beforeRead: (connected) =>
          deps.inspectTopicSyncPreflight(connected, {
            ...scopedOptions,
            expectedTransactionReadOnly: true,
          }),
      });
      healthy();
      return verified;
    });
    requireGate(independent.verified === true, 'verification-required');
    const finalState = await inspectOwner();
    const finalPlan = deps.planTopicSync(desiredTopics, finalState.rows);
    requireGate(finalPlan.inserts.length === 0 && finalPlan.updates.length === 0, 'catalog-drift');
    await context.checkFreshness();
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
