import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
const required = (type) => [type, true];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));

export const legacyArchiveColumns = {
  legacy_signal_archive: {
    signal_id: required('text'),
    signal: required('jsonb'),
    references: required('jsonb'),
    projection: required('jsonb'),
    content_hash: required('text'),
    record_hash: required('text'),
    imported_at: required('timestamp with time zone'),
  },
};
export const legacyArchivePrimaryKeys = ['legacy_signal_archive|signal_id'];
export const legacyArchiveDefaults = [['legacy_signal_archive.imported_at', new Set(['now'])]];
export const legacyArchiveChecks = {
  legacy_signal_archive: [
    forms('((signal_id COLLATE "C") ~ \'^[a-z0-9]+(-[a-z0-9]+)*$\'::text)'),
    forms("(jsonb_typeof(signal) = 'object'::text)"),
    forms("(NOT ((signal ->> 'id'::text) IS DISTINCT FROM signal_id))"),
    forms('(jsonb_typeof("references") = \'object\'::text)'),
    forms(
      "((projection = 'null'::jsonb) OR ((jsonb_typeof(projection) = 'object'::text) AND (NOT ((projection ->> 'id'::text) IS DISTINCT FROM signal_id))))",
    ),
    ...['content_hash', 'record_hash'].map((column) =>
      forms(`((${column} COLLATE "C") ~ '^[a-f0-9]{64}$'::text)`),
    ),
    forms('isfinite(imported_at)'),
  ],
};
export const legacyArchiveFunctionHashes = {
  hzense_guard_legacy_signal_archive:
    '5bbba323cb63759bd798dc2aca63fc2539b84fbdebe0e95f7b2c2d6ade71bc0b',
};
export const legacyArchiveTriggers = [
  {
    table_name: 'legacy_signal_archive',
    name: 'legacy_signal_archive_guard_trg',
    trigger_type: 27,
    routine_name: 'hzense_guard_legacy_signal_archive',
  },
  {
    table_name: 'legacy_signal_archive',
    name: 'legacy_signal_archive_no_truncate_trg',
    trigger_type: 34,
    routine_name: 'hzense_guard_legacy_signal_archive',
  },
];
export const legacyPublicSignalColumns = [
  ['signal_id', 'text'],
  ['content', 'jsonb'],
  ['content_hash', 'text'],
];
// Frozen after independent PostgreSQL 18 catalog inspection.
export const legacyPublicSignalViewHashes = new Set([
  'a5aab0f4a210559460489c2a4884854747d48e2fb736abfc3a11f4aabff8d760',
]);
