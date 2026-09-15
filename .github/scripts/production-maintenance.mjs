import console from 'node:console';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const maintenanceOperations = Object.freeze([
  'preflight',
  'migrate',
  'verify',
  'search-dry-run',
  'search-apply',
  'runtime-preflight',
  'acl-capture',
]);
const writes = new Set(['migrate', 'search-apply']);
const digest = /^[a-f0-9]{64}$/;
const unverifiedRecoveryPolicy = 'accept-unverified-fts1';
const aiConfigRecoveryPolicy = 'accept-unverified-ai-config';
const importTasksRecoveryPolicy = 'accept-unverified-import-tasks';

// A reviewed one-time rollout boundary, NOT the moving repository manifest.
// Keep historical checksums pinned too, so approval identifies the complete
// migration artifact. Future migrations need their own review and policy.
const aiConfigManifest = Object.freeze(
  [
    ['0000_foundation.sql', 'a0a2285225ff14a62ee67aed18d8cceb01d12f2320f45c4bbd1f0d58adc20d30'],
    ['0001_radar_evidence.sql', '508139859e91cd5e3e7baf0cae28bf685a307679fc7d0e95729557f581946df3'],
    [
      '0002_topic_projection.sql',
      '150bc65eaf878306a868c5cc4dee06fd39433a0aa65c301d3e8c702134ea57f6',
    ],
    [
      '0003_search_documents_fts.sql',
      '98fec22c9a74bf237d82172f77d3d2da4b1a6942678deca8f5b29a4c78907261',
    ],
    [
      '0004_signal_version_foundation.sql',
      'caab5e3b1827eec0fe5410c6935b71c4142e09fcb6a66029d225d3f841e4ad2e',
    ],
    [
      '0005_person_organization_affiliations.sql',
      '0504823486759d05d604b0f9eefa94d6c2010c233cd6367658908d3d39b01ad8',
    ],
    [
      '0006_signal_event_identity.sql',
      '1dcef8dd9ab4e34f994a1e506f8a5a9685a412409e15db02766bc4215ae3740f',
    ],
    [
      '0007_signal_version_immutability.sql',
      'd076f9da8dd979a2bca4f54d4ed686783323dde29aa9f94bf7adeaf7b8fdd0ef',
    ],
    [
      '0008_signal_publication_outbox.sql',
      'a1117fda9894ba6590d66c25195af6c3db700c0a0653170fe975c8af4ad4a75a',
    ],
    [
      '0009_signal_publication_controls.sql',
      '6234a3419df037c66986b441c594f605c2d907d5236f2101df0bb2ee8087286a',
    ],
    [
      '0010_qualified_signal_publication.sql',
      '6e56ba4f9706ea62b36235a7acfad1b546826386abdc2bc772c5332a457b069d',
    ],
    [
      '0011_signal_candidate_verification.sql',
      '6db9b93e6ee52b886331755ec58fb6659258ac983e1ab149245143b1ff6572c6',
    ],
    [
      '0012_current_signal_publication.sql',
      '685527bdc4502c1c12a2cbbc00bb0d99a702f3a26f8caa5425498d132f3f955b',
    ],
    [
      '0013_ai_configuration.sql',
      'b97d5aead8c2e954b5b96a37f708ad12fb5cea830275f5775ead6724fc4612b7',
    ],
  ].map((entry) => Object.freeze(entry)),
);

// Domain separation and ordered tuples make both fingerprints reproducible.
// Empty plans are deliberately refused: use the independent verify operation.
export function aiConfigMigrationPlan(pendingMigrations, migrations) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === aiConfigManifest.length &&
      Array.from(migrations).every(
        (migration, index) =>
          migration?.name === aiConfigManifest[index][0] &&
          migration?.checksum === aiConfigManifest[index][1] &&
          typeof migration?.sql === 'string' &&
          createHash('sha256').update(migration.sql).digest('hex') === aiConfigManifest[index][1],
      ),
    'ai-config-migration-manifest-required',
  );
  const approved = aiConfigManifest.slice(4);
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length > 0 &&
      pendingMigrations.length <= approved.length &&
      Array.from(pendingMigrations).every(
        (name, index) => name === approved[approved.length - pendingMigrations.length + index][0],
      ),
    'ai-config-migration-scope-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/ai-config-migration-manifest/v1\0')
    .update(JSON.stringify(aiConfigManifest))
    .digest('hex');
  const planFingerprint = createHash('sha256')
    .update('hzense/ai-config-migration-plan/v1\0')
    .update(JSON.stringify({ manifestFingerprint, pendingMigrations }))
    .digest('hex');
  return { manifestFingerprint, planFingerprint };
}

export function requireAiConfigMigrationScope(preflight, migrations, approval) {
  const plan = aiConfigMigrationPlan(preflight?.pendingMigrations, migrations);
  requireGate(
    approval?.manifestFingerprint === plan.manifestFingerprint &&
      approval?.planFingerprint === plan.planFingerprint,
    'ai-config-migration-plan-mismatch',
  );
  return plan;
}

// New, independently reviewed boundary. Never widen the historical AI approval.
const importTasksManifest = Object.freeze([
  ...aiConfigManifest,
  Object.freeze([
    '0014_import_tasks.sql',
    'ae84c8eb9c212c48bde256eda199238f8d43579f2caa969b76fcc248709eda8a',
  ]),
]);
export function importTasksTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'import-tasks-target-required',
  );
  requireGate(
    typeof backupId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/import-tasks-target/v1\0')
      .update(
        JSON.stringify([
          policy.host.toLowerCase(),
          policy.port,
          preflight.database,
          preflight.user,
        ]),
      )
      .digest('hex'),
    backupIdSha256: createHash('sha256').update(backupId).digest('hex'),
  };
}
export function importTasksMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === importTasksManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === importTasksManifest[index][0] &&
          entry?.checksum === importTasksManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') === importTasksManifest[index][1],
      ),
    'import-tasks-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      pendingMigrations[0] === '0014_import_tasks.sql',
    'import-tasks-migration-scope-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/import-tasks-migration-manifest/v1\0')
    .update(JSON.stringify(importTasksManifest))
    .digest('hex');
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'import-tasks-target-required',
  );
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/import-tasks-migration-plan/v2\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireImportTasksMigrationScope(preflight, migrations, approval, binding) {
  const plan = importTasksMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    approval?.manifestFingerprint === plan.manifestFingerprint &&
      approval?.planFingerprint === plan.planFingerprint &&
      approval?.targetFingerprint === plan.targetFingerprint &&
      approval?.backupIdSha256 === plan.backupIdSha256,
    'import-tasks-migration-plan-mismatch',
  );
  return plan;
}

// Explicit exception, not fabricated evidence of a successful restore. The
// protected Environment review remains the authority; these are declarations.
function validateRecoveryPolicy(approval, operation) {
  const policy = Object.hasOwn(approval, 'recoveryPolicy') ? approval.recoveryPolicy : 'verified';
  requireGate(
    policy === 'verified' ||
      policy === unverifiedRecoveryPolicy ||
      policy === aiConfigRecoveryPolicy ||
      policy === importTasksRecoveryPolicy,
    'unsupported-recovery-policy',
  );
  if (policy === 'verified') {
    requireGate(!Object.hasOwn(approval, 'riskAcceptance'), 'conflicting-recovery-approval');
    return policy;
  }
  if (policy === aiConfigRecoveryPolicy || policy === importTasksRecoveryPolicy) {
    if (policy === importTasksRecoveryPolicy)
      requireGate(digest.test(approval.targetFingerprint ?? ''), 'import-tasks-target-required');
    requireGate(
      operation === 'migrate' || operation === 'acl-capture',
      policy === importTasksRecoveryPolicy
        ? 'import-tasks-operation-required'
        : 'ai-config-operation-required',
    );
    if (operation === 'migrate') {
      requireGate(
        typeof approval.manifestFingerprint === 'string' &&
          digest.test(approval.manifestFingerprint) &&
          typeof approval.planFingerprint === 'string' &&
          digest.test(approval.planFingerprint),
        policy === importTasksRecoveryPolicy
          ? 'reviewed-import-tasks-plan-required'
          : 'reviewed-ai-config-plan-required',
      );
    }
  }
  const acceptance = approval.riskAcceptance;
  requireGate(
    approval.backupVerified === false &&
      approval.backupPresenceReviewed === true &&
      approval.restoreRehearsed === false &&
      approval.aclRecoveryReviewed === false &&
      !Object.hasOwn(approval, 'restoreEvidenceFingerprint') &&
      acceptance?.scope ===
        (policy === importTasksRecoveryPolicy
          ? 'import-tasks-production-launch'
          : policy === aiConfigRecoveryPolicy
            ? 'ai-configuration-production-launch'
            : 'fts1-production-launch') &&
      acceptance.accepted === true &&
      acceptance.historicalAclGapAccepted === true &&
      acceptance.acknowledgement === 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
    'explicit-recovery-risk-acceptance-required',
  );
  return policy;
}

export function requireFts1MigrationScope(preflight) {
  requireGate(
    Array.isArray(preflight?.pendingMigrations) &&
      preflight.pendingMigrations.every((name) => name === '0003_search_documents_fts.sql'),
    'fts1-migration-scope-required',
  );
}

function requireGate(condition, gate) {
  if (!condition) throw new MaintenanceGateError(gate);
}

// An operator-reviewed retention declaration, not a provider API verification.
// Never infer non-expiration from a missing/invalid date or accept both modes.
function backupCoversApproval(approval, expiry) {
  if (approval.backupNeverExpires === true) {
    return !Object.hasOwn(approval, 'backupExpiresAt');
  }
  if (Object.hasOwn(approval, 'backupNeverExpires') && approval.backupNeverExpires !== false) {
    return false;
  }
  return (
    typeof approval.backupExpiresAt === 'string' && Date.parse(approval.backupExpiresAt) > expiry
  );
}

export class MaintenanceGateError extends Error {
  constructor(gate) {
    super(gate);
    this.gate = gate;
  }
}

// This entry point belongs to the hosted workflow, not an operator's terminal.
export function validateMaintenanceRequest(env, now = Date.now()) {
  requireGate(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_REPOSITORY === 'hzense/tech-intelligence-hub' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REF === 'refs/heads/main' &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      /^\d+$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? ''),
    'hosted-main-dispatch-required',
  );
  const operation = env.MAINTENANCE_OPERATION;
  requireGate(maintenanceOperations.includes(operation), 'unsupported-operation');
  requireGate(!env.HZENSE_DATABASE_BASELINE_CHECKSUM, 'baseline-adoption-forbidden');
  if (!writes.has(operation) && operation !== 'acl-capture') return { operation };

  let approval;
  try {
    approval = JSON.parse(env.MAINTENANCE_APPROVAL ?? '');
  } catch {
    throw new MaintenanceGateError('write-approval-required');
  }
  requireGate(approval && typeof approval === 'object', 'write-approval-required');
  requireGate(
    approval.operation === operation &&
      approval.sha === env.GITHUB_SHA &&
      approval.runId === env.GITHUB_RUN_ID &&
      approval.runAttempt === env.GITHUB_RUN_ATTEMPT,
    'approval-run-mismatch',
  );
  const expiry = Date.parse(approval.expiresAt);
  requireGate(
    Number.isFinite(expiry) && expiry > now && expiry <= now + 24 * 60 * 60 * 1000,
    'approval-expired-or-too-long',
  );
  const recoveryPolicy = validateRecoveryPolicy(approval, operation);
  requireGate(
    (recoveryPolicy !== 'verified' || approval.backupVerified === true) &&
      approval.ddlFreezeConfirmed === true &&
      backupCoversApproval(approval, expiry),
    'recovery-evidence-required',
  );
  if (operation === 'acl-capture') {
    requireGate(
      approval.publicArchiveApproved === true &&
        approval.archiveRepository === 'hzense/tech-intelligence-hub',
      'public-acl-archive-approval-required',
    );
  } else if (recoveryPolicy !== 'verified') {
    requireGate(digest.test(approval.aclFingerprint ?? ''), 'recovery-evidence-required');
  } else {
    requireGate(
      approval.restoreRehearsed === true &&
        approval.aclRecoveryReviewed === true &&
        digest.test(approval.aclFingerprint ?? '') &&
        digest.test(approval.restoreEvidenceFingerprint ?? ''),
      'recovery-evidence-required',
    );
  }
  const backupId = env.MAINTENANCE_BACKUP_ID;
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ) &&
      approval.backupIdSha256 === createHash('sha256').update(backupId).digest('hex'),
    'reviewed-backup-required',
  );
  if (operation === 'search-apply') {
    requireGate(
      digest.test(approval.projectionFingerprint ?? '') &&
        digest.test(approval.planFingerprint ?? ''),
      'reviewed-search-plan-required',
    );
  }
  return { operation, approval };
}

// Called only with a validated request. Keep artifact and log declarations equal;
// never accept recovery status or arbitrary fields from a database executor.
export function publicRecoveryAcceptance(request, rawApproval) {
  if (
    (writes.has(request.operation) || request.operation === 'acl-capture') &&
    [unverifiedRecoveryPolicy, aiConfigRecoveryPolicy, importTasksRecoveryPolicy].includes(
      request.approval?.recoveryPolicy,
    )
  ) {
    return {
      recoveryPolicy: request.approval.recoveryPolicy,
      recoveryVerified: false,
      riskAcceptanceSha256: createHash('sha256').update(rawApproval).digest('hex'),
    };
  }
  return {};
}

// Allowlist types too: a database error or document ID must never become a log.
export function publicMaintenanceResult(operation, result = {}) {
  const summary = { operation, status: 'succeeded' };
  for (const key of [
    'migrationCount',
    'tableCount',
    'desiredCount',
    'inserted',
    'updated',
    'deleted',
    'unchanged',
  ]) {
    if (Number.isSafeInteger(result[key]) && result[key] >= 0) summary[key] = result[key];
  }
  for (const key of [
    'fingerprint',
    'planFingerprint',
    'manifestFingerprint',
    'targetFingerprint',
    'backupIdSha256',
  ]) {
    if (typeof result[key] === 'string' && digest.test(result[key])) summary[key] = result[key];
  }
  if (typeof result.committed === 'boolean') summary.committed = result.committed;
  if (Array.isArray(result.pendingMigrations)) {
    summary.pendingMigrationCount = result.pendingMigrations.length;
  }
  return summary;
}

export function publicMaintenanceFailure(error) {
  if (error instanceof MaintenanceGateError) return { status: 'blocked', gate: error.gate };
  return {
    status: 'failed',
    category: 'database-or-contract-check-failed',
    ...(typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
      ? { sqlstate: error.code }
      : {}),
  };
}

// Only Node built-ins run before this check. Never follow a redirect with the token,
// accept an older successful run, or expose GitHub response bodies in public logs.
export async function verifyMaintenanceFreshness(env, { fetchImpl = globalThis.fetch } = {}) {
  requireGate(
    env.GITHUB_REPOSITORY === 'hzense/tech-intelligence-hub' &&
      env.GITHUB_REF === 'refs/heads/main' &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      (!env.GITHUB_API_URL || env.GITHUB_API_URL === 'https://api.github.com'),
    'github-preflight-target-invalid',
  );
  requireGate(
    typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.trim().length > 0,
    'github-preflight-token-required',
  );
  const root = 'https://api.github.com/repos/hzense/tech-intelligence-hub';
  async function readJson(path) {
    try {
      const response = await fetchImpl(`${root}/${path}`, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: globalThis.AbortSignal.timeout(10_000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GH_TOKEN}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
      requireGate(response.status === 200, 'github-preflight-unavailable');
      return await response.json();
    } catch {
      throw new MaintenanceGateError('github-preflight-unavailable');
    }
  }
  async function checkHead() {
    const reference = await readJson('git/ref/heads/main');
    requireGate(
      reference?.ref === 'refs/heads/main' &&
        reference?.object?.type === 'commit' &&
        reference?.object?.sha === env.GITHUB_SHA,
      'github-main-head-changed',
    );
  }
  await checkHead();
  const runs = await readJson(
    `actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${env.GITHUB_SHA}&per_page=1`,
  );
  const run = runs?.workflow_runs?.[0];
  requireGate(
    Array.isArray(runs?.workflow_runs) &&
      runs.workflow_runs.length === 1 &&
      Number.isSafeInteger(run?.id) &&
      run.id > 0 &&
      run.path === '.github/workflows/ci.yml' &&
      run.repository?.full_name === env.GITHUB_REPOSITORY &&
      run.head_sha === env.GITHUB_SHA &&
      run.head_branch === 'main' &&
      run.event === 'push' &&
      run.status === 'completed' &&
      run.conclusion === 'success',
    'github-main-ci-not-successful',
  );
  // Catch main advancing while the CI lookup was in flight. This narrows, but
  // cannot atomically eliminate, the race between GitHub and a separate database.
  await checkHead();
}

async function executeOperation(env, { operation, approval }) {
  if (operation === 'acl-capture') {
    let binding;
    if (approval?.recoveryPolicy === importTasksRecoveryPolicy) {
      const { productionDatabaseOptions, validateConnectionTarget } =
        await import('../../packages/database/src/connection-policy.mjs');
      const { runDatabasePreflight } = await import('../../packages/database/src/preflight.mjs');
      const options = productionDatabaseOptions(env);
      binding = importTasksTargetBinding(
        validateConnectionTarget(options),
        await runDatabasePreflight(options),
        env.MAINTENANCE_BACKUP_ID,
      );
      requireGate(
        binding.targetFingerprint === approval.targetFingerprint &&
          binding.backupIdSha256 === approval.backupIdSha256,
        'import-tasks-target-mismatch',
      );
    }
    const { capturePublicAclEvidence } = await import('./public-acl-evidence.mjs');
    return {
      ...(await capturePublicAclEvidence(env, {
        checkApproval: () => validateMaintenanceRequest(env),
      })),
      ...binding,
    };
  }
  if (operation === 'runtime-preflight') {
    const { runRuntimeReaderPreflight, runtimeReaderProductionOptions } =
      await import('../../packages/database/src/runtime-reader-preflight.mjs');
    return runRuntimeReaderPreflight(runtimeReaderProductionOptions(env));
  }
  const { productionDatabaseOptions, validateConnectionTarget } =
    await import('../../packages/database/src/connection-policy.mjs');
  const { runDatabasePreflight, inspectDatabasePreflight } =
    await import('../../packages/database/src/preflight.mjs');
  const options = productionDatabaseOptions(env);
  const policy = validateConnectionTarget(options);
  if (operation === 'preflight') {
    const preflight = await runDatabasePreflight(options);
    const { loadMigrations, verifyMigrationManifest } =
      await import('../../packages/database/src/migrate.mjs');
    const migrations = await loadMigrations();
    await verifyMigrationManifest(migrations);
    try {
      return {
        ...preflight,
        ...importTasksMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          importTasksTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return { ...preflight, ...aiConfigMigrationPlan(preflight.pendingMigrations, migrations) };
    } catch (error) {
      // Generic read-only preflight remains useful outside this one-time rollout;
      // never issue AI approval fingerprints for an empty or out-of-scope plan.
      if (!(error instanceof MaintenanceGateError)) throw error;
      return preflight;
    }
  }
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  if (operation === 'migrate') {
    const { runMigrations, loadMigrations, verifyMigrationManifest } =
      await import('../../packages/database/src/migrate.mjs');
    let approvedPlan;
    let migrationClient;
    async function checkScope(preflight) {
      if (approval?.recoveryPolicy === unverifiedRecoveryPolicy)
        requireFts1MigrationScope(preflight);
      if ([aiConfigRecoveryPolicy, importTasksRecoveryPolicy].includes(approval?.recoveryPolicy)) {
        const migrations = await loadMigrations();
        await verifyMigrationManifest(migrations);
        approvedPlan =
          approval.recoveryPolicy === importTasksRecoveryPolicy
            ? requireImportTasksMigrationScope(
                preflight,
                migrations,
                approval,
                importTasksTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
              )
            : requireAiConfigMigrationScope(preflight, migrations, approval);
      }
    }
    await runMigrations({
      connectionString: options.connectionString,
      beforeMigrate: async (client) => {
        migrationClient = client;
        const preflight = await inspectDatabasePreflight(client, {
          ...options,
          expectedHost: policy.host,
        });
        await checkScope(preflight);
      },
      beforeApply: [
        unverifiedRecoveryPolicy,
        aiConfigRecoveryPolicy,
        importTasksRecoveryPolicy,
      ].includes(approval?.recoveryPolicy)
        ? async (pendingMigrations, artifact) => {
            if (
              [aiConfigRecoveryPolicy, importTasksRecoveryPolicy].includes(approval?.recoveryPolicy)
            ) {
              // The runner freezes this actual execution snapshot before opening
              // its connection. Do not substitute another filesystem reread.
              if (approval.recoveryPolicy === importTasksRecoveryPolicy) {
                // Re-read authenticated identity from the very same connection
                // while holding the migration lock, not from approval fields.
                const current = await inspectDatabasePreflight(migrationClient, {
                  ...options,
                  expectedHost: policy.host,
                });
                approvedPlan = requireImportTasksMigrationScope(
                  { ...current, pendingMigrations },
                  artifact?.migrations,
                  approval,
                  importTasksTargetBinding(policy, current, env.MAINTENANCE_BACKUP_ID),
                );
              } else {
                approvedPlan = requireAiConfigMigrationScope(
                  { pendingMigrations },
                  artifact?.migrations,
                  approval,
                );
              }
            } else {
              requireFts1MigrationScope({ pendingMigrations });
            }
          }
        : undefined,
    });
    return { ...(await verifyDatabaseContract(options)), ...approvedPlan };
  }
  await runDatabasePreflight(options);
  const verification = await verifyDatabaseContract(options);
  if (operation === 'verify') return verification;
  const { runSearchSyncCommand } = await import('../../scripts/sync-search-documents.mjs');
  return runSearchSyncCommand({
    arguments: ['--profile=production', ...(operation === 'search-apply' ? ['--apply'] : [])],
    environment: {
      ...env,
      HZENSE_SEARCH_SYNC_DATABASE_URL: env.DATABASE_DIRECT_URL,
      HZENSE_SEARCH_SYNC_EXPECTED_FINGERPRINT: approval?.projectionFingerprint,
      HZENSE_SEARCH_SYNC_EXPECTED_PLAN_FINGERPRINT: approval?.planFingerprint,
      HZENSE_SEARCH_SYNC_BACKUP_ID: env.MAINTENANCE_BACKUP_ID,
    },
  });
}

export async function runMaintenance(
  env,
  execute = executeOperation,
  { fetchImpl = globalThis.fetch, now = Date.now } = {},
) {
  const snapshot = { ...env };
  validateMaintenanceRequest(snapshot, now());
  const executionEnv = { ...snapshot };
  delete executionEnv.GH_TOKEN;
  // Do not leave the read-only GitHub token available to imported DB dependencies.
  if (env === process.env) delete process.env.GH_TOKEN;
  // Shared CLIs print catalog details and changed IDs; hosted logs are public.
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table'];
  const originals = new Map(methods.map((method) => [method, console[method]]));
  try {
    for (const method of methods) console[method] = () => {};
    await verifyMaintenanceFreshness(snapshot, { fetchImpl });
    // A short-lived write approval may expire during the GitHub requests.
    const request = validateMaintenanceRequest(executionEnv, now());
    const summary = publicMaintenanceResult(
      request.operation,
      await execute(executionEnv, request),
    );
    Object.assign(summary, publicRecoveryAcceptance(request, snapshot.MAINTENANCE_APPROVAL));
    return summary;
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runMaintenance(process.env)
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error) => {
      console.error(JSON.stringify(publicMaintenanceFailure(error)));
      process.exitCode = 1;
    });
}
