import { canonicalPublicationControlCheck } from './signal-publication-control-catalog.mjs';

// Independent reviewed migration 0010 contract; never derive these expected
// definitions from installed catalog or migration SQL during verification.
export const qualifiedPublicationColumns = {
  signal_qualified_publication_receipts: {
    request_key: ['text', true],
    request_fingerprint: ['text', true],
    signal_id: ['text', true],
    source_version: ['integer', true],
    target_version: ['integer', true],
    run_id: ['uuid', true],
    lease_owner: ['uuid', true],
    fencing_token: ['integer', true],
  },
};
export const qualifiedPublicationPrimaryKeys = [
  'signal_qualified_publication_receipts|request_key',
];
export const qualifiedPublicationForeignKeys = [
  'signal_qualified_publication_receipts|request_key,signal_id,target_version|signal_publication_outbox|request_key,signal_id,content_version|a|a|false',
  'signal_qualified_publication_receipts|signal_id,source_version|signal_versions|signal_id,version|a|a|false',
  'signal_qualified_publication_receipts|run_id|signal_publication_runs|run_id|a|a|false',
];
function checkForms(...definitions) {
  return definitions.map(canonicalPublicationControlCheck);
}
export const qualifiedPublicationChecks = {
  signal_qualified_publication_receipts: [
    checkForms(
      'CHECK (((request_key COLLATE "C") ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$\'::text))',
      'CHECK (request_key COLLATE "C" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$\')',
    ),
    checkForms(
      'CHECK (((length(request_key) >= 1) AND (length(request_key) <= 200)))',
      'CHECK (length(request_key) BETWEEN 1 AND 200)',
    ),
    checkForms(
      'CHECK (((request_fingerprint COLLATE "C") ~ \'^[a-f0-9]{64}$\'::text))',
      'CHECK (request_fingerprint COLLATE "C" ~ \'^[a-f0-9]{64}$\')',
    ),
    checkForms("CHECK ((signal_id ~ '[^[:space:]]'::text))", "CHECK (signal_id ~ '[^[:space:]]')"),
    checkForms('CHECK ((source_version > 0))', 'CHECK (source_version > 0)'),
    checkForms(
      'CHECK ((target_version > source_version))',
      'CHECK (target_version > source_version)',
    ),
    checkForms('CHECK ((fencing_token > 0))', 'CHECK (fencing_token > 0)'),
  ],
};
export const qualifiedPublicationUniqueIndexes = [
  'signal_publication_outbox|request_key,signal_id,content_version',
];
export const qualifiedPublicationFunctionHashes = Object.freeze({
  hzense_guard_qualified_publication_receipt:
    '200e755228fb38a122eb6880c68ac51ffe6fabec58f841b21ee73588603c2ea1',
});
export const qualifiedPublicationTriggers = Object.freeze([
  Object.freeze({
    table_name: 'signal_qualified_publication_receipts',
    name: 'signal_qualified_publication_receipts_guard_trg',
    trigger_type: 31,
    routine_name: 'hzense_guard_qualified_publication_receipt',
  }),
  Object.freeze({
    table_name: 'signal_qualified_publication_receipts',
    name: 'signal_qualified_publication_receipts_no_truncate_trg',
    trigger_type: 34,
    routine_name: 'hzense_guard_qualified_publication_receipt',
  }),
  Object.freeze({
    table_name: 'signal_qualified_publication_receipts',
    name: 'signal_qualified_publication_receipts_controls_trg',
    trigger_type: 5,
    routine_name: 'hzense_guard_qualified_publication_receipt',
    constraint_trigger: true,
    deferrable: true,
    initially_deferred: true,
  }),
]);
