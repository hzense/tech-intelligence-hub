import { canonicalPublicationControlCheck } from './signal-publication-control-catalog.mjs';

export const currentPublicationColumns = {
  signal_verification_dependency_seals: {
    verification_id: ['uuid', true],
    dependency_seal: ['jsonb', true],
    invalidated: ['boolean', true],
  },
  signal_publication_permits: {
    event_id: ['uuid', true],
    verification_id: ['uuid', true],
    dependency_seal: ['jsonb', true],
  },
};
export const currentPublicationPrimaryKeys = [
  'signal_verification_dependency_seals|verification_id',
  'signal_publication_permits|event_id',
];
export const currentPublicationForeignKeys = [
  'signal_verification_dependency_seals|verification_id|signal_candidate_verifications|verification_id|a|a|false',
  'signal_publication_permits|event_id|signal_publication_outbox|event_id|a|a|false',
  'signal_publication_permits|verification_id|signal_candidate_verifications|verification_id|a|a|false',
];
export const currentPublicationChecks = Object.fromEntries(
  Object.keys(currentPublicationColumns).map((name) => [
    name,
    [
      [
        "CHECK ((jsonb_typeof(dependency_seal) = 'object'::text))",
        "CHECK (jsonb_typeof(dependency_seal) = 'object'::text)",
        "CHECK (jsonb_typeof(dependency_seal) = 'object')",
      ].map(canonicalPublicationControlCheck),
    ],
  ]),
);
export const currentPublicationDefaults = [
  ['signal_verification_dependency_seals.invalidated', new Set(['false'])],
];

// Independent code pins. New capabilities are exactly scoped, never generic SQL.
export const currentPublicationRoutines = {
  hzense_signal_dependency_seal: {
    arguments: 'p_signal_id text, p_source_version integer',
    result: 'jsonb',
    language: 'sql',
    volatility: 's',
    definer: false,
    utc: true,
    hash: '673b9b908b26c6990b2b6f532c80d0fe07bd1ea9523de8a531be2be278713530',
    grantees: [],
  },
  hzense_lock_publication_controls: {
    arguments: 'p_run_id uuid',
    result: 'void',
    hash: '97fee948cd6efcbae0f7cd0889a5b125e7ca8e9f9c9dc101791614c1705616b4',
    grantees: ['hzense_publisher'],
  },
  hzense_lock_publication_dependencies: {
    arguments: 'p_signal_id text, p_source_version integer',
    result: 'void',
    hash: 'cebaabfbb5010ea1ef338f733d3cf16eb7553208a216b26e30990fa01471878b',
    grantees: ['hzense_publisher'],
  },
  hzense_capture_verification_dependencies: {
    arguments: '',
    result: 'trigger',
    hash: 'e4f993c28fcf979306688f1ff36deb33ea159bb45b4db2ca673e24eaa8452e54',
    grantees: [],
  },
  hzense_guard_verification_dependency_seal: {
    arguments: '',
    result: 'trigger',
    hash: 'a18d6301c73f8214f4d27437ecbe45c9d4b002fa99404148b0fcf607a68b7d4f',
    grantees: [],
  },
  hzense_invalidate_verification_dependencies: {
    arguments: '',
    result: 'trigger',
    hash: '6baf2af5d549554f01df0e527859a233497d56cb6da319ab1e5d230c85c4def0',
    grantees: [],
  },
  hzense_guard_publication_permit: {
    arguments: '',
    result: 'trigger',
    utc: true,
    hash: '6c4627e12acd7d7dff1af6032926fa8a76f706a2f992ffc5c5ae82c12a4eb6c4',
    grantees: [],
  },
  hzense_public_signal_is_current: {
    arguments: 'p_event_id uuid',
    result: 'boolean',
    language: 'sql',
    volatility: 's',
    utc: true,
    hash: '50cea910d38b415f5f55e06ccb375072486976190cb11fa6cde2200a5ba6068b',
    grantees: ['hzense_runtime', 'hzense_publisher'],
  },
};
export const currentPublicationTriggers = [
  {
    table_name: 'signal_candidate_verifications',
    name: 'signal_candidate_verifications_dependencies_trg',
    trigger_type: 5,
    routine_name: 'hzense_capture_verification_dependencies',
  },
  ...['signal_verification_dependency_seals', 'signal_publication_permits'].flatMap(
    (table_name) => [
      {
        table_name,
        name: `${table_name}_guard_trg`,
        trigger_type: 31,
        routine_name:
          table_name === 'signal_publication_permits'
            ? 'hzense_guard_publication_permit'
            : 'hzense_guard_verification_dependency_seal',
      },
      {
        table_name,
        name: `${table_name}_no_truncate_trg`,
        trigger_type: 34,
        routine_name:
          table_name === 'signal_publication_permits'
            ? 'hzense_guard_publication_permit'
            : 'hzense_guard_verification_dependency_seal',
      },
    ],
  ),
  {
    table_name: 'signal_publication_permits',
    name: 'signal_publication_permits_current_trg',
    trigger_type: 5,
    routine_name: 'hzense_guard_publication_permit',
    constraint_trigger: true,
    deferrable: true,
    initially_deferred: true,
  },
  ...[
    'sources',
    'public_source_evidence',
    'entities',
    'person_profiles',
    'organization_profiles',
    'topics',
  ].map((table_name) => ({
    table_name,
    name: `${table_name}_verification_invalidation_trg`,
    trigger_type: 56,
    routine_name: 'hzense_invalidate_verification_dependencies',
  })),
];
export const currentPublicSignalColumns = [
  ['signal_id', 'text'],
  ['version', 'integer'],
  ['publication_revision', 'integer'],
  ['title', 'text'],
  ['type', 'signal_type'],
  ['occurred_at', 'timestamp with time zone'],
  ['captured_at', 'timestamp with time zone'],
  ['summary', 'text'],
  ['analysis', 'text'],
  ['importance', 'integer'],
  ['strength', 'integer'],
  ['confidence', 'double precision'],
  ['novelty', 'double precision'],
  ['topics', 'jsonb'],
  ['people', 'jsonb'],
  ['organizations', 'jsonb'],
  ['sources', 'jsonb'],
];
// pg_get_viewdef prettifies qualifying names according to the caller search_path.
// Both reviewed variants are pinned; no semantic SQL normalizer is applied.
export const currentPublicSignalViewHashes = new Set([
  'be91f72481025c68e7a0e1fea4e34a2fba499f1497f492b6c1fd846883937567',
  'e8902045c2a9625d83a5cd8a1d1b63b54072dd874a47d7148398c2e7cf3959ec',
]);
