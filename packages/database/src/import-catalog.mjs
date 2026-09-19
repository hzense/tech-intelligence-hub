import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';

const required = (type) => [type, true];
const uuid = required('uuid');
const text = required('text');
const integer = required('integer');
const json = required('jsonb');
const time = required('timestamp with time zone');
const money = required('bigint');
export const importColumns = {
  import_batches: {
    id: uuid,
    owner_id: text,
    fingerprint: text,
    intent: text,
    configuration: json,
    cancelled: required('boolean'),
    created_at: time,
    deleted_at: ['timestamp with time zone', false],
  },
  import_items: {
    id: uuid,
    batch_id: uuid,
    position: integer,
    kind: text,
    declaration: json,
    status: text,
    fence: integer,
    created_at: time,
  },
  import_documents: {
    item_id: uuid,
    object_key: text,
    object_version: text,
    sha256: text,
    byte_size: integer,
    format: text,
    metadata: json,
    created_at: time,
  },
  import_attempts: {
    item_id: uuid,
    fence: integer,
    parser_version: text,
    status: text,
    lease_until: time,
    budget_day: required('date'),
    reserved_microusd: money,
    charged_microusd: money,
    error_code: ['text', false],
    created_at: time,
    finished_at: ['timestamp with time zone', false],
  },
  import_outputs: { item_id: uuid, fence: integer, content: json, created_at: time },
  import_audit: {
    id: uuid,
    batch_id: uuid,
    item_id: ['uuid', false],
    event: text,
    created_at: time,
  },
  import_daily_usage: { day: required('date'), reserved_microusd: money, charged_microusd: money },
};
export const importPrimaryKeys = [
  'import_batches|id',
  'import_items|id',
  'import_documents|item_id',
  'import_attempts|item_id,fence',
  'import_outputs|item_id,fence',
  'import_audit|id',
  'import_daily_usage|day',
];
export const importForeignKeys = [
  'import_items|batch_id|import_batches|id|a|a|false',
  'import_documents|item_id|import_items|id|a|a|false',
  'import_attempts|item_id|import_items|id|a|a|false',
  'import_outputs|item_id|import_documents|item_id|a|a|false',
  'import_outputs|item_id,fence|import_attempts|item_id,fence|a|a|false',
  'import_audit|batch_id|import_batches|id|a|a|false',
  'import_audit|item_id|import_items|id|a|a|false',
];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));
const enumeration = (column, values) =>
  forms(
    `${column} IN (${values.map((value) => `'${value}'`).join(', ')})`,
    `(${column} = ANY (ARRAY[${values.map((value) => `'${value}'::text`).join(', ')}]))`,
  );
const object = (column) =>
  forms(`jsonb_typeof(${column}) = 'object'`, `(jsonb_typeof(${column}) = 'object'::text)`);
const nonnegative = (column) => forms(`${column} >= 0`, `(${column} >= 0)`);
const sha = (column) =>
  forms(`${column} ~ '^[a-f0-9]{64}$'`, `(${column} ~ '^[a-f0-9]{64}$'::text)`);
export const importChecks = {
  import_batches: [
    sha('fingerprint'),
    enumeration('intent', ['preview', 'generate_publish']),
    object('configuration'),
  ],
  import_items: [
    forms('position >= 0', '(position >= 0)', '("position" >= 0)'),
    enumeration('kind', ['file', 'url']),
    object('declaration'),
    enumeration('status', [
      'awaiting_upload',
      'queued',
      'running',
      'completed',
      'failed',
      'unknown',
      'cancelled',
    ]),
    nonnegative('fence'),
  ],
  import_documents: [
    sha('sha256'),
    forms(
      'byte_size > 0 AND byte_size <= 26214400',
      '((byte_size > 0) AND (byte_size <= 26214400))',
    ),
    enumeration('format', [
      'pdf',
      'docx',
      'markdown',
      'text',
      'html',
      'csv',
      'xlsx',
      'png',
      'jpeg',
    ]),
    object('metadata'),
  ],
  import_attempts: [
    forms('fence > 0', '(fence > 0)'),
    enumeration('status', ['running', 'completed', 'failed', 'unknown', 'cancelled']),
    nonnegative('reserved_microusd'),
    nonnegative('charged_microusd'),
  ],
  import_outputs: [object('content')],
  import_audit: [
    enumeration('event', [
      'created',
      'received',
      'claimed',
      'completed',
      'failed',
      'unknown',
      'cancelled',
      'retried',
    ]),
  ],
  import_daily_usage: [nonnegative('reserved_microusd'), nonnegative('charged_microusd')],
};
export const importDefaults = [
  ['import_batches.cancelled', new Set(['false'])],
  ...[
    'import_items.fence',
    'import_attempts.charged_microusd',
    'import_daily_usage.reserved_microusd',
    'import_daily_usage.charged_microusd',
  ].map((column) => [column, new Set(['0'])]),
  ...Object.entries(importColumns)
    .filter(([, columns]) => Object.hasOwn(columns, 'created_at'))
    .map(([table]) => [`${table}.created_at`, new Set(['now'])]),
];
export const importIndexes = [
  'import_batches|owner_id,created_at',
  'import_items|status,created_at',
  'import_audit|batch_id,created_at',
];
export const importUniqueIndexes = ['import_items|batch_id,position'];
