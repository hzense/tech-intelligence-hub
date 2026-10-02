import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';

const required = (type) => [type, true];
const optional = (type) => [type, false];
// PostgreSQL's pg_get_constraintdef adds an outer expression pair for some
// operators while retaining the same grouping. Accept both renderings, but
// preserve every inner parenthesis, cast and literal for drift detection.
const forms = (...sql) =>
  sql.flatMap((value) => [canonical(`CHECK (${value})`), canonical(`CHECK ((${value}))`)]);

export const automationColumns = {
  automation_configs: {
    id: required('uuid'),
    owner_id: required('text'),
    revision: required('integer'),
    config: required('jsonb'),
    enabled: required('boolean'),
    next_run_at: optional('timestamp with time zone'),
    created_at: required('timestamp with time zone'),
    updated_at: required('timestamp with time zone'),
    deleted_at: optional('timestamp with time zone'),
  },
  automation_runs: {
    id: required('uuid'),
    config_id: required('uuid'),
    owner_id: required('text'),
    config_revision: required('integer'),
    snapshot: required('jsonb'),
    slot: required('text'),
    trigger: required('text'),
    status: required('text'),
    phase: required('text'),
    result: optional('jsonb'),
    frozen_inputs: optional('jsonb'),
    error_code: optional('text'),
    lease_token: optional('uuid'),
    lease_until: optional('timestamp with time zone'),
    budget_day: optional('date'),
    reserved_microusd: required('bigint'),
    charged_microusd: required('bigint'),
    cost_source: optional('text'),
    publication_status: required('text'),
    published_at: optional('timestamp with time zone'),
    created_at: required('timestamp with time zone'),
    started_at: optional('timestamp with time zone'),
    finished_at: optional('timestamp with time zone'),
  },
};

export const automationPrimaryKeys = ['automation_configs|id', 'automation_runs|id'];
export const automationForeignKeys = [
  'automation_runs|config_id,owner_id|automation_configs|id,owner_id|a|a|false',
];
export const automationUniqueIndexes = [
  'automation_configs|id,owner_id',
  'automation_runs|config_id,slot',
];
export const automationIndexes = [
  'automation_configs|enabled,next_run_at',
  'automation_runs|owner_id,created_at',
  'automation_runs|budget_day',
];
export const automationDefaults = [
  ['automation_configs.created_at', new Set(['now'])],
  ['automation_configs.updated_at', new Set(['now'])],
  ['automation_runs.reserved_microusd', new Set(['0'])],
  ['automation_runs.charged_microusd', new Set(['0'])],
  ['automation_runs.publication_status', new Set(["'private'"])],
  ['automation_runs.created_at', new Set(['now'])],
];

export const automationChecks = {
  automation_configs: [
    forms(
      'length(owner_id) BETWEEN 1 AND 200',
      '((length(owner_id) >= 1) AND (length(owner_id) <= 200))',
    ),
    forms('revision > 0'),
    forms("jsonb_typeof(config) = 'object'", "jsonb_typeof(config) = 'object'::text"),
    forms(
      "deleted_at IS NULL OR (NOT enabled AND next_run_at IS NULL AND (config -> 'enabled') IS NOT DISTINCT FROM 'false'::jsonb)",
      "((deleted_at IS NULL) OR ((NOT enabled) AND (next_run_at IS NULL) AND ((config -> 'enabled'::text) IS NOT DISTINCT FROM 'false'::jsonb)))",
      "((deleted_at IS NULL) OR ((NOT enabled) AND (next_run_at IS NULL) AND (NOT ((config -> 'enabled'::text) IS DISTINCT FROM 'false'::jsonb))))",
    ),
  ],
  automation_runs: [
    forms(
      'length(owner_id) BETWEEN 1 AND 200',
      '((length(owner_id) >= 1) AND (length(owner_id) <= 200))',
    ),
    forms('config_revision > 0'),
    forms("jsonb_typeof(snapshot) = 'object'", "jsonb_typeof(snapshot) = 'object'::text"),
    forms('length(slot) BETWEEN 1 AND 100', '((length(slot) >= 1) AND (length(slot) <= 100))'),
    forms(
      "trigger IN ('manual','scheduled')",
      "trigger = ANY (ARRAY['manual'::text, 'scheduled'::text])",
    ),
    forms(
      "status IN ('queued','running','completed','failed','unknown','cancelled')",
      "status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'unknown'::text, 'cancelled'::text])",
    ),
    forms('length(phase) BETWEEN 1 AND 60', '((length(phase) >= 1) AND (length(phase) <= 60))'),
    forms(
      "frozen_inputs IS NULL OR jsonb_typeof(frozen_inputs) = 'object'",
      "((frozen_inputs IS NULL) OR (jsonb_typeof(frozen_inputs) = 'object'::text))",
    ),
    forms('reserved_microusd >= 0'),
    forms('charged_microusd >= 0'),
    forms(
      "cost_source IS NULL OR cost_source IN ('provider','estimate','reserve')",
      "((cost_source IS NULL) OR (cost_source = ANY (ARRAY['provider'::text, 'estimate'::text, 'reserve'::text])))",
    ),
    forms(
      "publication_status IN ('private','published','withdrawn')",
      "publication_status = ANY (ARRAY['private'::text, 'published'::text, 'withdrawn'::text])",
    ),
    forms(
      "result IS NULL OR jsonb_typeof(result) = 'object'",
      "((result IS NULL) OR (jsonb_typeof(result) = 'object'::text))",
    ),
    forms(
      "error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,79}$'",
      "((error_code IS NULL) OR (error_code ~ '^[a-z][a-z0-9_]{0,79}$'::text))",
    ),
  ],
};

export const publishedTopicInsightColumns = [
  ['id', 'uuid'],
  ['result', 'jsonb'],
  ['published_at', 'timestamp with time zone'],
];

// Exact allowed predicate; pg_get_viewdef may add harmless casts, aliases and parentheses.
export const publishedTopicInsightViewExpressions = new Set([
  "selectid,result,published_atfromautomation_runswherestatus='completed'andpublication_status='published'andsnapshot->>'kind'='topic_insight'",
  "selectautomation_runs.id,automation_runs.result,automation_runs.published_atfromautomation_runswherestatus='completed'andpublication_status='published'andautomation_runs.snapshot->>'kind'='topic_insight'",
  "selectid,result,published_atfrompublic.automation_runswherestatus='completed'andpublication_status='published'andsnapshot->>'kind'='topic_insight'",
]);

export function canonicalPublishedTopicInsightView(value) {
  return value
    .toLowerCase()
    .replace(/('(?:''|[^'])*')::text/g, '$1')
    .replace(/[()\s]/g, '')
    .replace(/;$/, '');
}
