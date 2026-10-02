import console from 'node:console';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

export const maintenanceOperations = Object.freeze([
  'preflight',
  'migrate',
  'verify',
  'search-dry-run',
  'search-apply',
  'runtime-preflight',
  'acl-capture',
  'migrate-and-verify',
]);
const migrationSequence = 'migrate-and-verify';
const writes = new Set(['migrate', 'search-apply', migrationSequence]);
const digest = /^[a-f0-9]{64}$/;
const unverifiedRecoveryPolicy = 'accept-unverified-fts1';
const aiConfigRecoveryPolicy = 'accept-unverified-ai-config';
const importTasksRecoveryPolicy = 'accept-unverified-import-tasks';
const signalGenerationRecoveryPolicy = 'accept-unverified-signal-generation';
const taskManagementRecoveryPolicy = 'accept-unverified-task-management';
const generationProgressRecoveryPolicy = 'accept-unverified-generation-progress';
const candidateReviewRecoveryPolicy = 'accept-unverified-candidate-review';
const candidateEnrichmentRecoveryPolicy = 'accept-unverified-candidate-enrichment';
const candidateMaterialsRecoveryPolicy = 'accept-unverified-candidate-materials';
const materialReviewRecoveryPolicy = 'accept-unverified-material-review';
const editorialRecoveryPolicy = 'accept-unverified-editorial-publication';
const automationRecoveryPolicy = 'accept-unverified-automation-storage';
const automationConfigDeletionRecoveryPolicy = 'accept-unverified-automation-config-deletion';
const automationConfigDeletionGrant = 'automation-config-deletion-grant';
const automationConfigDeletionRoleUpgradeSha256 =
  '3372dcc11b59e8747589cf34f016a030c08f454a961b1d8a96a315e08d01bde2';

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

// Independent 0015 boundary. Neither the 0014 risk decision nor future repository
// migrations may widen this artifact; target/backup binding is domain separated.
const signalGenerationManifest = Object.freeze([
  ...importTasksManifest,
  Object.freeze([
    '0015_signal_generation.sql',
    '0c93078e520045e733824668d5eafe23064c48c60a0f0d52c72e00a9eae6b666',
  ]),
]);
export function signalGenerationTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'signal-generation-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/signal-generation-target/v1\0')
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
export function signalGenerationMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === signalGenerationManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === signalGenerationManifest[index][0] &&
          entry?.checksum === signalGenerationManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            signalGenerationManifest[index][1],
      ),
    'signal-generation-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      pendingMigrations[0] === '0015_signal_generation.sql',
    'signal-generation-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'signal-generation-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/signal-generation-migration-manifest/v1\0')
    .update(JSON.stringify(signalGenerationManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/signal-generation-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireSignalGenerationMigrationScope(preflight, migrations, approval, binding) {
  const plan = signalGenerationMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'signal-generation-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0016–0018 batch; historical approvals retain their frozen manifests.
const taskManagementManifest = Object.freeze([
  ...signalGenerationManifest,
  Object.freeze([
    '0016_generation_cancelled_recreation.sql',
    '91fed92118f856d3eecdfd7c7ec5394f6e36a93958282fb70958cbdcda849c4b',
  ]),
  Object.freeze([
    '0017_import_task_visibility.sql',
    'fef4f88c9592e03f79259787f31ab5974c187bdf6c8f9e9697c6b8faf5983012',
  ]),
  Object.freeze([
    '0018_generation_task_visibility.sql',
    '5a945ab6271cfbab0f58e3e11e78d7ff3eeb61041eec18f449b4ef44a4bc15e9',
  ]),
]);
export function taskManagementTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'task-management-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/task-management-target/v1\0')
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
export function taskManagementMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === taskManagementManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === taskManagementManifest[index][0] &&
          entry?.checksum === taskManagementManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') === taskManagementManifest[index][1],
      ),
    'task-management-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length > 0 &&
      pendingMigrations.length <= 3 &&
      pendingMigrations.every(
        (name, index) =>
          name ===
          taskManagementManifest[
            taskManagementManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'task-management-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'task-management-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/task-management-migration-manifest/v1\0')
    .update(JSON.stringify(taskManagementManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/task-management-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireTaskManagementMigrationScope(preflight, migrations, approval, binding) {
  const plan = taskManagementMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'task-management-migration-plan-mismatch',
  );
  return plan;
}

const generationProgressManifest = Object.freeze([
  ...taskManagementManifest,
  Object.freeze([
    '0019_generation_progress.sql',
    '09a590ddc306a9b45960fb86f3c9f2cbd3707c891a33f85d1b3aae533ea208cc',
  ]),
]);
export function generationProgressTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'generation-progress-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/generation-progress-target/v1\0')
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
export function generationProgressMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === generationProgressManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === generationProgressManifest[index][0] &&
          entry?.checksum === generationProgressManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            generationProgressManifest[index][1],
      ),
    'generation-progress-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length > 0 &&
      pendingMigrations.length === 1 &&
      pendingMigrations.every(
        (name, index) =>
          name ===
          generationProgressManifest[
            generationProgressManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'generation-progress-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'generation-progress-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/generation-progress-migration-manifest/v1\0')
    .update(JSON.stringify(generationProgressManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/generation-progress-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireGenerationProgressMigrationScope(preflight, migrations, approval, binding) {
  const plan = generationProgressMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'generation-progress-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0020–0021 batch. Candidate-review production enablement must not
// inherit authority from the earlier generation-progress rollout.
const candidateReviewManifest = Object.freeze([
  ...generationProgressManifest,
  Object.freeze([
    '0020_candidate_reviews.sql',
    '7701e6a05919ba004744529160efc94a3cd2dabb90474a0bd9d9368b806424c1',
  ]),
  Object.freeze([
    '0021_candidate_review_attestations.sql',
    'c92ac2a4221092ba056fece7986c0e44949832a32d0010b05c16f3102dbcaebf',
  ]),
]);
export function candidateReviewTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'candidate-review-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/candidate-review-target/v1\0')
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
export function candidateReviewMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === candidateReviewManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === candidateReviewManifest[index][0] &&
          entry?.checksum === candidateReviewManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            candidateReviewManifest[index][1],
      ),
    'candidate-review-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length > 0 &&
      pendingMigrations.length <= 2 &&
      pendingMigrations.every(
        (name, index) =>
          name ===
          candidateReviewManifest[
            candidateReviewManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'candidate-review-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'candidate-review-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/candidate-review-migration-manifest/v1\0')
    .update(JSON.stringify(candidateReviewManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/candidate-review-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireCandidateReviewMigrationScope(preflight, migrations, approval, binding) {
  const plan = candidateReviewMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'candidate-review-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0022-only boundary; earlier approvals cannot authorize enrichment.
const candidateEnrichmentManifest = Object.freeze([
  ...candidateReviewManifest,
  Object.freeze([
    '0022_candidate_enrichment_runs.sql',
    '9a9e2a5052350c40c36d0e290cfadf0324ae5a81042d18a25c3b222354543557',
  ]),
]);
export function candidateEnrichmentTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'candidate-enrichment-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/candidate-enrichment-target/v1\0')
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
export function candidateEnrichmentMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === candidateEnrichmentManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === candidateEnrichmentManifest[index][0] &&
          entry?.checksum === candidateEnrichmentManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            candidateEnrichmentManifest[index][1],
      ),
    'candidate-enrichment-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      pendingMigrations.every(
        (name, index) =>
          name ===
          candidateEnrichmentManifest[
            candidateEnrichmentManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'candidate-enrichment-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'candidate-enrichment-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/candidate-enrichment-migration-manifest/v1\0')
    .update(JSON.stringify(candidateEnrichmentManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/candidate-enrichment-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireCandidateEnrichmentMigrationScope(preflight, migrations, approval, binding) {
  const plan = candidateEnrichmentMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'candidate-enrichment-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0023-only boundary; earlier approvals cannot authorize material registration.
const candidateMaterialsManifest = Object.freeze([
  ...candidateEnrichmentManifest,
  Object.freeze([
    '0023_candidate_materials.sql',
    'd95a755855d203a9e7fad54bca54d63e8502f657fdb54022b954356620e7badb',
  ]),
]);
export function candidateMaterialsTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'candidate-materials-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/candidate-materials-target/v1\0')
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
export function candidateMaterialsMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === candidateMaterialsManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === candidateMaterialsManifest[index][0] &&
          entry?.checksum === candidateMaterialsManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            candidateMaterialsManifest[index][1],
      ),
    'candidate-materials-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      Array.from(pendingMigrations).every(
        (name, index) =>
          name ===
          candidateMaterialsManifest[
            candidateMaterialsManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'candidate-materials-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'candidate-materials-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/candidate-materials-migration-manifest/v1\0')
    .update(JSON.stringify(candidateMaterialsManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/candidate-materials-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireCandidateMaterialsMigrationScope(preflight, migrations, approval, binding) {
  const plan = candidateMaterialsMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'candidate-materials-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0023–0024 boundary; no prior 0023 or enrichment approval is reused.
const materialReviewManifest = Object.freeze([
  ...candidateMaterialsManifest,
  Object.freeze([
    '0024_material_review_proposals.sql',
    'bb4591a510721690216753a97759f255da0472553f4d3ab56b92b01ab9d80f57',
  ]),
]);
export function materialReviewTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'material-review-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/material-review-target/v1\0')
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
export function materialReviewMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === materialReviewManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === materialReviewManifest[index][0] &&
          entry?.checksum === materialReviewManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') === materialReviewManifest[index][1],
      ),
    'material-review-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length > 0 &&
      pendingMigrations.length <= 2 &&
      Array.from(pendingMigrations).every(
        (name, index) =>
          name ===
          materialReviewManifest[
            materialReviewManifest.length - pendingMigrations.length + index
          ][0],
      ),
    'material-review-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'material-review-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/material-review-migration-manifest/v1\0')
    .update(JSON.stringify(materialReviewManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/material-review-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireMaterialReviewMigrationScope(preflight, migrations, approval, binding) {
  const plan = materialReviewMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'material-review-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0025 boundary; older risk approvals cannot authorize this migration.
const editorialManifest = Object.freeze([
  ...materialReviewManifest,
  Object.freeze([
    '0025_editorial_signal_publication.sql',
    'd4ce2249d08f675cf0ea4a614790aa5c1cc2e793998a545a76a60f898a97e2ae',
  ]),
]);
export function editorialTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'editorial-publication-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/editorial-publication-target/v1\0')
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
export function editorialMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === editorialManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === editorialManifest[index][0] &&
          entry?.checksum === editorialManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') === editorialManifest[index][1],
      ),
    'editorial-publication-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      Array.from(pendingMigrations).every(
        (name, index) =>
          name ===
          editorialManifest[editorialManifest.length - pendingMigrations.length + index][0],
      ),
    'editorial-publication-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'editorial-publication-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/editorial-publication-migration-manifest/v1\0')
    .update(JSON.stringify(editorialManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/editorial-publication-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireEditorialMigrationScope(preflight, migrations, approval, binding) {
  const plan = editorialMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'editorial-publication-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0026 boundary; older risk approvals cannot authorize this migration.
const automationManifest = Object.freeze([
  ...editorialManifest,
  Object.freeze([
    '0026_automation_tasks.sql',
    'e2a884c37b523a7d4aad19ec3155cd662c89228bf7fc006db93044eb73d23c21',
  ]),
]);
export function automationTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'automation-storage-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/automation-storage-target/v1\0')
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
export function automationMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === automationManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === automationManifest[index][0] &&
          entry?.checksum === automationManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') === automationManifest[index][1],
      ),
    'automation-storage-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      Array.from(pendingMigrations).every(
        (name, index) =>
          name ===
          automationManifest[automationManifest.length - pendingMigrations.length + index][0],
      ),
    'automation-storage-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'automation-storage-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/automation-storage-migration-manifest/v1\0')
    .update(JSON.stringify(automationManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const planFingerprint = createHash('sha256')
    .update('hzense/automation-storage-migration-plan/v1\0')
    .update(
      JSON.stringify({ manifestFingerprint, pendingMigrations, targetFingerprint, backupIdSha256 }),
    )
    .digest('hex');
  return { manifestFingerprint, planFingerprint, targetFingerprint, backupIdSha256 };
}
export function requireAutomationMigrationScope(preflight, migrations, approval, binding) {
  const plan = automationMigrationPlan(preflight?.pendingMigrations, migrations, binding);
  requireGate(
    ['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'].every(
      (key) => approval?.[key] === plan[key],
    ),
    'automation-storage-migration-plan-mismatch',
  );
  return plan;
}

// Independent 0027-only boundary. Never extend the frozen 0026 approval scope.
const automationConfigDeletionManifest = Object.freeze([
  ...automationManifest,
  Object.freeze([
    '0027_automation_config_deletion.sql',
    'd395736de66cc66868dbe5ef1ac5a3ad6f724c2c8c77476c3e6e111682cf1ee5',
  ]),
]);

export function automationConfigDeletionTargetBinding(policy, preflight, backupId) {
  requireGate(
    ['host', 'port', 'database', 'user'].every(
      (key) => typeof policy?.[key] === 'string' && policy[key].length > 0,
    ) &&
      preflight?.database === policy.database &&
      preflight?.user === policy.user,
    'automation-config-deletion-target-required',
  );
  requireGate(
    typeof backupId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) &&
      !/(^|[._:/-])(none|null|todo|pending|placeholder|example|changeme)($|[._:/-])/i.test(
        backupId,
      ),
    'reviewed-backup-required',
  );
  return {
    targetFingerprint: createHash('sha256')
      .update('hzense/automation-config-deletion-target/v1\0')
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

export function automationConfigDeletionMigrationPlan(pendingMigrations, migrations, binding) {
  requireGate(
    Array.isArray(migrations) &&
      migrations.length === automationConfigDeletionManifest.length &&
      Array.from(migrations).every(
        (entry, index) =>
          entry?.name === automationConfigDeletionManifest[index][0] &&
          entry?.checksum === automationConfigDeletionManifest[index][1] &&
          typeof entry?.sql === 'string' &&
          createHash('sha256').update(entry.sql).digest('hex') ===
            automationConfigDeletionManifest[index][1],
      ),
    'automation-config-deletion-migration-manifest-required',
  );
  requireGate(
    Array.isArray(pendingMigrations) &&
      pendingMigrations.length === 1 &&
      pendingMigrations[0] === '0027_automation_config_deletion.sql',
    'automation-config-deletion-migration-scope-required',
  );
  requireGate(
    digest.test(binding?.targetFingerprint ?? '') && digest.test(binding?.backupIdSha256 ?? ''),
    'automation-config-deletion-target-required',
  );
  const manifestFingerprint = createHash('sha256')
    .update('hzense/automation-config-deletion-migration-manifest/v1\0')
    .update(JSON.stringify(automationConfigDeletionManifest))
    .digest('hex');
  const { targetFingerprint, backupIdSha256 } = binding;
  const roleUpgradeSha256 = automationConfigDeletionRoleUpgradeSha256;
  const planFingerprint = createHash('sha256')
    .update('hzense/automation-config-deletion-migration-plan/v1\0')
    .update(
      JSON.stringify({
        manifestFingerprint,
        pendingMigrations,
        targetFingerprint,
        backupIdSha256,
        roleUpgradeSha256,
      }),
    )
    .digest('hex');
  return {
    manifestFingerprint,
    planFingerprint,
    targetFingerprint,
    backupIdSha256,
    roleUpgradeSha256,
  };
}

export function requireAutomationConfigDeletionMigrationScope(
  preflight,
  migrations,
  approval,
  binding,
) {
  const plan = automationConfigDeletionMigrationPlan(
    preflight?.pendingMigrations,
    migrations,
    binding,
  );
  requireGate(
    [
      'manifestFingerprint',
      'planFingerprint',
      'targetFingerprint',
      'backupIdSha256',
      'roleUpgradeSha256',
    ].every((key) => approval?.[key] === plan[key]) && approval?.roleUpgradeApproved === true,
    'automation-config-deletion-migration-plan-mismatch',
  );
  return plan;
}

// Validate the very string sent to PostgreSQL, not a path or an earlier hash.
// There is no configurable script path or arbitrary-SQL maintenance operation.
export function automationConfigDeletionRoleUpgradeSql(sql) {
  requireGate(
    typeof sql === 'string' &&
      createHash('sha256').update(sql).digest('hex') === automationConfigDeletionRoleUpgradeSha256,
    'automation-config-deletion-role-script-mismatch',
  );
  return sql;
}

// Explicit exception, not fabricated evidence of a successful restore. The
// protected Environment review remains the authority; these are declarations.
function validateRecoveryPolicy(approval, operation) {
  const policy = Object.hasOwn(approval, 'recoveryPolicy') ? approval.recoveryPolicy : 'verified';
  requireGate(
    policy === 'verified' ||
      policy === unverifiedRecoveryPolicy ||
      policy === aiConfigRecoveryPolicy ||
      policy === importTasksRecoveryPolicy ||
      policy === signalGenerationRecoveryPolicy ||
      policy === taskManagementRecoveryPolicy ||
      policy === generationProgressRecoveryPolicy ||
      policy === candidateReviewRecoveryPolicy ||
      policy === candidateEnrichmentRecoveryPolicy ||
      policy === candidateMaterialsRecoveryPolicy ||
      policy === materialReviewRecoveryPolicy ||
      policy === editorialRecoveryPolicy ||
      policy === automationRecoveryPolicy ||
      policy === automationConfigDeletionRecoveryPolicy,
    'unsupported-recovery-policy',
  );
  if (policy === 'verified') {
    requireGate(!Object.hasOwn(approval, 'riskAcceptance'), 'conflicting-recovery-approval');
    return policy;
  }
  if (policy === automationConfigDeletionRecoveryPolicy) {
    requireGate(
      operation === migrationSequence || operation === 'acl-capture',
      'automation-config-deletion-operation-required',
    );
    requireGate(
      approval.roleUpgradeApproved === true &&
        approval.roleUpgradeSha256 === automationConfigDeletionRoleUpgradeSha256,
      'automation-config-deletion-role-upgrade-approval-required',
    );
  }
  if (
    [
      aiConfigRecoveryPolicy,
      importTasksRecoveryPolicy,
      signalGenerationRecoveryPolicy,
      taskManagementRecoveryPolicy,
      generationProgressRecoveryPolicy,
      candidateReviewRecoveryPolicy,
      candidateEnrichmentRecoveryPolicy,
      candidateMaterialsRecoveryPolicy,
      materialReviewRecoveryPolicy,
      editorialRecoveryPolicy,
      automationRecoveryPolicy,
      automationConfigDeletionRecoveryPolicy,
    ].includes(policy)
  ) {
    const prefix =
      policy === automationConfigDeletionRecoveryPolicy
        ? 'automation-config-deletion'
        : policy === automationRecoveryPolicy
          ? 'automation-storage'
          : policy === editorialRecoveryPolicy
            ? 'editorial-publication'
            : policy === materialReviewRecoveryPolicy
              ? 'material-review'
              : policy === candidateMaterialsRecoveryPolicy
                ? 'candidate-materials'
                : policy === candidateEnrichmentRecoveryPolicy
                  ? 'candidate-enrichment'
                  : policy === candidateReviewRecoveryPolicy
                    ? 'candidate-review'
                    : policy === generationProgressRecoveryPolicy
                      ? 'generation-progress'
                      : policy === taskManagementRecoveryPolicy
                        ? 'task-management'
                        : policy === signalGenerationRecoveryPolicy
                          ? 'signal-generation'
                          : policy === importTasksRecoveryPolicy
                            ? 'import-tasks'
                            : 'ai-config';
    if (policy !== aiConfigRecoveryPolicy)
      requireGate(digest.test(approval.targetFingerprint ?? ''), `${prefix}-target-required`);
    requireGate(
      operation === 'migrate' ||
        operation === 'acl-capture' ||
        (operation === migrationSequence &&
          [automationRecoveryPolicy, automationConfigDeletionRecoveryPolicy].includes(policy)),
      `${prefix}-operation-required`,
    );
    if (operation === 'migrate' || operation === migrationSequence) {
      requireGate(
        typeof approval.manifestFingerprint === 'string' &&
          digest.test(approval.manifestFingerprint) &&
          typeof approval.planFingerprint === 'string' &&
          digest.test(approval.planFingerprint),
        `reviewed-${prefix}-plan-required`,
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
        (policy === automationConfigDeletionRecoveryPolicy
          ? 'automation-config-deletion-production-launch'
          : policy === automationRecoveryPolicy
            ? 'automation-storage-production-launch'
            : policy === editorialRecoveryPolicy
              ? 'editorial-publication-production-launch'
              : policy === materialReviewRecoveryPolicy
                ? 'material-review-production-launch'
                : policy === candidateMaterialsRecoveryPolicy
                  ? 'candidate-materials-production-launch'
                  : policy === candidateEnrichmentRecoveryPolicy
                    ? 'candidate-enrichment-production-launch'
                    : policy === candidateReviewRecoveryPolicy
                      ? 'candidate-review-production-launch'
                      : policy === generationProgressRecoveryPolicy
                        ? 'generation-progress-production-launch'
                        : policy === taskManagementRecoveryPolicy
                          ? 'task-management-production-launch'
                          : policy === signalGenerationRecoveryPolicy
                            ? 'signal-generation-production-launch'
                            : policy === importTasksRecoveryPolicy
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
  // This is a new explicit authorization, not a way to replay historical
  // approvals. Only independently frozen rollout policies use this entry point.
  if (operation === migrationSequence) {
    requireGate(
      [automationRecoveryPolicy, automationConfigDeletionRecoveryPolicy].includes(recoveryPolicy) &&
        approval.aclEvidenceMode === 'capture-in-run' &&
        !Object.hasOwn(approval, 'aclFingerprint'),
      'migration-sequence-approval-required',
    );
    requireGate(
      ['prepare', 'apply'].includes(env.MAINTENANCE_SEQUENCE_PHASE),
      'migration-sequence-phase-required',
    );
    if (env.MAINTENANCE_SEQUENCE_PHASE === 'apply') {
      requireGate(
        env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED === 'success',
        'migration-sequence-archive-required',
      );
    }
  }
  requireGate(
    (recoveryPolicy !== 'verified' || approval.backupVerified === true) &&
      approval.ddlFreezeConfirmed === true &&
      backupCoversApproval(approval, expiry),
    'recovery-evidence-required',
  );
  if (operation === 'acl-capture' || operation === migrationSequence) {
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
    [
      unverifiedRecoveryPolicy,
      aiConfigRecoveryPolicy,
      importTasksRecoveryPolicy,
      signalGenerationRecoveryPolicy,
      taskManagementRecoveryPolicy,
      generationProgressRecoveryPolicy,
      candidateReviewRecoveryPolicy,
      candidateEnrichmentRecoveryPolicy,
      candidateMaterialsRecoveryPolicy,
      materialReviewRecoveryPolicy,
      editorialRecoveryPolicy,
      automationRecoveryPolicy,
      automationConfigDeletionRecoveryPolicy,
    ].includes(request.approval?.recoveryPolicy)
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
    'roleUpgradeSha256',
  ]) {
    if (typeof result[key] === 'string' && digest.test(result[key])) summary[key] = result[key];
  }
  if (typeof result.committed === 'boolean') summary.committed = result.committed;
  if (typeof result.roleUpgradeCompleted === 'boolean')
    summary.roleUpgradeCompleted = result.roleUpgradeCompleted;
  if (Array.isArray(result.pendingMigrations)) {
    summary.pendingMigrationCount = result.pendingMigrations.length;
  }
  return summary;
}

export function publicMaintenanceFailure(error) {
  if (error instanceof MaintenanceSequenceError) {
    return {
      ...publicMaintenanceFailure(error.cause),
      operation: migrationSequence,
      phase: error.phase,
      migrationMayHaveCommitted: error.migrationMayHaveCommitted,
      verificationCompleted: false,
      ...(error.phase === automationConfigDeletionGrant
        ? { roleUpgradeCompleted: false, roleUpgradeMayHaveCommitted: true }
        : {}),
    };
  }
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

// This is callable only as the final internal stage of the reviewed 0027
// sequence. Both its SQL and its database/role targets are fixed, not inputs.
async function executeAutomationConfigDeletionGrant(env, approval, context) {
  requireGate(
    approval?.operation === migrationSequence &&
      approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy &&
      env.MAINTENANCE_SEQUENCE_PHASE === 'apply' &&
      context.verificationCompleted === true &&
      typeof context.checkApproval === 'function' &&
      typeof context.checkFreshness === 'function',
    'automation-config-deletion-grant-context-required',
  );
  context.checkApproval();
  const sql = automationConfigDeletionRoleUpgradeSql(
    await readFile(
      new URL('../../db/roles/upgrade_automation_config_deletion.sql', import.meta.url),
      'utf8',
    ),
  );
  const { productionDatabaseOptions, validateConnectionTarget } =
    await import('../../packages/database/src/connection-policy.mjs');
  const { inspectDatabasePreflight } = await import('../../packages/database/src/preflight.mjs');
  const { verifyDatabaseContract } = await import('../../packages/database/src/verify.mjs');
  const { loadMigrations, verifyMigrationManifest, migrationLockKeys } =
    await import('../../packages/database/src/migrate.mjs');
  const options = productionDatabaseOptions(env);
  const policy = validateConnectionTarget(options);
  const migrations = await loadMigrations();
  await verifyMigrationManifest(migrations);
  const require = createRequire(new URL('../../packages/database/package.json', import.meta.url));
  const { Client } = require('pg');
  const client = new Client({
    connectionString: options.connectionString,
    application_name: 'hzense-automation-config-deletion-grant',
    connectionTimeoutMillis: 10_000,
  });
  // pg may emit an idle connection error while this session holds the lock and
  // awaits the independent verifier or GitHub. Do not throw from EventEmitter
  // callbacks or retain/log its raw error; fail through the normal cleanup path.
  let connectionFailed = false;
  client.on('error', () => {
    connectionFailed = true;
  });
  const requireHealthyConnection = () =>
    requireGate(!connectionFailed, 'automation-config-deletion-grant-connection-failed');
  let locked = false;
  try {
    await client.connect();
    requireHealthyConnection();
    await client.query("SET statement_timeout = '30s'");
    requireHealthyConnection();
    await client.query("SET idle_in_transaction_session_timeout = '45s'");
    requireHealthyConnection();
    const lock = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      migrationLockKeys,
    );
    locked = lock.rows[0]?.locked === true;
    requireHealthyConnection();
    requireGate(locked, 'automation-config-deletion-grant-lock-required');
    const current = await inspectDatabasePreflight(client, {
      ...options,
      expectedHost: policy.host,
    });
    requireHealthyConnection();
    requireGate(
      Array.isArray(current.pendingMigrations) && current.pendingMigrations.length === 0,
      'automation-config-deletion-complete-migrations-required',
    );
    // Reconstruct the original approved one-migration plan only after proving
    // all actual migrations are complete; this does not authorize another DDL.
    const plan = requireAutomationConfigDeletionMigrationScope(
      { pendingMigrations: ['0027_automation_config_deletion.sql'] },
      migrations,
      approval,
      automationConfigDeletionTargetBinding(policy, current, env.MAINTENANCE_BACKUP_ID),
    );
    requireHealthyConnection();
    const verification = await verifyDatabaseContract(options);
    requireHealthyConnection();
    requireGate(
      verification.migrationCount === 28 && verification.tableCount === 60,
      'automation-config-deletion-grant-schema-required',
    );
    await context.checkFreshness();
    requireHealthyConnection();
    context.checkApproval();
    // The reviewed SQL has its own BEGIN/COMMIT, same-session transaction lock,
    // owner check and exact effective/direct 82-to-84 column ACL checks.
    requireHealthyConnection();
    await client.query(automationConfigDeletionRoleUpgradeSql(sql));
    requireHealthyConnection();
    return { ...verification, ...plan, roleUpgradeCompleted: true };
  } catch (error) {
    // Multi-statement errors can leave the SQL's transaction aborted. Never
    // retry the grant and always roll back using this same client before close.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (locked)
      await client
        .query('SELECT pg_advisory_unlock($1, $2)', migrationLockKeys)
        .catch(() => undefined);
    // Keep the nonthrowing listener installed throughout shutdown, including
    // errors emitted after a failed query or while end() is settling.
    await client.end().catch(() => undefined);
  }
}

async function executeOperation(env, { operation, approval }, context = {}) {
  if (operation === automationConfigDeletionGrant)
    return executeAutomationConfigDeletionGrant(env, approval, context);
  if (operation === 'acl-evidence') {
    const { readPublicAclEvidence } = await import('./public-acl-evidence.mjs');
    return readPublicAclEvidence(env, { checkApproval: context.checkApproval });
  }
  if (operation === 'acl-capture') {
    let binding;
    if (
      [
        importTasksRecoveryPolicy,
        signalGenerationRecoveryPolicy,
        taskManagementRecoveryPolicy,
        generationProgressRecoveryPolicy,
        candidateReviewRecoveryPolicy,
        candidateEnrichmentRecoveryPolicy,
        candidateMaterialsRecoveryPolicy,
        materialReviewRecoveryPolicy,
        editorialRecoveryPolicy,
        automationRecoveryPolicy,
        automationConfigDeletionRecoveryPolicy,
      ].includes(approval?.recoveryPolicy)
    ) {
      const { productionDatabaseOptions, validateConnectionTarget } =
        await import('../../packages/database/src/connection-policy.mjs');
      const { runDatabasePreflight } = await import('../../packages/database/src/preflight.mjs');
      const options = productionDatabaseOptions(env);
      const generation = approval.recoveryPolicy === signalGenerationRecoveryPolicy;
      const progress = approval.recoveryPolicy === generationProgressRecoveryPolicy;
      const taskManagement = approval.recoveryPolicy === taskManagementRecoveryPolicy;
      const candidateReview = approval.recoveryPolicy === candidateReviewRecoveryPolicy;
      const automationConfigDeletion =
        approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy;
      const automation = approval.recoveryPolicy === automationRecoveryPolicy;
      const editorial = approval.recoveryPolicy === editorialRecoveryPolicy;
      const materialReview = approval.recoveryPolicy === materialReviewRecoveryPolicy;
      const candidateMaterials = approval.recoveryPolicy === candidateMaterialsRecoveryPolicy;
      const candidateEnrichment = approval.recoveryPolicy === candidateEnrichmentRecoveryPolicy;
      binding = (
        automationConfigDeletion
          ? automationConfigDeletionTargetBinding
          : automation
            ? automationTargetBinding
            : editorial
              ? editorialTargetBinding
              : materialReview
                ? materialReviewTargetBinding
                : candidateMaterials
                  ? candidateMaterialsTargetBinding
                  : candidateEnrichment
                    ? candidateEnrichmentTargetBinding
                    : candidateReview
                      ? candidateReviewTargetBinding
                      : progress
                        ? generationProgressTargetBinding
                        : taskManagement
                          ? taskManagementTargetBinding
                          : generation
                            ? signalGenerationTargetBinding
                            : importTasksTargetBinding
      )(
        validateConnectionTarget(options),
        await runDatabasePreflight(options),
        env.MAINTENANCE_BACKUP_ID,
      );
      requireGate(
        binding.targetFingerprint === approval.targetFingerprint &&
          binding.backupIdSha256 === approval.backupIdSha256,
        automationConfigDeletion
          ? 'automation-config-deletion-target-mismatch'
          : automation
            ? 'automation-storage-target-mismatch'
            : editorial
              ? 'editorial-publication-target-mismatch'
              : materialReview
                ? 'material-review-target-mismatch'
                : candidateMaterials
                  ? 'candidate-materials-target-mismatch'
                  : candidateEnrichment
                    ? 'candidate-enrichment-target-mismatch'
                    : candidateReview
                      ? 'candidate-review-target-mismatch'
                      : progress
                        ? 'generation-progress-target-mismatch'
                        : taskManagement
                          ? 'task-management-target-mismatch'
                          : generation
                            ? 'signal-generation-target-mismatch'
                            : 'import-tasks-target-mismatch',
      );
    }
    const { capturePublicAclEvidence } = await import('./public-acl-evidence.mjs');
    return {
      ...(await capturePublicAclEvidence(env, {
        checkApproval: context.checkApproval ?? (() => validateMaintenanceRequest(env)),
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
      automationConfigDeletionRoleUpgradeSql(
        await readFile(
          new URL('../../db/roles/upgrade_automation_config_deletion.sql', import.meta.url),
          'utf8',
        ),
      );
      return {
        ...preflight,
        ...automationConfigDeletionMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          automationConfigDeletionTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...automationMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          automationTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...editorialMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          editorialTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...materialReviewMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          materialReviewTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...candidateMaterialsMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          candidateMaterialsTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...candidateEnrichmentMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          candidateEnrichmentTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...candidateReviewMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          candidateReviewTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...generationProgressMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          generationProgressTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...taskManagementMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          taskManagementTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
    try {
      return {
        ...preflight,
        ...signalGenerationMigrationPlan(
          preflight.pendingMigrations,
          migrations,
          signalGenerationTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
        ),
      };
    } catch (error) {
      if (!(error instanceof MaintenanceGateError)) throw error;
    }
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
      if (
        [
          aiConfigRecoveryPolicy,
          importTasksRecoveryPolicy,
          signalGenerationRecoveryPolicy,
          taskManagementRecoveryPolicy,
          generationProgressRecoveryPolicy,
          candidateReviewRecoveryPolicy,
          candidateEnrichmentRecoveryPolicy,
          candidateMaterialsRecoveryPolicy,
          materialReviewRecoveryPolicy,
          editorialRecoveryPolicy,
          automationRecoveryPolicy,
          automationConfigDeletionRecoveryPolicy,
        ].includes(approval?.recoveryPolicy)
      ) {
        const migrations = await loadMigrations();
        await verifyMigrationManifest(migrations);
        approvedPlan =
          approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy
            ? requireAutomationConfigDeletionMigrationScope(
                preflight,
                migrations,
                approval,
                automationConfigDeletionTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
              )
            : approval.recoveryPolicy === automationRecoveryPolicy
              ? requireAutomationMigrationScope(
                  preflight,
                  migrations,
                  approval,
                  automationTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
                )
              : approval.recoveryPolicy === editorialRecoveryPolicy
                ? requireEditorialMigrationScope(
                    preflight,
                    migrations,
                    approval,
                    editorialTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
                  )
                : approval.recoveryPolicy === materialReviewRecoveryPolicy
                  ? requireMaterialReviewMigrationScope(
                      preflight,
                      migrations,
                      approval,
                      materialReviewTargetBinding(policy, preflight, env.MAINTENANCE_BACKUP_ID),
                    )
                  : approval.recoveryPolicy === candidateMaterialsRecoveryPolicy
                    ? requireCandidateMaterialsMigrationScope(
                        preflight,
                        migrations,
                        approval,
                        candidateMaterialsTargetBinding(
                          policy,
                          preflight,
                          env.MAINTENANCE_BACKUP_ID,
                        ),
                      )
                    : approval.recoveryPolicy === candidateEnrichmentRecoveryPolicy
                      ? requireCandidateEnrichmentMigrationScope(
                          preflight,
                          migrations,
                          approval,
                          candidateEnrichmentTargetBinding(
                            policy,
                            preflight,
                            env.MAINTENANCE_BACKUP_ID,
                          ),
                        )
                      : approval.recoveryPolicy === candidateReviewRecoveryPolicy
                        ? requireCandidateReviewMigrationScope(
                            preflight,
                            migrations,
                            approval,
                            candidateReviewTargetBinding(
                              policy,
                              preflight,
                              env.MAINTENANCE_BACKUP_ID,
                            ),
                          )
                        : approval.recoveryPolicy === generationProgressRecoveryPolicy
                          ? requireGenerationProgressMigrationScope(
                              preflight,
                              migrations,
                              approval,
                              generationProgressTargetBinding(
                                policy,
                                preflight,
                                env.MAINTENANCE_BACKUP_ID,
                              ),
                            )
                          : approval.recoveryPolicy === taskManagementRecoveryPolicy
                            ? requireTaskManagementMigrationScope(
                                preflight,
                                migrations,
                                approval,
                                taskManagementTargetBinding(
                                  policy,
                                  preflight,
                                  env.MAINTENANCE_BACKUP_ID,
                                ),
                              )
                            : approval.recoveryPolicy === signalGenerationRecoveryPolicy
                              ? requireSignalGenerationMigrationScope(
                                  preflight,
                                  migrations,
                                  approval,
                                  signalGenerationTargetBinding(
                                    policy,
                                    preflight,
                                    env.MAINTENANCE_BACKUP_ID,
                                  ),
                                )
                              : approval.recoveryPolicy === importTasksRecoveryPolicy
                                ? requireImportTasksMigrationScope(
                                    preflight,
                                    migrations,
                                    approval,
                                    importTasksTargetBinding(
                                      policy,
                                      preflight,
                                      env.MAINTENANCE_BACKUP_ID,
                                    ),
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
        signalGenerationRecoveryPolicy,
        taskManagementRecoveryPolicy,
        generationProgressRecoveryPolicy,
        candidateReviewRecoveryPolicy,
        candidateEnrichmentRecoveryPolicy,
        candidateMaterialsRecoveryPolicy,
        materialReviewRecoveryPolicy,
        editorialRecoveryPolicy,
        automationRecoveryPolicy,
        automationConfigDeletionRecoveryPolicy,
      ].includes(approval?.recoveryPolicy)
        ? async (pendingMigrations, artifact) => {
            if (
              [
                aiConfigRecoveryPolicy,
                importTasksRecoveryPolicy,
                signalGenerationRecoveryPolicy,
                taskManagementRecoveryPolicy,
                generationProgressRecoveryPolicy,
                candidateReviewRecoveryPolicy,
                candidateEnrichmentRecoveryPolicy,
                candidateMaterialsRecoveryPolicy,
                materialReviewRecoveryPolicy,
                editorialRecoveryPolicy,
                automationRecoveryPolicy,
                automationConfigDeletionRecoveryPolicy,
              ].includes(approval?.recoveryPolicy)
            ) {
              // The runner freezes this actual execution snapshot before opening
              // its connection. Do not substitute another filesystem reread.
              if (
                [
                  importTasksRecoveryPolicy,
                  signalGenerationRecoveryPolicy,
                  taskManagementRecoveryPolicy,
                  generationProgressRecoveryPolicy,
                  candidateReviewRecoveryPolicy,
                  candidateEnrichmentRecoveryPolicy,
                  candidateMaterialsRecoveryPolicy,
                  materialReviewRecoveryPolicy,
                  editorialRecoveryPolicy,
                  automationRecoveryPolicy,
                  automationConfigDeletionRecoveryPolicy,
                ].includes(approval.recoveryPolicy)
              ) {
                // Re-read authenticated identity from the very same connection
                // while holding the migration lock, not from approval fields.
                const current = await inspectDatabasePreflight(migrationClient, {
                  ...options,
                  expectedHost: policy.host,
                });
                const generation = approval.recoveryPolicy === signalGenerationRecoveryPolicy;
                const progress = approval.recoveryPolicy === generationProgressRecoveryPolicy;
                const taskManagement = approval.recoveryPolicy === taskManagementRecoveryPolicy;
                const candidateReview = approval.recoveryPolicy === candidateReviewRecoveryPolicy;
                const automationConfigDeletion =
                  approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy;
                const automation = approval.recoveryPolicy === automationRecoveryPolicy;
                const editorial = approval.recoveryPolicy === editorialRecoveryPolicy;
                const materialReview = approval.recoveryPolicy === materialReviewRecoveryPolicy;
                const candidateMaterials =
                  approval.recoveryPolicy === candidateMaterialsRecoveryPolicy;
                const candidateEnrichment =
                  approval.recoveryPolicy === candidateEnrichmentRecoveryPolicy;
                approvedPlan = (
                  automationConfigDeletion
                    ? requireAutomationConfigDeletionMigrationScope
                    : automation
                      ? requireAutomationMigrationScope
                      : editorial
                        ? requireEditorialMigrationScope
                        : materialReview
                          ? requireMaterialReviewMigrationScope
                          : candidateMaterials
                            ? requireCandidateMaterialsMigrationScope
                            : candidateEnrichment
                              ? requireCandidateEnrichmentMigrationScope
                              : candidateReview
                                ? requireCandidateReviewMigrationScope
                                : progress
                                  ? requireGenerationProgressMigrationScope
                                  : taskManagement
                                    ? requireTaskManagementMigrationScope
                                    : generation
                                      ? requireSignalGenerationMigrationScope
                                      : requireImportTasksMigrationScope
                )(
                  { ...current, pendingMigrations },
                  artifact?.migrations,
                  approval,
                  (automationConfigDeletion
                    ? automationConfigDeletionTargetBinding
                    : automation
                      ? automationTargetBinding
                      : editorial
                        ? editorialTargetBinding
                        : materialReview
                          ? materialReviewTargetBinding
                          : candidateMaterials
                            ? candidateMaterialsTargetBinding
                            : candidateEnrichment
                              ? candidateEnrichmentTargetBinding
                              : candidateReview
                                ? candidateReviewTargetBinding
                                : progress
                                  ? generationProgressTargetBinding
                                  : taskManagement
                                    ? taskManagementTargetBinding
                                    : generation
                                      ? signalGenerationTargetBinding
                                      : importTasksTargetBinding)(
                    policy,
                    current,
                    env.MAINTENANCE_BACKUP_ID,
                  ),
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
            if (approval.operation === migrationSequence) {
              requireGate(
                digest.test(context.aclFingerprint ?? '') &&
                  typeof context.checkFreshness === 'function' &&
                  typeof context.checkApproval === 'function',
                'migration-sequence-context-required',
              );
              await context.checkFreshness();
              if (approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy) {
                automationConfigDeletionRoleUpgradeSql(
                  await readFile(
                    new URL(
                      '../../db/roles/upgrade_automation_config_deletion.sql',
                      import.meta.url,
                    ),
                    'utf8',
                  ),
                );
              }
              // The session migration lock is already held; use a separate
              // read-only transaction on that SAME connection before any DDL.
              const { inspectRuntimeAclBaseline, runtimeAclBackupReference } =
                await import('../../packages/database/src/runtime-acl-baseline.mjs');
              await migrationClient.query(
                'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
              );
              let currentAcl;
              try {
                await migrationClient.query('SET LOCAL search_path = pg_catalog, pg_temp');
                await migrationClient.query("SET LOCAL statement_timeout = '30s'");
                await migrationClient.query("SET LOCAL lock_timeout = '5s'");
                await migrationClient.query(
                  "SET LOCAL idle_in_transaction_session_timeout = '45s'",
                );
                currentAcl = await inspectRuntimeAclBaseline(migrationClient, {
                  expectedDatabase: policy.database,
                  expectedUser: policy.user,
                  expectedPostgresMajor: options.expectedPostgresMajor,
                  backupReference: runtimeAclBackupReference(env.MAINTENANCE_BACKUP_ID),
                });
              } finally {
                await migrationClient.query('ROLLBACK');
              }
              requireGate(
                currentAcl.fingerprint === context.aclFingerprint,
                'migration-sequence-acl-drift',
              );
              context.checkApproval();
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

class MaintenanceSequenceError extends Error {
  constructor(cause, phase, migrationMayHaveCommitted) {
    super('Maintenance sequence stopped', { cause });
    this.phase = phase;
    this.migrationMayHaveCommitted = migrationMayHaveCommitted;
  }
}

// Keep one original run-bound approval throughout. Child operations cannot
// change its operation/run/scope, manufacture recovery evidence, or retry DDL.
async function executeMigrationSequence(env, request, execute, context, report) {
  const preparing = env.MAINTENANCE_SEQUENCE_PHASE === 'prepare';
  const deletion = request.approval.recoveryPolicy === automationConfigDeletionRecoveryPolicy;
  let phase = preparing ? 'preflight' : 'acl-evidence';
  let migrationMayHaveCommitted = false;
  const stages = [];
  const run = async (operation, extra = {}) => {
    phase = operation;
    await context.checkFreshness();
    report({ operation: migrationSequence, phase, status: 'started' });
    if (operation === 'migrate') migrationMayHaveCommitted = true;
    return execute(env, { operation, approval: request.approval }, { ...context, ...extra });
  };
  const completed = (result) => {
    const summary = publicMaintenanceResult(phase, result);
    stages.push(summary);
    report({ ...summary, operation: migrationSequence, phase });
  };
  try {
    if (preparing) {
      const preflight = await run('preflight');
      requireGate(
        preflight?.pendingMigrations?.length === 1 &&
          preflight.pendingMigrations[0] ===
            (deletion ? '0027_automation_config_deletion.sql' : '0026_automation_tasks.sql') &&
          [
            'manifestFingerprint',
            'planFingerprint',
            'targetFingerprint',
            'backupIdSha256',
            ...(deletion ? ['roleUpgradeSha256'] : []),
          ].every(
            (key) => digest.test(preflight[key] ?? '') && preflight[key] === request.approval[key],
          ),
        'migration-sequence-plan-mismatch',
      );
      completed(preflight);
      const capture = await run('acl-capture');
      requireGate(digest.test(capture?.fingerprint ?? ''), 'migration-sequence-acl-required');
      completed(capture);
      // GitHub must durably archive the file before the next runner invocation.
      // Both invocations remain in the SAME protected job and original approval.
      return {
        ...publicMaintenanceResult(migrationSequence, preflight),
        status: 'prepared',
        aclFingerprint: capture.fingerprint,
        verificationCompleted: false,
        ...(deletion ? { roleUpgradeCompleted: false } : {}),
        stages,
      };
    }
    const capture = await run('acl-evidence');
    requireGate(digest.test(capture?.fingerprint ?? ''), 'migration-sequence-acl-required');
    completed(capture);
    const migration = await run('migrate', { aclFingerprint: capture.fingerprint });
    completed(migration);
    // verify uses fresh connections after runMigrations has closed its client.
    const verification = await run('verify');
    requireGate(
      verification?.migrationCount === (deletion ? 28 : 27) &&
        (!deletion || verification.tableCount === 60),
      'migration-sequence-verification-required',
    );
    completed(verification);
    if (deletion) {
      const grant = await run(automationConfigDeletionGrant, { verificationCompleted: true });
      requireGate(
        grant?.roleUpgradeCompleted === true &&
          grant.roleUpgradeSha256 === automationConfigDeletionRoleUpgradeSha256,
        'automation-config-deletion-role-upgrade-required',
      );
      completed(grant);
    }
    return {
      ...publicMaintenanceResult(migrationSequence, { ...request.approval, ...verification }),
      pendingMigrationCount: 0,
      aclFingerprint: capture.fingerprint,
      verificationCompleted: true,
      ...(deletion ? { roleUpgradeCompleted: true } : {}),
      stages,
    };
  } catch (error) {
    throw new MaintenanceSequenceError(error, phase, migrationMayHaveCommitted);
  }
}

export async function runMaintenance(
  env,
  execute = executeOperation,
  { fetchImpl = globalThis.fetch, now = Date.now, report = () => {} } = {},
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
    const checkApproval = () => validateMaintenanceRequest(executionEnv, now());
    const checkFreshness = async () => {
      checkApproval();
      await verifyMaintenanceFreshness(snapshot, { fetchImpl });
      checkApproval();
    };
    const summary =
      request.operation === migrationSequence
        ? await executeMigrationSequence(
            executionEnv,
            request,
            execute,
            { checkApproval, checkFreshness },
            report,
          )
        : publicMaintenanceResult(request.operation, await execute(executionEnv, request));
    Object.assign(summary, publicRecoveryAcceptance(request, snapshot.MAINTENANCE_APPROVAL));
    return summary;
  } finally {
    for (const [method, original] of originals) console[method] = original;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const log = console.log.bind(console);
  runMaintenance(process.env, undefined, {
    report: (summary) => {
      if (summary.phase === 'acl-capture' && summary.status === 'succeeded') {
        requireGate(Boolean(process.env.GITHUB_OUTPUT), 'migration-sequence-output-required');
        // Fixed non-secret flag only, emitted after both captures are validated
        // and the exclusive evidence file is safely written, before any DDL.
        appendFileSync(process.env.GITHUB_OUTPUT, 'acl_captured=true\n', 'utf8');
      }
      log(JSON.stringify(summary));
    },
  })
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error) => {
      console.error(JSON.stringify(publicMaintenanceFailure(error)));
      process.exitCode = 1;
    });
}
