import { canonicalPublicationControlCheck } from './signal-publication-control-catalog.mjs';

// Independent 0013 physical contract. AI configuration is private and has no
// relationship that can itself authorize an ingestion or publication task.
export const aiConfigurationColumns = {
  ai_connections: {
    id: ['uuid', true],
    revision: ['integer', true],
    name: ['text', true],
    protocol: ['text', true],
    base_url: ['text', true],
    enabled: ['boolean', true],
    settings: ['jsonb', true],
    encrypted_key: ['jsonb', false],
    created_at: ['timestamp with time zone', true],
    updated_at: ['timestamp with time zone', true],
  },
  ai_connection_versions: {
    connection_id: ['uuid', true],
    revision: ['integer', true],
    snapshot: ['jsonb', true],
    created_at: ['timestamp with time zone', true],
  },
  ai_profiles: {
    id: ['uuid', true],
    revision: ['integer', true],
    name: ['text', true],
    stages: ['jsonb', true],
    created_at: ['timestamp with time zone', true],
    updated_at: ['timestamp with time zone', true],
  },
  ai_profile_versions: {
    profile_id: ['uuid', true],
    revision: ['integer', true],
    snapshot: ['jsonb', true],
    created_at: ['timestamp with time zone', true],
  },
  ai_probe_runs: {
    id: ['uuid', true],
    connection_id: ['uuid', true],
    connection_revision: ['integer', true],
    kind: ['text', true],
    model_id: ['text', false],
    fingerprint: ['text', true],
    status: ['text', true],
    configuration: ['jsonb', true],
    reserved_microusd: ['bigint', true],
    charged_microusd: ['bigint', true],
    input_tokens: ['integer', false],
    output_tokens: ['integer', false],
    result: ['jsonb', true],
    error_code: ['text', false],
    created_at: ['timestamp with time zone', true],
    finished_at: ['timestamp with time zone', false],
  },
};
export const aiConfigurationPrimaryKeys = [
  'ai_connections|id',
  'ai_connection_versions|connection_id,revision',
  'ai_profiles|id',
  'ai_profile_versions|profile_id,revision',
  'ai_probe_runs|id',
];
export const aiConfigurationForeignKeys = [
  'ai_connection_versions|connection_id|ai_connections|id|a|a|false',
  'ai_profile_versions|profile_id|ai_profiles|id|a|a|false',
  'ai_probe_runs|connection_id,connection_revision|ai_connection_versions|connection_id,revision|a|a|false',
];
const forms = (...values) => values.map(canonicalPublicationControlCheck);
const revision = forms('CHECK (revision >= 1)', 'CHECK ((revision >= 1))');
const object = (column) =>
  forms(
    `CHECK (jsonb_typeof(${column}) = 'object')`,
    `CHECK ((jsonb_typeof(${column}) = 'object'::text))`,
    `CHECK (jsonb_typeof(${column}) = 'object'::text)`,
  );
const nonnegative = (column) => forms(`CHECK (${column} >= 0)`, `CHECK ((${column} >= 0))`);
const nullableNonnegative = (column) =>
  forms(
    `CHECK (${column} IS NULL OR ${column} >= 0)`,
    `CHECK (((${column} IS NULL) OR (${column} >= 0)))`,
  );
export const aiConfigurationChecks = {
  ai_connections: [
    revision,
    forms(
      "CHECK (protocol = 'openai-compatible')",
      "CHECK ((protocol = 'openai-compatible'::text))",
    ),
    object('settings'),
    forms(
      "CHECK (encrypted_key IS NULL OR jsonb_typeof(encrypted_key) = 'object')",
      "CHECK (((encrypted_key IS NULL) OR (jsonb_typeof(encrypted_key) = 'object'::text)))",
    ),
  ],
  ai_connection_versions: [revision, object('snapshot')],
  ai_profiles: [revision, object('stages')],
  ai_profile_versions: [revision, object('snapshot')],
  ai_probe_runs: [
    forms(
      "CHECK (kind IN ('models', 'connection', 'structured_output', 'tool_calling'))",
      "CHECK ((kind = ANY (ARRAY['models'::text, 'connection'::text, 'structured_output'::text, 'tool_calling'::text])))",
    ),
    forms(
      "CHECK (fingerprint ~ '^[a-f0-9]{64}$')",
      "CHECK ((fingerprint ~ '^[a-f0-9]{64}$'::text))",
    ),
    forms(
      "CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'stale'))",
      "CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'unknown'::text, 'stale'::text])))",
    ),
    object('configuration'),
    nonnegative('reserved_microusd'),
    nonnegative('charged_microusd'),
    nullableNonnegative('input_tokens'),
    nullableNonnegative('output_tokens'),
    object('result'),
  ],
};
export const aiConfigurationDefaults = [
  ['ai_connections.revision', new Set(['1'])],
  ['ai_connections.enabled', new Set(['false'])],
  ['ai_profiles.revision', new Set(['1'])],
  ['ai_probe_runs.reserved_microusd', new Set(['0'])],
  ['ai_probe_runs.charged_microusd', new Set(['0'])],
  ['ai_probe_runs.result', new Set(["'{}'"])],
  ...Object.entries(aiConfigurationColumns).flatMap(([table, columns]) =>
    ['created_at', 'updated_at']
      .filter((column) => Object.hasOwn(columns, column))
      .map((column) => [`${table}.${column}`, new Set(['now'])]),
  ),
];
export const aiConfigurationIndexes = ['ai_probe_runs|connection_id,created_at'];
