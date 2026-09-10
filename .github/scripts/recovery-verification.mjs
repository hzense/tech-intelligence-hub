import console from 'node:console';
import process from 'node:process';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  MaintenanceGateError,
  publicMaintenanceFailure,
  verifyMaintenanceFreshness,
} from './production-maintenance.mjs';

export const recoveryOperations = Object.freeze([
  'capture-r0',
  'capture-r1',
  'capture-r2',
  'capture-r3',
  'verify-restored',
]);
export const recoveryEvidenceFilename = 'hzense-recovery-verification.json';
const digest = /^[a-f0-9]{64}$/;
const branchId = /^br-[a-z0-9-]{1,56}$/;
const validDigest = (value) =>
  typeof value === 'string' && digest.test(value) && new Set(value).size > 1;
function gate(condition, label) {
  if (!condition) throw new MaintenanceGateError(label);
}

// UTC only, seconds or exactly three fractional digits. Round-trip validation
// rejects Date.parse normalization of impossible calendar dates (e.g. Feb 30).
export function recoveryUtcTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return NaN;
  }
  const timestamp = Date.parse(value);
  const normalized = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === normalized
    ? timestamp
    : NaN;
}

export function validateRecoveryRequest(env, now = Date.now()) {
  gate(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_REPOSITORY === 'hzense/tech-intelligence-hub' &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') &&
      env.GITHUB_WORKFLOW_REF ===
        `hzense/tech-intelligence-hub/.github/workflows/recovery-verification.yml@refs/heads/main`,
    'recovery-hosted-main-required',
  );
  gate(recoveryOperations.includes(env.RECOVERY_OPERATION), 'recovery-operation-invalid');
  // Even accidentally binding the familiar production secrets is an error.
  gate(
    !env.DATABASE_DIRECT_URL && !env.HZENSE_RUNTIME_DATABASE_URL && !env.MAINTENANCE_APPROVAL,
    'recovery-production-credentials-forbidden',
  );
  let approval;
  try {
    approval = JSON.parse(env.RECOVERY_APPROVAL ?? '');
  } catch {
    throw new MaintenanceGateError('recovery-approval-required');
  }
  gate(
    approval && typeof approval === 'object' && !Array.isArray(approval),
    'recovery-approval-required',
  );
  gate(
    approval.operation === env.RECOVERY_OPERATION &&
      approval.sha === env.GITHUB_SHA &&
      approval.runId === env.GITHUB_RUN_ID &&
      approval.runAttempt === env.GITHUB_RUN_ATTEMPT,
    'recovery-approval-run-mismatch',
  );
  const expiry = recoveryUtcTimestamp(approval.expiresAt);
  gate(
    typeof approval.expiresAt === 'string' &&
      Number.isFinite(expiry) &&
      expiry > now &&
      expiry <= now + 3_600_000,
    'recovery-approval-expired',
  );
  gate(
    approval.topologyReviewed === true &&
      approval.ddlFreezeConfirmed === true &&
      approval.publicArchiveApproved === true &&
      approval.archiveRepository === env.GITHUB_REPOSITORY,
    'recovery-review-required',
  );
  gate(
    typeof approval.projectId === 'string' &&
      /^[a-z0-9-]{1,60}$/.test(approval.projectId) &&
      [approval.targetBranchId, approval.sourceBranchId, approval.productionBranchId].every(
        (v) => typeof v === 'string' && branchId.test(v),
      ) &&
      new Set([approval.targetBranchId, approval.sourceBranchId, approval.productionBranchId])
        .size === 3,
    'recovery-isolated-target-required',
  );
  gate(
    [approval.targetFingerprint, approval.sourceFingerprint, approval.productionFingerprint].every(
      validDigest,
    ) &&
      new Set([
        approval.targetFingerprint,
        approval.sourceFingerprint,
        approval.productionFingerprint,
      ]).size === 3,
    'recovery-target-fingerprints-invalid',
  );
  gate(
    typeof approval.targetExpiresAt === 'string' &&
      recoveryUtcTimestamp(approval.targetExpiresAt) > expiry &&
      ((approval.sourceNeverExpires === true && !Object.hasOwn(approval, 'sourceExpiresAt')) ||
        (approval.sourceNeverExpires === false &&
          typeof approval.sourceExpiresAt === 'string' &&
          recoveryUtcTimestamp(approval.sourceExpiresAt) > expiry)),
    'recovery-retention-required',
  );
  gate(
    typeof approval.directHost === 'string' &&
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(approval.directHost) &&
      !approval.directHost.includes('pooler') &&
      approval.runtimeHost === approval.directHost.replace('.', '-pooler.'),
    'recovery-endpoints-invalid',
  );
  if (['capture-r3', 'verify-restored'].includes(approval.operation)) {
    gate(validDigest(approval.r1Fingerprint), 'recovery-r1-fingerprint-required');
  }
  const runtime = approval.operation === 'verify-restored';
  gate(
    runtime
      ? Boolean(env.RECOVERY_RUNTIME_URL) && !env.RECOVERY_OWNER_URL
      : Boolean(env.RECOVERY_OWNER_URL) && !env.RECOVERY_RUNTIME_URL,
    'recovery-scoped-credential-required',
  );
  gate(isAbsolute(env.RUNNER_TEMP ?? ''), 'recovery-runner-temp-required');
  return approval;
}

// Called only after validateRecoveryRequest. Never spread the secret JSON:
// raw project/branch IDs, endpoints and unrecognized fields are not public.
export function publicRecoveryApproval(approval, rawApproval) {
  const summary = {
    format: 'hzense-recovery-approval-summary/v1',
    trust: 'protected-environment-reviewer-declaration',
    recordSha256: createHash('sha256').update(rawApproval, 'utf8').digest('hex'),
  };
  for (const key of [
    'operation',
    'sha',
    'runId',
    'runAttempt',
    'expiresAt',
    'targetExpiresAt',
    'sourceNeverExpires',
    'targetFingerprint',
    'sourceFingerprint',
    'productionFingerprint',
    'topologyReviewed',
    'ddlFreezeConfirmed',
    'publicArchiveApproved',
    'archiveRepository',
  ])
    summary[key] = approval[key];
  if (!approval.sourceNeverExpires) summary.sourceExpiresAt = approval.sourceExpiresAt;
  if (['capture-r3', 'verify-restored'].includes(approval.operation))
    summary.r1Fingerprint = approval.r1Fingerprint;
  return summary;
}

export function assertRecoveryEvidenceSafe(serialized, env, approval) {
  const excluded = [
    env.GH_TOKEN,
    env.RECOVERY_APPROVAL,
    env.RECOVERY_OWNER_URL,
    env.RECOVERY_RUNTIME_URL,
    approval.projectId,
    approval.targetBranchId,
    approval.sourceBranchId,
    approval.productionBranchId,
    approval.directHost,
    approval.runtimeHost,
  ];
  for (const value of [env.RECOVERY_OWNER_URL, env.RECOVERY_RUNTIME_URL].filter(Boolean)) {
    const url = new URL(value);
    excluded.push(url.password, decodeURIComponent(url.password));
  }
  gate(
    !/postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(serialized) &&
      !excluded
        .filter(Boolean)
        .some((v) => [v, JSON.stringify(v).slice(1, -1)].some((part) => serialized.includes(part))),
    'recovery-evidence-unsafe',
  );
}

async function execute(env, approval, guard) {
  const { collectRecoveryVerification } =
    await import('../../packages/database/src/recovery-verification.mjs');
  return collectRecoveryVerification(env, approval, guard);
}

export async function runRecoveryVerification(
  env,
  { now = Date.now, fetchImpl = globalThis.fetch, collect = execute, save = writeFile } = {},
) {
  const snapshot = { ...env };
  validateRecoveryRequest(snapshot, now());
  const executionEnv = { ...snapshot };
  delete executionEnv.GH_TOKEN;
  if (env === process.env) delete process.env.GH_TOKEN;
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table'];
  const originals = new Map(methods.map((method) => [method, console[method]]));
  try {
    for (const method of methods) console[method] = () => {};
    const guard = async () => {
      await verifyMaintenanceFreshness(snapshot, { fetchImpl });
      return validateRecoveryRequest(snapshot, now());
    };
    const approval = await guard();
    const result = await collect(executionEnv, approval, guard);
    await guard();
    const evidence = {
      format: 'hzense-recovery-verification/v1',
      sha: snapshot.GITHUB_SHA,
      runId: snapshot.GITHUB_RUN_ID,
      runAttempt: snapshot.GITHUB_RUN_ATTEMPT,
      operation: approval.operation,
      capturedAt: new Date(now()).toISOString(),
      topology: 'operator-reviewed-not-provider-api-verified',
      restoration: 'not-an-execution-approval-or-complete-rehearsal',
      approval: publicRecoveryApproval(approval, snapshot.RECOVERY_APPROVAL),
      result,
    };
    const serialized = JSON.stringify(evidence, null, 2) + '\n';
    assertRecoveryEvidenceSafe(serialized, snapshot, approval);
    await save(join(snapshot.RUNNER_TEMP, recoveryEvidenceFilename), serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return { operation: approval.operation, status: 'succeeded' };
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runRecoveryVerification(process.env)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify(publicMaintenanceFailure(error)));
      process.exitCode = 1;
    });
}
