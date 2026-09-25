import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
const required = (type) => [type, true];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));
export const editorialColumns = {
  editorial_signal_revisions: {
    request_id: required('uuid'),
    run_id: required('uuid'),
    owner_id: required('text'),
    candidate_index: required('integer'),
    revision: required('integer'),
    material_hash: required('text'),
    action: required('text'),
    content: required('jsonb'),
    request_hash: required('text'),
    created_at: required('timestamp with time zone'),
  },
};
export const editorialPrimaryKeys = ['editorial_signal_revisions|request_id'];
export const editorialForeignKeys = [
  'editorial_signal_revisions|run_id,owner_id|signal_generation_runs|id,owner_id|a|a|false',
];
export const editorialUniqueIndexes = [
  'editorial_signal_revisions|run_id,candidate_index,revision',
];
export const editorialDefaults = [['editorial_signal_revisions.created_at', new Set(['now'])]];
export const editorialChecks = {
  editorial_signal_revisions: [
    forms('((length(owner_id) >= 1) AND (length(owner_id) <= 200))'),
    forms('((candidate_index >= 0) AND (candidate_index <= 4))'),
    forms('(revision > 0)'),
    ...['material_hash', 'request_hash'].map((column) =>
      forms(`((${column} COLLATE "C") ~ '^[a-f0-9]{64}$'::text)`),
    ),
    forms("(action = ANY (ARRAY['draft'::text, 'publish'::text, 'withdraw'::text]))"),
    forms("(jsonb_typeof(content) = 'object'::text)"),
  ],
};
export const editorialFunctionHashes = {
  hzense_guard_editorial_history:
    'abb695b26cee521fbc608bf60d83886f9620164dfd0dfb5128a25595f127c060',
  hzense_guard_editorial_generation_delete:
    '73441b19bfbd3c032a1234c21fe07d7262b11599ce083ad68fe66637fa718b86',
};
export const editorialTriggers = [
  {
    table_name: 'signal_generation_runs',
    name: 'signal_generation_editorial_delete_guard_trg',
    trigger_type: 19,
    routine_name: 'hzense_guard_editorial_generation_delete',
  },
  {
    table_name: 'editorial_signal_revisions',
    name: 'editorial_signal_revisions_guard_trg',
    trigger_type: 27,
    routine_name: 'hzense_guard_editorial_history',
  },
  {
    table_name: 'editorial_signal_revisions',
    name: 'editorial_signal_revisions_no_truncate_trg',
    trigger_type: 34,
    routine_name: 'hzense_guard_editorial_history',
  },
];
export const editorialPublicColumns = [
  ['signal_id', 'text'],
  ['revision', 'integer'],
  ['content', 'jsonb'],
  ['published_at', 'timestamp with time zone'],
];
// Independently reviewed PostgreSQL 18 view definition, never derived at runtime.
export const editorialPublicViewHashes = new Set([
  'f6fbb873f1758b54e87a80ff35b7bcf567600b114e125dd3a442bc9ee42f6c1f',
]);
