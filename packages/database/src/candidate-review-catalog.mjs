import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
const required = (type) => [type, true];
export const candidateReviewFunctionHashes = {
  hzense_guard_review_history: 'b0a8eb600259ea437b4885d5a2f9646b9b4a8c24c9603719a0bbf7c16626d6e0',
};
export const candidateReviewTriggers = [
  'candidate_reviews',
  'candidate_review_conversions',
  'candidate_review_attestations',
].flatMap((table_name) => [
  {
    table_name,
    name: `${table_name}_guard_trg`,
    trigger_type: 27,
    routine_name: 'hzense_guard_review_history',
  },
  {
    table_name,
    name: `${table_name}_no_truncate_trg`,
    trigger_type: 34,
    routine_name: 'hzense_guard_review_history',
  },
]);
export const candidateReviewColumns = {
  candidate_reviews: {
    id: required('uuid'),
    request_id: required('uuid'),
    owner_id: required('text'),
    run_id: required('uuid'),
    candidate_index: required('integer'),
    revision: required('integer'),
    material_hash: required('text'),
    fingerprint: required('text'),
    decision: required('text'),
    note: required('text'),
    draft: required('jsonb'),
    created_at: required('timestamp with time zone'),
  },
};
export const candidateReviewPrimaryKeys = ['candidate_reviews|id'];
export const candidateReviewForeignKeys = [
  'candidate_reviews|run_id|signal_generation_runs|id|a|a|false',
  'candidate_review_conversions|review_id|candidate_reviews|id|a|a|false',
  'candidate_review_conversions|signal_id|signals|id|a|a|false',
  'candidate_review_conversions|signal_id,source_version|signal_versions|signal_id,version|a|a|false',
];
const forms = (...sql) => sql.map((s) => canonical(`CHECK (${s})`));
export const candidateReviewChecks = {
  candidate_reviews: [
    forms('candidate_index BETWEEN 0 AND 4', '((candidate_index >= 0) AND (candidate_index <= 4))'),
    forms('revision > 0', '(revision > 0)'),
    ...['material_hash', 'fingerprint'].map((c) =>
      forms(`${c} ~ '^[a-f0-9]{64}$'`, `(${c} ~ '^[a-f0-9]{64}$'::text)`),
    ),
    forms(
      "decision IN ('draft','needs_evidence','rejected','submit_verification')",
      "(decision = ANY (ARRAY['draft'::text, 'needs_evidence'::text, 'rejected'::text, 'submit_verification'::text]))",
    ),
    forms("jsonb_typeof(draft) = 'object'", "(jsonb_typeof(draft) = 'object'::text)"),
  ],
};
export const candidateReviewDefaults = [['candidate_reviews.created_at', new Set(['now'])]];
export const candidateReviewUniqueIndexes = [
  'candidate_reviews|request_id',
  'candidate_reviews|run_id,candidate_index,revision',
];
candidateReviewColumns.candidate_review_conversions = {
  request_key: required('text'),
  review_id: required('uuid'),
  owner_id: required('text'),
  signal_id: required('text'),
  source_version: required('integer'),
  created_at: required('timestamp with time zone'),
};
candidateReviewPrimaryKeys.push('candidate_review_conversions|request_key');
candidateReviewUniqueIndexes.push('candidate_review_conversions|review_id');
candidateReviewDefaults.push(['candidate_review_conversions.created_at', new Set(['now'])]);
candidateReviewChecks.candidate_review_conversions = [
  forms('source_version > 0', '(source_version > 0)'),
  forms(
    "request_key ~ '^[A-Za-z0-9._:-]{1,200}$'",
    "(request_key ~ '^[A-Za-z0-9._:-]{1,200}$'::text)",
  ),
];
candidateReviewColumns.candidate_review_attestations = {
  verification_id: required('uuid'),
  review_id: required('uuid'),
  owner_id: required('text'),
  key_id: required('text'),
  payload: required('text'),
  signature: required('text'),
  created_at: required('timestamp with time zone'),
};
candidateReviewPrimaryKeys.push('candidate_review_attestations|verification_id');
candidateReviewForeignKeys.push(
  'candidate_review_attestations|review_id|candidate_reviews|id|a|a|false',
);
candidateReviewDefaults.push(['candidate_review_attestations.created_at', new Set(['now'])]);
candidateReviewChecks.candidate_review_attestations = [
  ['key_id', 200],
  ['payload', 262144],
  ['signature', 1024],
].map(([c, max]) =>
  forms(`length(${c}) BETWEEN 1 AND ${max}`, `((length(${c}) >= 1) AND (length(${c}) <= ${max}))`),
);
