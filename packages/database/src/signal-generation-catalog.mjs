import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
const required = (type) => [type, true];
const uuid = required('uuid'),
  text = required('text'),
  integer = required('integer');
export const signalGenerationColumns = {
  signal_generation_runs: {
    id: uuid,
    owner_id: text,
    batch_id: uuid,
    item_id: uuid,
    source_fence: integer,
    source_hash: text,
    profile_id: uuid,
    profile_revision: integer,
    generation_version: text,
    fingerprint: text,
    snapshot: required('jsonb'),
    configuration: required('jsonb'),
    status: text,
    lease_token: ['uuid', false],
    lease_until: ['timestamp with time zone', false],
    budget_day: ['date', false],
    reserved_microusd: required('bigint'),
    charged_microusd: required('bigint'),
    result: ['jsonb', false],
    error_code: ['text', false],
    created_at: required('timestamp with time zone'),
    finished_at: ['timestamp with time zone', false],
    deleted_at: ['timestamp with time zone', false],
    progress_phase: ['text', false],
    progress_at: ['timestamp with time zone', false],
    started_at: ['timestamp with time zone', false],
  },
};
export const signalGenerationPrimaryKeys = ['signal_generation_runs|id'];
export const signalGenerationForeignKeys = [];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));
export const signalGenerationChecks = {
  signal_generation_runs: [
    forms(
      "progress_phase IS NULL OR progress_phase IN ('queued','preparing','generating','validating','saving')",
      "((progress_phase IS NULL) OR (progress_phase = ANY (ARRAY['queued'::text, 'preparing'::text, 'generating'::text, 'validating'::text, 'saving'::text])))",
    ),
    forms('source_fence > 0', '(source_fence > 0)'),
    forms('profile_revision > 0', '(profile_revision > 0)'),
    ...['source_hash', 'fingerprint'].map((column) =>
      forms(`${column} ~ '^[a-f0-9]{64}$'`, `(${column} ~ '^[a-f0-9]{64}$'::text)`),
    ),
    ...['snapshot', 'configuration'].map((column) =>
      forms(`jsonb_typeof(${column}) = 'object'`, `(jsonb_typeof(${column}) = 'object'::text)`),
    ),
    forms(
      "status IN ('pending','running','completed','failed','unknown','cancelled')",
      "(status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'unknown'::text, 'cancelled'::text]))",
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
export const signalGenerationDefaults = [
  ['signal_generation_runs.status', new Set(["'pending'"])],
  ['signal_generation_runs.reserved_microusd', new Set(['0'])],
  ['signal_generation_runs.charged_microusd', new Set(['0'])],
  ['signal_generation_runs.created_at', new Set(['now'])],
];
export const signalGenerationUniqueIndexes = [
  'signal_generation_runs|owner_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version',
  'signal_generation_runs|id,owner_id',
];
export const signalGenerationIndexes = [
  'signal_generation_runs|owner_id,created_at',
  'signal_generation_runs|budget_day',
  'signal_generation_runs|batch_id',
];

// Keep literals and operators exact when accepting the one partial unique index.
export const signalGenerationIdentityPredicates = [
  "NOT (status = 'cancelled' AND lease_token IS NULL AND lease_until IS NULL AND budget_day IS NULL AND reserved_microusd = 0 AND charged_microusd = 0)",
  "(NOT ((status = 'cancelled'::text) AND (lease_token IS NULL) AND (lease_until IS NULL) AND (budget_day IS NULL) AND (reserved_microusd = 0) AND (charged_microusd = 0)))",
].map(canonical);
