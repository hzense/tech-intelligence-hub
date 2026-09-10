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

// Explicit exception, not fabricated evidence of a successful restore. The
// protected Environment review remains the authority; these are declarations.
function validateRecoveryPolicy(approval) {
  const policy = Object.hasOwn(approval, 'recoveryPolicy') ? approval.recoveryPolicy : 'verified';
  requireGate(
    policy === 'verified' || policy === unverifiedRecoveryPolicy,
    'unsupported-recovery-policy',
  );
  if (policy === 'verified') {
    requireGate(!Object.hasOwn(approval, 'riskAcceptance'), 'conflicting-recovery-approval');
    return policy;
  }
  const acceptance = approval.riskAcceptance;
  requireGate(
    approval.backupVerified === false &&
      approval.backupPresenceReviewed === true &&
      approval.restoreRehearsed === false &&
      approval.aclRecoveryReviewed === false &&
      !Object.hasOwn(approval, 'restoreEvidenceFingerprint') &&
      acceptance?.scope === 'fts1-production-launch' &&
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
  const recoveryPolicy = writes.has(operation) ? validateRecoveryPolicy(approval) : undefined;
  requireGate(
    (recoveryPolicy === unverifiedRecoveryPolicy || approval.backupVerified === true) &&
      approval.ddlFreezeConfirmed === true &&
      backupCoversApproval(approval, expiry),
    'recovery-evidence-required',
  );
  if (operation === 'acl-capture') {
    requireGate(
      !Object.hasOwn(approval, 'recoveryPolicy') && !Object.hasOwn(approval, 'riskAcceptance'),
      'risk-acceptance-write-only',
    );
    requireGate(
      approval.publicArchiveApproved === true &&
        approval.archiveRepository === 'hzense/tech-intelligence-hub',
      'public-acl-archive-approval-required',
    );
  } else if (recoveryPolicy === unverifiedRecoveryPolicy) {
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
  for (const key of ['fingerprint', 'planFingerprint']) {
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
    const { capturePublicAclEvidence } = await import('./public-acl-evidence.mjs');
    return capturePublicAclEvidence(env, {
      checkApproval: () => validateMaintenanceRequest(env),
    });
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
  if (operation === 'preflight') return runDatabasePreflight(options);
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  if (operation === 'migrate') {
    const { runMigrations } = await import('../../packages/database/src/migrate.mjs');
    await runMigrations({
      connectionString: options.connectionString,
      beforeMigrate: async (client) => {
        const preflight = await inspectDatabasePreflight(client, {
          ...options,
          expectedHost: policy.host,
        });
        if (approval?.recoveryPolicy === unverifiedRecoveryPolicy) {
          requireFts1MigrationScope(preflight);
        }
      },
      beforeApply:
        approval?.recoveryPolicy === unverifiedRecoveryPolicy
          ? (pendingMigrations) => requireFts1MigrationScope({ pendingMigrations })
          : undefined,
    });
    return verifyDatabaseContract(options);
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
    if (
      writes.has(request.operation) &&
      request.approval.recoveryPolicy === unverifiedRecoveryPolicy
    ) {
      summary.recoveryPolicy = unverifiedRecoveryPolicy;
      summary.recoveryVerified = false;
      // Only a digest of the protected, run-bound approval; never raw declarations.
      summary.riskAcceptanceSha256 = createHash('sha256')
        .update(snapshot.MAINTENANCE_APPROVAL)
        .digest('hex');
    }
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
