// Independent migration 0009 contract. These private owner-managed fixtures
// are coordination state, not an authorization grant to a runtime role.
export const signalPublicationControlColumns = {
  signal_publication_control: {
    singleton: ['boolean', true],
    publication_enabled: ['boolean', true],
  },
  signal_publication_tasks: {
    task_id: ['uuid', true],
    policy: ['text', true],
    publication_enabled: ['boolean', true],
  },
  signal_publication_authorizations: {
    task_id: ['uuid', true],
    principal_id: ['uuid', true],
    can_publish: ['boolean', true],
  },
  signal_publication_runs: {
    run_id: ['uuid', true],
    task_id: ['uuid', true],
    principal_id: ['uuid', true],
    original_intent: ['text', true],
    status: ['text', true],
    fencing_token: ['integer', true],
    lease_owner: ['uuid', false],
    lease_expires_at: ['timestamp with time zone', false],
    created_at: ['timestamp with time zone', true],
  },
};

export const signalPublicationControlPrimaryKeys = [
  'signal_publication_control|singleton',
  'signal_publication_tasks|task_id',
  'signal_publication_authorizations|task_id,principal_id',
  'signal_publication_runs|run_id',
];

export const signalPublicationControlForeignKeys = [
  'signal_publication_authorizations|task_id|signal_publication_tasks|task_id|a|a|false',
  'signal_publication_runs|task_id,principal_id|signal_publication_authorizations|task_id,principal_id|a|a|false',
];

// Retain every grouping parenthesis, cast and literal for the mixed AND/OR
// state checks. Only SQL whitespace and keyword case are decoration here.
export function canonicalPublicationControlCheck(value) {
  return value
    .match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[^'"]+/g)
    .map((token) => (/^["']/.test(token) ? token : token.toLowerCase().replace(/\s+/g, '')))
    .join('');
}

function checkForms(...definitions) {
  return definitions.map(canonicalPublicationControlCheck);
}

// Explicitly reviewed pg_get_constraintdef and source-SQL forms. These are
// independent constants, never generated from installed or migration SQL.
export const signalPublicationControlChecks = {
  signal_publication_control: [checkForms('CHECK (singleton)')],
  signal_publication_tasks: [
    checkForms(
      "CHECK ((policy = ANY (ARRAY['auto_publish'::text, 'review_required'::text, 'preview_only'::text])))",
      "CHECK (policy IN ('auto_publish', 'review_required', 'preview_only'))",
    ),
  ],
  signal_publication_runs: [
    checkForms(
      "CHECK ((original_intent = ANY (ARRAY['auto_publish'::text, 'review_required'::text, 'preview_only'::text])))",
      "CHECK (original_intent IN ('auto_publish', 'review_required', 'preview_only'))",
    ),
    checkForms(
      "CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'cancelled'::text, 'completed'::text])))",
      "CHECK (status IN ('pending', 'running', 'cancelled', 'completed'))",
    ),
    checkForms('CHECK ((fencing_token >= 0))', 'CHECK (fencing_token >= 0)'),
    checkForms(
      "CHECK ((((status = 'pending'::text) AND (fencing_token = 0) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL)) OR ((status = 'running'::text) AND (fencing_token > 0) AND (lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status = 'cancelled'::text) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL)) OR ((status = 'completed'::text) AND (fencing_token > 0) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL))))",
      "CHECK ((status = 'pending' AND fencing_token = 0 AND lease_owner IS NULL AND lease_expires_at IS NULL) OR (status = 'running' AND fencing_token > 0 AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status = 'cancelled' AND lease_owner IS NULL AND lease_expires_at IS NULL) OR (status = 'completed' AND fencing_token > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL))",
    ),
    checkForms('CHECK (isfinite(created_at))'),
    checkForms(
      "CHECK (((EXTRACT(year FROM (created_at AT TIME ZONE 'UTC'::text)) >= (1)::numeric) AND (EXTRACT(year FROM (created_at AT TIME ZONE 'UTC'::text)) <= (9999)::numeric)))",
      "CHECK (extract(year FROM created_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)",
    ),
    checkForms(
      "CHECK ((date_trunc('milliseconds'::text, created_at) = created_at))",
      "CHECK (date_trunc('milliseconds', created_at) = created_at)",
    ),
    checkForms(
      'CHECK (((lease_expires_at IS NULL) OR isfinite(lease_expires_at)))',
      'CHECK (lease_expires_at IS NULL OR isfinite(lease_expires_at))',
    ),
    checkForms(
      "CHECK (((lease_expires_at IS NULL) OR ((EXTRACT(year FROM (lease_expires_at AT TIME ZONE 'UTC'::text)) >= (1)::numeric) AND (EXTRACT(year FROM (lease_expires_at AT TIME ZONE 'UTC'::text)) <= (9999)::numeric))))",
      "CHECK (lease_expires_at IS NULL OR extract(year FROM lease_expires_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)",
    ),
    checkForms(
      "CHECK (((lease_expires_at IS NULL) OR (date_trunc('milliseconds'::text, lease_expires_at) = lease_expires_at)))",
      "CHECK (lease_expires_at IS NULL OR date_trunc('milliseconds', lease_expires_at) = lease_expires_at)",
    ),
  ],
};

export const signalPublicationControlIndexes = [
  'signal_publication_runs|task_id,status,lease_expires_at',
];

export const signalPublicationControlDefaults = [
  ['signal_publication_control.publication_enabled', new Set(['false'])],
  ['signal_publication_tasks.policy', new Set(["'preview_only'"])],
  ['signal_publication_tasks.publication_enabled', new Set(['false'])],
  ['signal_publication_authorizations.can_publish', new Set(['false'])],
  ['signal_publication_runs.status', new Set(["'pending'"])],
  ['signal_publication_runs.fencing_token', new Set(['0'])],
  ['signal_publication_runs.created_at', new Set(["date_trunc'milliseconds',clock_timestamp"])],
];

export const signalPublicationControlFunctionHashes = Object.freeze({
  hzense_guard_publication_run: '88aa8d7337051a53374e99384bd62195502edccf2e8577416611b1df3f6818e1',
});

export const signalPublicationControlTriggers = Object.freeze([
  Object.freeze({
    table_name: 'signal_publication_runs',
    name: 'signal_publication_runs_guard_trg',
    trigger_type: 31,
    routine_name: 'hzense_guard_publication_run',
  }),
  Object.freeze({
    table_name: 'signal_publication_runs',
    name: 'signal_publication_runs_no_truncate_trg',
    trigger_type: 34,
    routine_name: 'hzense_guard_publication_run',
  }),
]);
