import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const workflowRoot = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const workflowFiles = (await readdir(workflowRoot))
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();
const issues = [];
let pinnedActions = 0;
const allowedWritePermissions = new Map([
  ['continuous-daily.yml:publish', ['actions', 'contents', 'pull-requests']],
  ['production-health.yml:health-incident', ['issues']],
]);

function validateUses(file, location, uses) {
  if (typeof uses !== 'string') return;
  if (uses.startsWith('./')) {
    issues.push(
      `${file}: ${location} uses a local Action; recursive local Action validation is not enabled`,
    );
    return;
  }
  if (uses.startsWith('docker://')) {
    if (!/@sha256:[0-9a-f]{64}$/.test(uses)) {
      issues.push(`${file}: ${location} must pin a Docker image by SHA-256 digest`);
    }
    return;
  }
  const separator = uses.lastIndexOf('@');
  const reference = separator === -1 ? '' : uses.slice(separator + 1);
  if (!/^[0-9a-f]{40}$/.test(reference)) {
    issues.push(`${file}: ${location} must pin uses to a 40-character SHA`);
  } else {
    pinnedActions += 1;
  }
}

for (const file of workflowFiles) {
  const filePath = join(workflowRoot, file);
  const workflow = parse(await readFile(filePath, 'utf8'));
  if (!workflow || typeof workflow !== 'object') {
    issues.push(`${file}: workflow must be a YAML object`);
    continue;
  }
  if (workflow.permissions?.contents !== 'read') {
    issues.push(`${file}: top-level permissions.contents must be read`);
  }
  for (const [permission, access] of Object.entries(workflow.permissions ?? {})) {
    if (access === 'write') issues.push(`${file}: top-level ${permission}: write is forbidden`);
  }

  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    if (!job || typeof job !== 'object') {
      issues.push(`${file}: job ${jobId} must be an object`);
      continue;
    }
    if (!Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1) {
      issues.push(`${file}: job ${jobId} requires a positive timeout-minutes`);
    }
    if (
      job.permissions !== undefined &&
      (typeof job.permissions !== 'object' || Array.isArray(job.permissions))
    ) {
      issues.push(`${file}: job ${jobId} permissions must be an explicit mapping`);
    }
    const writePermissions = Object.entries(
      typeof job.permissions === 'object' && job.permissions !== null ? job.permissions : {},
    )
      .filter(([, access]) => access === 'write')
      .map(([permission]) => permission)
      .sort();
    const allowed = allowedWritePermissions.get(`${file}:${jobId}`);
    if (writePermissions.length > 0 && writePermissions.join('\0') !== allowed?.join('\0')) {
      issues.push(`${file}: job ${jobId} has unapproved write permissions`);
    }
    if (allowed && writePermissions.join('\0') !== allowed.join('\0')) {
      issues.push(`${file}: job ${jobId} must have exactly ${allowed.join(', ')} write access`);
    }
    validateUses(file, `job ${jobId}`, job.uses);
    for (const [serviceId, service] of Object.entries(job.services ?? {})) {
      if (!/@sha256:[0-9a-f]{64}$/.test(service?.image ?? '')) {
        issues.push(`${file}: job ${jobId} service ${serviceId} must pin its image by SHA-256`);
      }
    }
    if (job.container && !/@sha256:[0-9a-f]{64}$/.test(job.container.image ?? '')) {
      issues.push(`${file}: job ${jobId} container must pin its image by SHA-256`);
    }
    for (const [index, step] of (job.steps ?? []).entries()) {
      validateUses(file, `job ${jobId} step ${index + 1}`, step?.uses);
    }
  }
}

const ci = parse(await readFile(join(workflowRoot, 'ci.yml'), 'utf8'));
for (const jobId of ['foundation', 'database-migrations', 'daily-publication-gate']) {
  if (!ci.jobs?.[jobId]) issues.push(`ci.yml: missing required gate job ${jobId}`);
}

const productionHealth = parse(await readFile(join(workflowRoot, 'production-health.yml'), 'utf8'));
const productionHealthCondition =
  "github.event_name == 'workflow_dispatch' || (github.event_name == 'schedule' && vars.PRODUCTION_DATABASE_HEALTH_ENABLED == 'true')";
const productionHealthIncidentCondition = `always() && (${productionHealthCondition})`;
if (productionHealth.jobs?.['database-health']?.if !== productionHealthCondition) {
  issues.push(
    'production-health.yml: keep the reviewed schedule/manual condition in sync with the workflow validator',
  );
}

const productionHealthTriggers = productionHealth.on;
const productionHealthTriggerNames =
  productionHealthTriggers && typeof productionHealthTriggers === 'object'
    ? Object.keys(productionHealthTriggers).sort()
    : [];
if (productionHealthTriggerNames.join('\0') !== ['schedule', 'workflow_dispatch'].join('\0')) {
  issues.push(
    'production-health.yml: only schedule and workflow_dispatch triggers are permitted; update the reviewed contract explicitly before adding another trigger',
  );
}

const productionHealthSchedule = productionHealthTriggers?.schedule;
if (
  !Array.isArray(productionHealthSchedule) ||
  productionHealthSchedule.length !== 1 ||
  productionHealthSchedule[0]?.cron !== '17 * * * *'
) {
  issues.push(
    "production-health.yml: the reviewed schedule must remain exactly '17 * * * *'; update the workflow validator with any approved schedule change",
  );
}

if (!Object.prototype.hasOwnProperty.call(productionHealthTriggers ?? {}, 'workflow_dispatch')) {
  issues.push(
    'production-health.yml: workflow_dispatch must remain available for controlled checks',
  );
}

const productionHealthDispatch = productionHealthTriggers?.workflow_dispatch;
const testAlertInput = productionHealthDispatch?.inputs?.test_alert;
if (
  !testAlertInput ||
  testAlertInput.type !== 'boolean' ||
  testAlertInput.required !== false ||
  testAlertInput.default !== false
) {
  issues.push(
    'production-health.yml: workflow_dispatch.test_alert must remain an optional boolean defaulting to false',
  );
}

const productionHealthSteps = productionHealth.jobs?.['database-health']?.steps ?? [];
const productionProbeStep = productionHealthSteps.find(
  (step) => step?.name === 'Verify production database health contract',
);
if (
  productionProbeStep?.id !== 'production_probe' ||
  typeof productionProbeStep?.run !== 'string' ||
  !productionProbeStep.run.includes(`echo 'succeeded=true' >> "$GITHUB_OUTPUT"`) ||
  productionHealth.jobs?.['database-health']?.outputs?.probe_succeeded !==
    '${{ steps.production_probe.outputs.succeeded }}'
) {
  issues.push(
    'production-health.yml: database-health must expose success only after the real probe passes',
  );
}
const controlledAlertStep = productionHealthSteps.find(
  (step) => step?.name === 'Exercise controlled alert path',
);
if (
  controlledAlertStep?.if !== 'inputs.test_alert == true' ||
  typeof controlledAlertStep?.run !== 'string' ||
  !controlledAlertStep.run.includes('exit 1')
) {
  issues.push('production-health.yml: the controlled alert step must run only for test_alert=true');
}

const productionHealthIncident = productionHealth.jobs?.['health-incident'];
if (productionHealthIncident?.needs !== 'database-health') {
  issues.push('production-health.yml: health-incident must depend on database-health');
}
if (productionHealthIncident?.if !== productionHealthIncidentCondition) {
  issues.push(
    'production-health.yml: health-incident must always reconcile the reviewed enabled health run',
  );
}
const incidentPermissionNames = Object.keys(productionHealthIncident?.permissions ?? {}).sort();
if (
  incidentPermissionNames.join('\0') !== ['contents', 'issues'].join('\0') ||
  productionHealthIncident?.permissions?.contents !== 'read' ||
  productionHealthIncident?.permissions?.issues !== 'write'
) {
  issues.push(
    'production-health.yml: health-incident permissions must be exactly contents: read and issues: write',
  );
}
const reconcileIncidentStep = (productionHealthIncident?.steps ?? []).find(
  (step) => step?.name === 'Reconcile production health incident',
);
if (reconcileIncidentStep?.env?.GH_TOKEN !== '${{ github.token }}') {
  issues.push('production-health.yml: health-incident must use the scoped github.token');
}
if (
  typeof reconcileIncidentStep?.run !== 'string' ||
  !reconcileIncidentStep.run.includes('<!-- hzense-production-database-health -->') ||
  reconcileIncidentStep?.env?.PROBE_SUCCEEDED !==
    '${{ needs.database-health.outputs.probe_succeeded }}' ||
  !reconcileIncidentStep.run.includes(
    `[[ "$TEST_ALERT" == 'true' && "$PROBE_SUCCEEDED" == 'true' ]]`,
  ) ||
  !reconcileIncidentStep.run.includes('cancelled | skipped)') ||
  !reconcileIncidentStep.run.includes('Unsupported database-health result')
) {
  issues.push(
    'production-health.yml: health-incident must preserve its singleton marker and distinguish probe, test, and non-terminal results',
  );
}

if (issues.length > 0) {
  throw new Error(`Workflow validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
}

console.log(
  `Workflow validation OK: ${workflowFiles.length} workflows, ${pinnedActions} immutable Action references.`,
);
