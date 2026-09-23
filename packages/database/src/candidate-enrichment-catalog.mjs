import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';

const required = (type) => [type, true];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));

export const candidateEnrichmentColumns = {
  candidate_enrichment_runs: {
    id: required('uuid'),
    owner_id: required('text'),
    run_id: required('uuid'),
    candidate_index: required('integer'),
    material_hash: required('text'),
    profile_id: required('uuid'),
    profile_revision: required('integer'),
    fingerprint: required('text'),
    snapshot: required('jsonb'),
    configuration: required('jsonb'),
    status: required('text'),
    lease_token: ['uuid', false],
    lease_until: ['timestamp with time zone', false],
    budget_day: ['date', false],
    reserved_microusd: required('bigint'),
    charged_microusd: required('bigint'),
    result: ['jsonb', false],
    error_code: ['text', false],
    progress_phase: ['text', false],
    progress_at: ['timestamp with time zone', false],
    started_at: ['timestamp with time zone', false],
    created_at: required('timestamp with time zone'),
    finished_at: ['timestamp with time zone', false],
  },
};

export const candidateEnrichmentPrimaryKeys = ['candidate_enrichment_runs|id'];
export const candidateEnrichmentForeignKeys = [
  'candidate_enrichment_runs|run_id|signal_generation_runs|id|a|a|false',
];
export const candidateEnrichmentChecks = {
  candidate_enrichment_runs: [
    forms('candidate_index BETWEEN 0 AND 4', '((candidate_index >= 0) AND (candidate_index <= 4))'),
    forms('profile_revision > 0', '(profile_revision > 0)'),
    ...['material_hash', 'fingerprint'].map((column) =>
      forms(`${column} ~ '^[a-f0-9]{64}$'`, `(${column} ~ '^[a-f0-9]{64}$'::text)`),
    ),
    ...['snapshot', 'configuration'].map((column) =>
      forms(`jsonb_typeof(${column}) = 'object'`, `(jsonb_typeof(${column}) = 'object'::text)`),
    ),
    forms(
      "status IN ('pending','running','completed','failed','unknown')",
      "(status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'unknown'::text]))",
    ),
    forms(
      "progress_phase IS NULL OR progress_phase IN ('queued','preparing','generating','validating','saving')",
      "((progress_phase IS NULL) OR (progress_phase = ANY (ARRAY['queued'::text, 'preparing'::text, 'generating'::text, 'validating'::text, 'saving'::text])))",
    ),
    ...['reserved_microusd', 'charged_microusd'].map((column) =>
      forms(`${column} >= 0`, `(${column} >= 0)`),
    ),
    forms(
      "result IS NULL OR (jsonb_typeof(result) = 'object' AND result->>'classification' IS NOT DISTINCT FROM 'private')",
      "((result IS NULL) OR ((jsonb_typeof(result) = 'object'::text) AND (NOT ((result ->> 'classification'::text) IS DISTINCT FROM 'private'::text))))",
    ),
  ],
};
export const candidateEnrichmentDefaults = [
  ['candidate_enrichment_runs.status', new Set(["'pending'"])],
  ['candidate_enrichment_runs.reserved_microusd', new Set(['0'])],
  ['candidate_enrichment_runs.charged_microusd', new Set(['0'])],
  ['candidate_enrichment_runs.created_at', new Set(['now'])],
];
export const candidateEnrichmentUniqueIndexes = [
  'candidate_enrichment_runs|owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision',
];
export const candidateEnrichmentIndexes = [
  'candidate_enrichment_runs|owner_id,created_at',
  'candidate_enrichment_runs|budget_day',
];
export const candidateEnrichmentIdentityPredicates = [
  "status <> 'failed'",
  "(status <> 'failed'::text)",
].map(canonical);
