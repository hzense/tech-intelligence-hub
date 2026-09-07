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
]);
const writes = new Set(['migrate', 'search-apply']);
const digest = /^[a-f0-9]{64}$/;

function requireGate(condition, gate) {
  if (!condition) throw new MaintenanceGateError(gate);
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
  if (!writes.has(operation)) return { operation };

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
  requireGate(
    approval.backupVerified === true &&
      approval.restoreRehearsed === true &&
      approval.aclRecoveryReviewed === true &&
      approval.ddlFreezeConfirmed === true &&
      digest.test(approval.aclFingerprint ?? '') &&
      digest.test(approval.restoreEvidenceFingerprint ?? '') &&
      Date.parse(approval.backupExpiresAt) > expiry,
    'recovery-evidence-required',
  );
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

async function executeOperation(env, { operation, approval }) {
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
      beforeMigrate: (client) =>
        inspectDatabasePreflight(client, { ...options, expectedHost: policy.host }),
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

export async function runMaintenance(env, execute = executeOperation) {
  const request = validateMaintenanceRequest(env);
  // Shared CLIs print catalog details and changed IDs; hosted logs are public.
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table'];
  const originals = new Map(methods.map((method) => [method, console[method]]));
  try {
    for (const method of methods) console[method] = () => {};
    return publicMaintenanceResult(request.operation, await execute(env, request));
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
