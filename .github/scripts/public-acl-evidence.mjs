import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { URL } from 'node:url';
import { publicRecoveryAcceptance } from './production-maintenance.mjs';
import {
  buildRuntimeAclBaseline,
  runRuntimeAclBaselineCapture,
  runtimeAclBaselineProductionOptions,
  runtimeAclBackupReference,
} from '../../packages/database/src/runtime-acl-baseline.mjs';

export const publicAclEvidenceFilename = 'hzense-acl-evidence.json';
// Sequence evidence is scoped to one of two separately reviewed rollouts, never
// an arbitrary risk policy. The archived policy must match the current approval.
const sequenceRecoveryPolicies = Object.freeze([
  'accept-unverified-automation-storage',
  'accept-unverified-automation-config-deletion',
]);

// Reconstruct from the reviewed catalog contract; never serialize the environment,
// transport, raw errors, or arbitrary top-level executor properties.
export function reviewedBaseline(baseline, backupId) {
  const rebuilt = buildRuntimeAclBaseline({
    identity: baseline.identity,
    categories: Object.fromEntries(
      Object.entries(baseline.categories).map(([name, category]) => [name, category.records]),
    ),
    capturedAt: baseline.capturedAt,
    backupReference: runtimeAclBackupReference(backupId),
  });
  if (
    rebuilt.fingerprint !== baseline.fingerprint ||
    JSON.stringify(rebuilt.backup) !== JSON.stringify(baseline.backup)
  ) {
    throw new Error('ACL evidence integrity check failed');
  }
  return rebuilt;
}

export function assertPublicAclEvidenceSafe(serialized, env) {
  const url = new URL(env.DATABASE_DIRECT_URL);
  const excluded = [
    env.DATABASE_DIRECT_URL,
    env.HZENSE_RUNTIME_DATABASE_URL,
    env.MAINTENANCE_BACKUP_ID,
    env.MAINTENANCE_APPROVAL,
    env.GH_TOKEN,
    url.hostname,
    url.password,
    decodeURIComponent(url.password),
  ].filter((value) => typeof value === 'string' && value.length > 0);
  if (
    /postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(serialized) ||
    excluded.some((value) =>
      [value, JSON.stringify(value).slice(1, -1)].some((part) => serialized.includes(part)),
    )
  ) {
    // No rejected value or field path is included in public errors.
    throw new Error('ACL evidence contains excluded material');
  }
}

// Hosted-only caller validates the run-bound disclosure/backup/freeze approval.
// Each capture creates and closes its own read-only connection; neither is a dump.
export async function capturePublicAclEvidence(
  env,
  { checkApproval, capture = runRuntimeAclBaselineCapture, save = writeFile } = {},
) {
  if (typeof checkApproval !== 'function' || !isAbsolute(env.RUNNER_TEMP ?? '')) {
    throw new Error('Hosted ACL evidence context required');
  }
  const requireCaptureApproval = () => {
    const request = checkApproval();
    const standalone = request?.operation === 'acl-capture';
    const sequence =
      request?.operation === 'migrate-and-verify' &&
      sequenceRecoveryPolicies.includes(request.approval?.recoveryPolicy) &&
      request.approval?.aclEvidenceMode === 'capture-in-run' &&
      request.approval?.publicArchiveApproved === true &&
      request.approval?.archiveRepository === 'hzense/tech-intelligence-hub';
    if ((!standalone && !sequence) || request.approval?.operation !== request.operation) {
      throw new Error('Validated ACL capture approval required');
    }
    return request;
  };
  const request = requireCaptureApproval();
  const recovery = publicRecoveryAcceptance(request, env.MAINTENANCE_APPROVAL);
  const options = runtimeAclBaselineProductionOptions({
    ...env,
    HZENSE_RUNTIME_ACL_BACKUP_ID: env.MAINTENANCE_BACKUP_ID,
  });
  const first = reviewedBaseline(await capture(options), env.MAINTENANCE_BACKUP_ID);
  requireCaptureApproval();
  const second = reviewedBaseline(await capture(options), env.MAINTENANCE_BACKUP_ID);
  if (first.fingerprint !== second.fingerprint) {
    throw new Error('Independent ACL captures differ');
  }
  const evidence = {
    format: 'hzense-public-acl-evidence/v1',
    repository: 'hzense/tech-intelligence-hub',
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    disclosureDecision: '2026-09-08-public-acl-archive',
    independentCapturesMatch: true,
    restoration:
      recovery.recoveryVerified === false
        ? 'unverified-risk-accepted'
        : 'manual-review-and-isolated-rehearsal-required',
    ...recovery,
    captures: [first, second],
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assertPublicAclEvidenceSafe(serialized, env);
  requireCaptureApproval();
  // Exact single file, exclusive creation, no shell redirection or env output.
  await save(join(env.RUNNER_TEMP, publicAclEvidenceFilename), serialized, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return { fingerprint: first.fingerprint };
}

// The apply step is reachable only after upload-artifact succeeded in the same
// protected job. Rebuild the local copy instead of trusting a supplied digest.
export async function readPublicAclEvidence(env, { checkApproval, read = readFile } = {}) {
  if (typeof checkApproval !== 'function' || !isAbsolute(env.RUNNER_TEMP ?? '')) {
    throw new Error('Hosted ACL evidence context required');
  }
  const request = checkApproval();
  if (
    request?.operation !== 'migrate-and-verify' ||
    request.approval?.operation !== request.operation ||
    !sequenceRecoveryPolicies.includes(request.approval?.recoveryPolicy) ||
    request.approval?.aclEvidenceMode !== 'capture-in-run' ||
    request.approval?.publicArchiveApproved !== true ||
    request.approval?.archiveRepository !== 'hzense/tech-intelligence-hub' ||
    env.MAINTENANCE_SEQUENCE_PHASE !== 'apply' ||
    env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED !== 'success'
  )
    throw new Error('Archived sequence ACL evidence required');
  const serialized = await read(join(env.RUNNER_TEMP, publicAclEvidenceFilename), 'utf8');
  assertPublicAclEvidenceSafe(serialized, env);
  const evidence = JSON.parse(serialized);
  const acceptance = publicRecoveryAcceptance(request, env.MAINTENANCE_APPROVAL);
  if (
    evidence.format !== 'hzense-public-acl-evidence/v1' ||
    evidence.repository !== env.GITHUB_REPOSITORY ||
    evidence.sha !== env.GITHUB_SHA ||
    evidence.runId !== env.GITHUB_RUN_ID ||
    evidence.runAttempt !== env.GITHUB_RUN_ATTEMPT ||
    evidence.independentCapturesMatch !== true ||
    evidence.restoration !== 'unverified-risk-accepted' ||
    evidence.recoveryPolicy !== request.approval.recoveryPolicy ||
    evidence.recoveryVerified !== false ||
    evidence.riskAcceptanceSha256 !== acceptance.riskAcceptanceSha256 ||
    !Array.isArray(evidence.captures) ||
    evidence.captures.length !== 2
  )
    throw new Error('Archived sequence ACL evidence binding mismatch');
  const [first, second] = evidence.captures.map((baseline) =>
    reviewedBaseline(baseline, env.MAINTENANCE_BACKUP_ID),
  );
  if (first.fingerprint !== second.fingerprint) {
    throw new Error('Independent ACL captures differ');
  }
  checkApproval();
  return { fingerprint: first.fingerprint };
}
