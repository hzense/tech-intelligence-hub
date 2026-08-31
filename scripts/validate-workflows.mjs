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
  "github.event_name == 'workflow_dispatch' || vars.PRODUCTION_DATABASE_HEALTH_ENABLED == 'true'";
if (productionHealth.jobs?.['database-health']?.if !== productionHealthCondition) {
  issues.push(
    'production-health.yml: scheduled checks must remain gated by PRODUCTION_DATABASE_HEALTH_ENABLED while manual verification stays available',
  );
}

if (issues.length > 0) {
  throw new Error(`Workflow validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
}

console.log(
  `Workflow validation OK: ${workflowFiles.length} workflows, ${pinnedActions} immutable Action references.`,
);
