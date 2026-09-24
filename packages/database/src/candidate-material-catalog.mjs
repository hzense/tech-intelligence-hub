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
const objectCheck = (column) =>
  forms(`jsonb_typeof(${column}) = 'object'`, `(jsonb_typeof(${column}) = 'object'::text)`);

export const candidateMaterialColumns = {
  candidate_material_requests: {
    id: required('uuid'),
    owner_id: required('text'),
    run_id: required('uuid'),
    candidate_index: required('integer'),
    base_material_hash: required('text'),
    bundle_hash: required('text'),
    fingerprint: required('text'),
    bundle: required('jsonb'),
    created_at: required('timestamp with time zone'),
  },
  candidate_material_reports: {
    id: required('uuid'),
    request_id: required('uuid'),
    owner_id: required('text'),
    plan_hash: required('text'),
    plan: required('jsonb'),
    attestation: required('jsonb'),
    received_at: required('timestamp with time zone'),
  },
  candidate_material_receipts: {
    id: required('uuid'),
    request_id: required('uuid'),
    report_id: required('uuid'),
    owner_id: required('text'),
    plan_hash: required('text'),
    stage: required('text'),
    created_at: required('timestamp with time zone'),
  },
};
export const candidateMaterialPrimaryKeys = Object.keys(candidateMaterialColumns).map(
  (table) => `${table}|id`,
);
export const candidateMaterialForeignKeys = [
  'candidate_material_requests|run_id|signal_generation_runs|id|a|a|false',
  'candidate_material_reports|request_id,owner_id|candidate_material_requests|id,owner_id|a|a|false',
  'candidate_material_receipts|request_id,owner_id|candidate_material_requests|id,owner_id|a|a|false',
  'candidate_material_receipts|report_id,request_id,owner_id,plan_hash|candidate_material_reports|id,request_id,owner_id,plan_hash|a|a|false',
];
export const candidateMaterialChecks = {
  candidate_material_requests: [
    ownerCheck,
    forms('candidate_index BETWEEN 0 AND 4', '((candidate_index >= 0) AND (candidate_index <= 4))'),
    ...['base_material_hash', 'bundle_hash', 'fingerprint'].map(hashCheck),
    objectCheck('bundle'),
  ],
  candidate_material_reports: [
    ownerCheck,
    hashCheck('plan_hash'),
    objectCheck('plan'),
    objectCheck('attestation'),
  ],
  candidate_material_receipts: [
    ownerCheck,
    hashCheck('plan_hash'),
    forms(
      "stage IN ('registered', 'verified')",
      "(stage = ANY (ARRAY['registered'::text, 'verified'::text]))",
    ),
  ],
};
export const candidateMaterialDefaults = [
  ['candidate_material_requests.created_at', new Set(['now'])],
  ['candidate_material_reports.received_at', new Set(['now'])],
  ['candidate_material_receipts.created_at', new Set(['now'])],
];
export const candidateMaterialUniqueIndexes = [
  'candidate_material_requests|owner_id,run_id,candidate_index,base_material_hash,bundle_hash',
  'candidate_material_requests|id,owner_id',
  'candidate_material_reports|request_id,plan_hash',
  'candidate_material_reports|id,request_id,owner_id,plan_hash',
  'candidate_material_receipts|report_id,stage',
];
export const candidateMaterialIndexes = [];
export const candidateMaterialLockFunctionHash =
  '2031433da68f682b63b04c7a4df3acdc909ac4fd48e4b9ae54c0b9a96e355f79';
export const candidateMaterialRoutines = {
  hzense_lock_material_dependencies: {
    arguments: 'p_report_id uuid, p_owner_id text',
    result: 'void',
    language: 'plpgsql',
    definer: true,
    grantees: ['hzense_material_registrar', 'hzense_material_verifier'],
    hash: candidateMaterialLockFunctionHash,
  },
};
// Independent reviewed body seal. Never derive the expected hash from installed SQL.
export const candidateMaterialFunctionHashes = Object.freeze({
  hzense_guard_candidate_material_receipt_insert:
    '71fd78e41b3b8c0e874345beb45a72a7083515d014bdc67d3f4d85b5557a7609',
  hzense_guard_candidate_materials:
    'e74a8ee4afa92acfe7da1d783a848b965be602aa070794afd9b342fd0e93693c',
});
export const candidateMaterialTriggers = Object.freeze([
  Object.freeze({
    table_name: 'candidate_material_receipts',
    name: 'candidate_material_receipts_insert_guard_trg',
    trigger_type: 7,
    routine_name: 'hzense_guard_candidate_material_receipt_insert',
  }),
  ...Object.keys(candidateMaterialColumns).flatMap((table_name) => [
    Object.freeze({
      table_name,
      name: `${table_name}_guard_trg`,
      trigger_type: 27,
      routine_name: 'hzense_guard_candidate_materials',
    }),
    Object.freeze({
      table_name,
      name: `${table_name}_no_truncate_trg`,
      trigger_type: 34,
      routine_name: 'hzense_guard_candidate_materials',
    }),
  ]),
]);
