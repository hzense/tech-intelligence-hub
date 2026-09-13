// Independent catalog contract for migration 0005. Never derive expectations
// from the installed DDL: removed checks or widened foreign keys must fail.
export const affiliationColumns = {
  person_organization_affiliations: {
    relation_id: ['text', true],
    person_id: ['text', true],
    organization_id: ['text', true],
    relation_type: ['text', true],
    role_title: ['text', true],
    date_basis: ['text', true],
    verification_status: ['text', true],
  },
  affiliation_evidence: {
    relation_id: ['text', true],
    evidence_id: ['text', true],
    claim: ['text', true],
    relation: ['text', true],
    verification_status: ['text', true],
  },
};

export const affiliationPrimaryKeys = [
  'person_organization_affiliations|relation_id',
  'affiliation_evidence|relation_id,evidence_id',
];

export const affiliationForeignKeys = [
  'person_organization_affiliations|relation_id,person_id,organization_id,relation_type|relations|id,source_id,target_id,relation_type|a|a|false',
  'person_organization_affiliations|person_id|person_profiles|entity_id|a|a|false',
  'person_organization_affiliations|organization_id|organization_profiles|entity_id|a|a|false',
  'affiliation_evidence|relation_id|person_organization_affiliations|relation_id|a|a|false',
  'affiliation_evidence|evidence_id|public_source_evidence|id|a|a|false',
];

export const affiliationRelationChecks = [
  ["valid_fromisnullorisfinitevalid_fromandvalid_from>='0001-01-01'andvalid_from<='9999-12-31'"],
  ["valid_toisnullorisfinitevalid_toandvalid_to>='0001-01-01'andvalid_to<='9999-12-31'"],
  ['valid_fromisnullorvalid_toisnullorvalid_from<=valid_to'],
];

const verificationCheck = ["verification_status=anyarray['pending','verified','rejected']"];
export const affiliationChecks = {
  person_organization_affiliations: [
    ["relation_type=anyarray['works_at','leads','advises']"],
    ["role_title~'[^[:space:]]'"],
    ["date_basis~'[^[:space:]]'"],
    verificationCheck,
  ],
  affiliation_evidence: [
    ["claim~'[^[:space:]]'"],
    ["relation=anyarray['supports','contradicts','context']"],
    verificationCheck,
  ],
};

export const affiliationDefaults = [
  ['person_organization_affiliations.verification_status', new Set(["'pending'"])],
  ['affiliation_evidence.verification_status', new Set(["'pending'"])],
];

export const affiliationUniqueIndexes = ['relations|id,source_id,target_id,relation_type'];
export const affiliationIndexes = [
  'person_organization_affiliations|person_id',
  'person_organization_affiliations|organization_id',
  'affiliation_evidence|evidence_id',
];
