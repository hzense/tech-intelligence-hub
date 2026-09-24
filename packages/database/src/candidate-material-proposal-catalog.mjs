import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
const required = (type) => [type, true];
const forms = (...sql) => sql.map((value) => canonical(`CHECK (${value})`));
const ownerCheck = forms(
  'length(owner_id) BETWEEN 1 AND 200',
  '((length(owner_id) >= 1) AND (length(owner_id) <= 200))',
);
const hashCheck = (column) =>
  forms(
    `${column} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    `((${column} COLLATE "C") ~ '^[a-f0-9]{64}$'::text)`,
  );
export const materialProposalColumns = {
  candidate_material_proposals: {
    id: required('uuid'),
    request_id: required('uuid'),
    owner_id: required('text'),
    plan_hash: required('text'),
    proposal_hash: required('text'),
    payload: required('jsonb'),
    created_at: required('timestamp with time zone'),
  },
  candidate_material_approvals: {
    id: required('uuid'),
    proposal_id: required('uuid'),
    request_id: required('uuid'),
    owner_id: required('text'),
    proposal_hash: required('text'),
    approved_by: required('text'),
    created_at: required('timestamp with time zone'),
  },
};
export const materialProposalPrimaryKeys = Object.keys(materialProposalColumns).map(
  (table) => `${table}|id`,
);
export const materialProposalForeignKeys = [
  'candidate_material_proposals|request_id,owner_id|candidate_material_requests|id,owner_id|a|a|false',
  'candidate_material_approvals|request_id,owner_id|candidate_material_requests|id,owner_id|a|a|false',
  'candidate_material_approvals|proposal_id,request_id,owner_id,proposal_hash|candidate_material_proposals|id,request_id,owner_id,proposal_hash|a|a|false',
];
export const materialProposalChecks = {
  candidate_material_proposals: [
    ownerCheck,
    hashCheck('plan_hash'),
    hashCheck('proposal_hash'),
    forms("jsonb_typeof(payload) = 'object'", "(jsonb_typeof(payload) = 'object'::text)"),
  ],
  candidate_material_approvals: [
    ownerCheck,
    hashCheck('proposal_hash'),
    // pg_get_constraintdef(..., false) wraps this binary expression in its own
    // parentheses. Keep the exact native and source forms, not a loose rewrite.
    forms('approved_by = owner_id', '(approved_by = owner_id)'),
  ],
};
export const materialProposalDefaults = Object.keys(materialProposalColumns).map((table) => [
  `${table}.created_at`,
  new Set(['now']),
]);
export const materialProposalUniqueIndexes = [
  'candidate_material_proposals|request_id,proposal_hash',
  'candidate_material_proposals|id,request_id,owner_id,proposal_hash',
  'candidate_material_approvals|proposal_id',
];
export const materialProposalFunctionHashes = {
  hzense_guard_material_proposals:
    '2ab2089744a962e564e88e5f3cb6f3ef0906c7bb481e18dd8034097dc928ce96',
};
export const materialProposalTriggers = Object.keys(materialProposalColumns).flatMap(
  (table_name) => [
    {
      table_name,
      name: `${table_name}_guard_trg`,
      trigger_type: 27,
      routine_name: 'hzense_guard_material_proposals',
    },
    {
      table_name,
      name: `${table_name}_no_truncate_trg`,
      trigger_type: 34,
      routine_name: 'hzense_guard_material_proposals',
    },
  ],
);
