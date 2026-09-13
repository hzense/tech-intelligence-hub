import { canonicalPublicationControlCheck } from './signal-publication-control-catalog.mjs';

// Independent migration 0011 contract: stored reports are private evidence of
// a recorded decision, not a factual verification or a publication permission.
export const candidateVerificationColumns = {
  signal_candidate_verifications: {
    verification_id: ['uuid', true],
    signal_id: ['text', true],
    source_version: ['integer', true],
    source_content_hash: ['text', true],
    bundle_fingerprint: ['text', true],
    verifier_id: ['uuid', true],
    policy_version: ['text', true],
    report_hash: ['text', true],
    decision: ['text', true],
    checks: ['jsonb', true],
    verified_at: ['timestamp with time zone', true],
    expires_at: ['timestamp with time zone', true],
    created_xid: ['xid8', true],
  },
  signal_candidate_assembly_receipts: {
    request_key: ['text', true],
    request_fingerprint: ['text', true],
    verification_id: ['uuid', true],
    signal_id: ['text', true],
    source_version: ['integer', true],
    target_version: ['integer', true],
    content_hash: ['text', true],
  },
};
export const candidateVerificationPrimaryKeys = [
  'signal_candidate_verifications|verification_id',
  'signal_candidate_assembly_receipts|request_key',
];
export const candidateVerificationForeignKeys = [
  'signal_candidate_verifications|signal_id,source_version|signal_versions|signal_id,version|a|a|false',
  'signal_candidate_assembly_receipts|verification_id,signal_id,source_version|signal_candidate_verifications|verification_id,signal_id,source_version|a|a|false',
  'signal_candidate_assembly_receipts|signal_id,target_version|signal_versions|signal_id,version|a|a|false',
];
function forms(...definitions) {
  return definitions.map(canonicalPublicationControlCheck);
}
function hashCheck(column) {
  return forms(
    `CHECK (((${column} COLLATE "C") ~ '^[a-f0-9]{64}$'::text))`,
    `CHECK (${column} COLLATE "C" ~ '^[a-f0-9]{64}$')`,
  );
}
function timestampChecks(column) {
  return [
    forms(`CHECK (isfinite(${column}))`),
    forms(
      `CHECK (((EXTRACT(year FROM (${column} AT TIME ZONE 'UTC'::text)) >= (1)::numeric) AND (EXTRACT(year FROM (${column} AT TIME ZONE 'UTC'::text)) <= (9999)::numeric)))`,
      `CHECK (extract(year FROM ${column} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999)`,
    ),
    forms(
      `CHECK ((date_trunc('milliseconds'::text, ${column}) = ${column}))`,
      `CHECK (date_trunc('milliseconds', ${column}) = ${column})`,
    ),
  ];
}
const signalIdCheck = forms(
  "CHECK ((signal_id ~ '[^[:space:]]'::text))",
  "CHECK (signal_id ~ '[^[:space:]]')",
);
const sourceVersionCheck = forms('CHECK ((source_version > 0))', 'CHECK (source_version > 0)');
export const candidateVerificationChecks = {
  signal_candidate_verifications: [
    signalIdCheck,
    sourceVersionCheck,
    hashCheck('source_content_hash'),
    hashCheck('bundle_fingerprint'),
    forms(
      "CHECK ((policy_version = 'candidate-verification-v1'::text))",
      "CHECK (policy_version = 'candidate-verification-v1')",
    ),
    hashCheck('report_hash'),
    forms(
      "CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text])))",
      "CHECK (decision IN ('approved', 'rejected'))",
    ),
    forms(
      "CHECK ((jsonb_typeof(checks) = 'object'::text))",
      "CHECK (jsonb_typeof(checks) = 'object')",
    ),
    ...timestampChecks('verified_at'),
    ...timestampChecks('expires_at'),
    forms('CHECK ((expires_at > verified_at))', 'CHECK (expires_at > verified_at)'),
    forms(
      "CHECK ((expires_at <= (verified_at + '24:00:00'::interval)))",
      "CHECK (expires_at <= verified_at + interval '24 hours')",
    ),
  ],
  signal_candidate_assembly_receipts: [
    forms(
      'CHECK (((request_key COLLATE "C") ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$\'::text))',
      'CHECK (request_key COLLATE "C" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$\')',
    ),
    forms(
      'CHECK (((length(request_key) >= 1) AND (length(request_key) <= 200)))',
      'CHECK (length(request_key) BETWEEN 1 AND 200)',
    ),
    hashCheck('request_fingerprint'),
    signalIdCheck,
    sourceVersionCheck,
    forms('CHECK ((target_version > source_version))', 'CHECK (target_version > source_version)'),
    hashCheck('content_hash'),
  ],
};
export const candidateVerificationUniqueIndexes = [
  'signal_candidate_verifications|verification_id,signal_id,source_version',
  'signal_candidate_assembly_receipts|verification_id',
];
export const candidateVerificationDefaults = [
  [
    'signal_candidate_verifications.verified_at',
    new Set(["date_trunc'milliseconds',statement_timestamp"]),
  ],
];
export const candidateVerificationStampedTables = Object.freeze(['signal_candidate_verifications']);
export const candidateVerificationFunctionHashes = Object.freeze({
  hzense_guard_candidate_verification:
    'a0ad241633a4ef614a26924d35394e04bd96b95d8e971ae4ba964b651c81be22',
});
export const candidateVerificationTriggers = Object.freeze([
  ...['signal_candidate_verifications', 'signal_candidate_assembly_receipts'].flatMap(
    (table_name) => [
      Object.freeze({
        table_name,
        name: `${table_name}_guard_trg`,
        trigger_type: 31,
        routine_name: 'hzense_guard_candidate_verification',
      }),
      Object.freeze({
        table_name,
        name: `${table_name}_no_truncate_trg`,
        trigger_type: 34,
        routine_name: 'hzense_guard_candidate_verification',
      }),
    ],
  ),
  Object.freeze({
    table_name: 'signal_candidate_assembly_receipts',
    name: 'signal_candidate_assembly_receipts_approval_trg',
    trigger_type: 5,
    routine_name: 'hzense_guard_candidate_verification',
    constraint_trigger: true,
    deferrable: true,
    initially_deferred: true,
  }),
]);
