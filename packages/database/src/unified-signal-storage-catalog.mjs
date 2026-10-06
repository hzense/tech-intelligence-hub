// Reviewed PostgreSQL 18 catalog captured for 0029; never derived at verification time.
export const unifiedStorageChecks = {
  signal_versions: [
    ["check(((analysisisnull)or(analysis~'[^[:space:]]'::text)))"],
    ['check(isfinite(captured_at))'],
    ['check(((confidence>=(0)::doubleprecision)and(confidence<=(1)::doubleprecision)))'],
    ["check((content_hash~'^[a-f0-9]{64}$'::text))"],
    ['check(isfinite(created_at))'],
    ["check((date_basis~'[^[:space:]]'::text))"],
    ["check((date_precision=any(array['day'::text,'instant'::text])))"],
    [
      "check(((date_precision<>'day'::text)or(date_trunc('day'::text,(occurred_atattimezone'UTC'::text))=(occurred_atattimezone'UTC'::text))))",
    ],
    ['check(((importance>=1)and(importance<=5)))'],
    [
      "check(((schema_version<>'3.0.0'::text)or((origin='legacy_seed'::text)=(legacy_statusisnotnull))))",
    ],
    ['check(((novelty>=(0)::doubleprecision)and(novelty<=(1)::doubleprecision)))'],
    ['check(isfinite(occurred_at))'],
    [
      "check((((schema_version='3.0.0'::text)and(origin=any(array['legacy_seed'::text,'pipeline'::text,'manual'::text])))or((schema_version='4.0.0'::text)and(origin=any(array['legacy_seed'::text,'ai_generation'::text])))))",
    ],
    ["check((revision_reason~'[^[:space:]]'::text))"],
    ["check((schema_version=any(array['3.0.0'::text,'4.0.0'::text])))"],
    [
      "check(((((schema_version='3.0.0'::text)and(titleisnotnull)and(typeisnotnull)and(occurred_atisnotnull)and(date_precisionisnotnull)and(date_basisisnotnull)and(captured_atisnotnull)and(summaryisnotnull)and(importanceisnotnull)and(strengthisnotnull)and(confidenceisnotnull)and(noveltyisnotnull)and(contentisnull)and(publication_basisisnull)and(lifecycle_statusisnull)and(recorded_atisnull)and(source_recordisnull)and(source_record_hashisnull))or((schema_version='4.0.0'::text)and(titleisnull)and(typeisnull)and(occurred_atisnull)and(date_precisionisnull)and(date_basisisnull)and(captured_atisnull)and(summaryisnull)and(analysisisnull)and(importanceisnull)and(strengthisnull)and(confidenceisnull)and(noveltyisnull)and(legacy_statusisnull)and(jsonb_typeof(content)='object'::text)and(lifecycle_status=any(array['draft'::text,'published'::text,'withdrawn'::text]))and(((lifecycle_status='draft'::text)and(publication_basisisnull))or((lifecycle_status=any(array['published'::text,'withdrawn'::text]))and(((origin='legacy_seed'::text)and(publication_basis='legacy_import'::text))or((origin='ai_generation'::text)and(publication_basis='manual_confirmation'::text)))))and((recorded_atisnull)orisfinite(recorded_at))and(jsonb_typeof(source_record)='object'::text)and((source_record_hashcollate\"C\")~'^[a-f0-9]{64}$'::text)))istrue))",
    ],
    ['check(((strength>=1)and(strength<=5)))'],
    ["check((summary~'[^[:space:]]'::text))"],
    ["check((title~'[^[:space:]]'::text))"],
    ['check((version>0))'],
  ],
  signals: [
    ['check(((confidence>=(0)::doubleprecision)and(confidence<=(1)::doubleprecision)))'],
    ['check(((importance>=1)and(importance<=5)))'],
    ['check(((novelty>=(0)::doubleprecision)and(novelty<=(1)::doubleprecision)))'],
    ["check((source_url~'^https://'::text))"],
    [
      "check(((((storage_schema='3.0.0'::text)and(originisnull)and(latest_versionisnull)and(titleisnotnull)and(typeisnotnull)and(statusisnotnull)and(occurred_atisnotnull)and(captured_atisnotnull)and(source_idisnotnull)and(source_urlisnotnull)and(summaryisnotnull)and(importanceisnotnull)and(strengthisnotnull)and(confidenceisnotnull)and(noveltyisnotnull)and(metadataisnotnull))or((storage_schema='4.0.0'::text)and(origin=any(array['legacy_seed'::text,'ai_generation'::text]))and(latest_version>0)and((idcollate\"C\")~'^[a-z0-9]+(-[a-z0-9]+)*$'::text)and(length(id)<=200)and(titleisnull)and(typeisnull)and(statusisnull)and(occurred_atisnull)and(captured_atisnull)and(source_idisnull)and(source_urlisnull)and(summaryisnull)and(importanceisnull)and(strengthisnull)and(confidenceisnull)and(noveltyisnull)and(metadataisnull)))istrue))",
    ],
    ['check(((strength>=1)and(strength<=5)))'],
  ],
};
export const unifiedStorageFunctionHashes = {
  hzense_guard_unified_signal_head:
    '4ffd3f6e921ff11d7ce46cbfd496bd1827d065d0cf013c65e90e8ea8f03bd996',
  hzense_guard_legacy_signal_link:
    'b2a56d3099e74022fbe8fb0510718fc97f5dc80ff0dec4d28382cc1864801e50',
  hzense_guard_unified_signal_storage:
    'ebeecc738f1c7f9f08eeb5deff784639dead210654fddde07cafadc3a79c0603',
};
export const unifiedStorageColumns = {
  signals: {
    storage_schema: ['text', true],
    origin: ['text', false],
    latest_version: ['integer', false],
  },
  signal_versions: {
    content: ['jsonb', false],
    publication_basis: ['text', false],
    lifecycle_status: ['text', false],
    recorded_at: ['timestamp with time zone', false],
    source_record: ['jsonb', false],
    source_record_hash: ['text', false],
  },
};
// Nullability is conditional, enforced by exact storage-shape checks above.
export const unifiedNullableLegacyColumns = {
  signals: [
    'title',
    'type',
    'status',
    'occurred_at',
    'captured_at',
    'source_id',
    'source_url',
    'summary',
    'importance',
    'strength',
    'confidence',
    'novelty',
    'metadata',
  ],
  signal_versions: [
    'title',
    'type',
    'occurred_at',
    'date_precision',
    'date_basis',
    'captured_at',
    'summary',
    'importance',
    'strength',
    'confidence',
    'novelty',
  ],
};
export const unifiedStorageTriggers = [
  ...['signals', 'signal_versions'].flatMap((table_name) => [
    {
      table_name,
      name: table_name + '_unified_storage_trg',
      trigger_type: 31,
      routine_name: 'hzense_guard_unified_signal_storage',
    },
    {
      table_name,
      name: table_name + '_unified_head_trg',
      trigger_type: 29,
      routine_name: 'hzense_guard_unified_signal_head',
      constraint_trigger: true,
      deferrable: true,
      initially_deferred: true,
    },
  ]),
  ...[
    'signal_topics',
    'signal_entities',
    'signal_version_evidence',
    'signal_version_people',
    'signal_version_organizations',
    'signal_version_topics',
    'signal_publication_outbox',
    'signal_publication_state',
    'candidate_review_conversions',
  ].map((table_name) => ({
    table_name,
    name: table_name + '_legacy_link_trg',
    trigger_type: 23,
    routine_name: 'hzense_guard_legacy_signal_link',
  })),
];
