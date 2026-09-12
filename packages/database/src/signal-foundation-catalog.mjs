// Independent, exact catalog expectations for migration 0004. This is not
// inferred from the installed schema: weakening DDL must fail verification.
export const signalFoundationColumns = {
  person_profiles: { entity_id: ['text', true], entity_type: ['entity_type', true] },
  organization_profiles: { entity_id: ['text', true], entity_type: ['entity_type', true] },
  public_source_evidence: {
    id: ['text', true],
    source_id: ['text', true],
    source_url: ['text', true],
    locator: ['text', true],
    excerpt: ['text', true],
    content_hash: ['text', true],
    captured_at: ['timestamp with time zone', true],
    source_published_at: ['timestamp with time zone', false],
    verification_status: ['text', true],
  },
  signal_versions: {
    signal_id: ['text', true],
    version: ['integer', true],
    schema_version: ['text', true],
    title: ['text', true],
    type: ['signal_type', true],
    occurred_at: ['timestamp with time zone', true],
    date_precision: ['text', true],
    date_basis: ['text', true],
    captured_at: ['timestamp with time zone', true],
    summary: ['text', true],
    analysis: ['text', false],
    importance: ['integer', true],
    strength: ['integer', true],
    confidence: ['double precision', true],
    novelty: ['double precision', true],
    revision_reason: ['text', true],
    origin: ['text', true],
    legacy_status: ['signal_status', false],
    content_hash: ['text', true],
    created_at: ['timestamp with time zone', true],
  },
  signal_version_evidence: {
    signal_id: ['text', true],
    version: ['integer', true],
    evidence_id: ['text', true],
    claim: ['text', true],
    relation: ['text', true],
  },
  signal_version_people: {
    signal_id: ['text', true],
    version: ['integer', true],
    person_id: ['text', true],
    evidence_id: ['text', true],
    event_role: ['text', true],
    verification_status: ['text', true],
  },
  signal_version_organizations: {
    signal_id: ['text', true],
    version: ['integer', true],
    organization_id: ['text', true],
    evidence_id: ['text', true],
    event_role: ['text', true],
    verification_status: ['text', true],
  },
  signal_version_topics: {
    signal_id: ['text', true],
    version: ['integer', true],
    topic_id: ['text', true],
  },
};

export const signalFoundationPrimaryKeys = [
  'person_profiles|entity_id',
  'organization_profiles|entity_id',
  'public_source_evidence|id',
  'signal_versions|signal_id,version',
  'signal_version_evidence|signal_id,version,evidence_id',
  'signal_version_people|signal_id,version,person_id,evidence_id',
  'signal_version_organizations|signal_id,version,organization_id,evidence_id',
  'signal_version_topics|signal_id,version,topic_id',
];

export const signalFoundationForeignKeys = [
  'person_profiles|entity_id,entity_type|entities|id,type|a|a|false',
  'organization_profiles|entity_id,entity_type|entities|id,type|a|a|false',
  'public_source_evidence|source_id|sources|id|a|a|false',
  'signal_versions|signal_id|signals|id|a|a|false',
  'signal_version_evidence|signal_id,version|signal_versions|signal_id,version|a|a|false',
  'signal_version_evidence|evidence_id|public_source_evidence|id|a|a|false',
  'signal_version_people|person_id|person_profiles|entity_id|a|a|false',
  'signal_version_people|signal_id,version,evidence_id|signal_version_evidence|signal_id,version,evidence_id|a|a|false',
  'signal_version_organizations|organization_id|organization_profiles|entity_id|a|a|false',
  'signal_version_organizations|signal_id,version,evidence_id|signal_version_evidence|signal_id,version,evidence_id|a|a|false',
  'signal_version_topics|signal_id,version|signal_versions|signal_id,version|a|a|false',
  'signal_version_topics|topic_id|topics|id|a|a|false',
];

const verificationCheck = ["verification_status=anyarray['pending','verified','rejected']"];
export const signalFoundationChecks = {
  person_profiles: [["entity_type='person'"]],
  organization_profiles: [["entity_type=anyarray['company','institution']"]],
  public_source_evidence: [
    ["id~'[^[:space:]]'"],
    ["source_url~'^https://[^[:space:]]+$'"],
    ["locator~'[^[:space:]]'"],
    ["excerpt~'[^[:space:]]'"],
    ["content_hash~'^[a-f0-9]{64}$'"],
    ['isfinitecaptured_at'],
    ['source_published_atisnullorisfinitesource_published_at'],
    verificationCheck,
  ],
  signal_versions: [
    ['version>0'],
    ["schema_version='3.0.0'"],
    ["title~'[^[:space:]]'"],
    ['isfiniteoccurred_at'],
    ["date_precision=anyarray['day','instant']"],
    [
      "date_precision<>'day'ordate_trunc'day',occurred_atattimezone'utc'=occurred_atattimezone'utc'",
    ],
    ["date_basis~'[^[:space:]]'"],
    ['isfinitecaptured_at'],
    ["summary~'[^[:space:]]'"],
    ["analysisisnulloranalysis~'[^[:space:]]'"],
    ['importance>=1andimportance<=5', 'importancebetween1and5'],
    ['strength>=1andstrength<=5', 'strengthbetween1and5'],
    [
      'confidence>=0andconfidence<=1',
      "confidence>='0'andconfidence<='1'",
      'confidencebetween0and1',
    ],
    ['novelty>=0andnovelty<=1', "novelty>='0'andnovelty<='1'", 'noveltybetween0and1'],
    ["revision_reason~'[^[:space:]]'"],
    ["origin=anyarray['legacy_seed','pipeline','manual']"],
    ["origin='legacy_seed'=legacy_statusisnotnull"],
    ["content_hash~'^[a-f0-9]{64}$'"],
    ['isfinitecreated_at'],
  ],
  signal_version_evidence: [
    ["claim~'[^[:space:]]'"],
    ["relation=anyarray['supports','contradicts','context']"],
  ],
  signal_version_people: [["event_role~'[^[:space:]]'"], verificationCheck],
  signal_version_organizations: [
    ["event_role=anyarray['subject','participant','background']"],
    verificationCheck,
  ],
};

export const signalFoundationDefaults = [
  ['person_profiles.entity_type', new Set(["'person'"])],
  ['public_source_evidence.verification_status', new Set(["'pending'"])],
  ['signal_versions.schema_version', new Set(["'3.0.0'"])],
  ['signal_versions.created_at', new Set(['now'])],
  ['signal_version_people.verification_status', new Set(["'pending'"])],
  ['signal_version_organizations.verification_status', new Set(["'pending'"])],
];

export const signalFoundationIndexes = [
  'public_source_evidence|source_id',
  'signal_versions|occurred_at',
  'signal_version_evidence|evidence_id',
  'signal_version_people|person_id',
  'signal_version_organizations|organization_id',
  'signal_version_topics|topic_id',
];
