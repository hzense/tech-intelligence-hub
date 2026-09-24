import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  sealedSignalTriggers,
  allStampedSignalTables,
} from '../src/signal-immutability-catalog.mjs';

// Test data only. Production expectations are separately pinned source hashes.
const migration = [
  '0007_signal_version_immutability.sql',
  '0008_signal_publication_outbox.sql',
  '0009_signal_publication_controls.sql',
  '0010_qualified_signal_publication.sql',
  '0011_signal_candidate_verification.sql',
  '0012_current_signal_publication.sql',
  '0021_candidate_review_attestations.sql',
  '0023_candidate_materials.sql',
]
  .map((name) => readFileSync(new URL(`../../../db/migrations/${name}`, import.meta.url), 'utf8'))
  .join('\n');
const bodies = [
  ...migration.matchAll(
    /CREATE FUNCTION public\.(\w+)\(([^)]*)\) RETURNS (\w+)\s+([\s\S]*?)AS \$(\w+)\$([\s\S]*?)\$\5\$;/g,
  ),
];

// Captured from a disposable PostgreSQL 18.4 database, pg_get_viewdef(..., true)
// with search_path=public. This is test data, not a runtime-derived expected pin.
export function currentPublicSignalViewFixture(owner = 'hzense_migrator') {
  return {
    name: 'current_public_signals',
    owner,
    options: ['security_barrier=true'],
    columns: [
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
    ],
    definition: ` SELECT head.signal_id,
    head.content_version AS version,
    head.publication_revision,
    snapshot.title,
    snapshot.type,
    snapshot.occurred_at,
    snapshot.captured_at,
    snapshot.summary,
    snapshot.analysis,
    snapshot.importance,
    snapshot.strength,
    snapshot.confidence,
    snapshot.novelty,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', topic.id, 'title', topic.title) ORDER BY (topic.id COLLATE "C")) AS jsonb_agg
           FROM signal_version_topics link
             JOIN topics topic ON topic.id = link.topic_id
          WHERE link.signal_id = head.signal_id AND link.version = head.content_version), '[]'::jsonb) AS topics,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', entity.id, 'name', entity.name, 'event_role', link.event_role) ORDER BY (entity.id COLLATE "C"), (link.evidence_id COLLATE "C")) AS jsonb_agg
           FROM signal_version_people link
             JOIN entities entity ON entity.id = link.person_id
          WHERE link.signal_id = head.signal_id AND link.version = head.content_version), '[]'::jsonb) AS people,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', entity.id, 'name', entity.name, 'event_role', link.event_role) ORDER BY (entity.id COLLATE "C"), (link.evidence_id COLLATE "C")) AS jsonb_agg
           FROM signal_version_organizations link
             JOIN entities entity ON entity.id = link.organization_id
          WHERE link.signal_id = head.signal_id AND link.version = head.content_version), '[]'::jsonb) AS organizations,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', evidence.id, 'url', evidence.source_url, 'name', source.name) ORDER BY (evidence.id COLLATE "C")) AS jsonb_agg
           FROM signal_version_evidence link
             JOIN public_source_evidence evidence ON evidence.id = link.evidence_id
             JOIN sources source ON source.id = evidence.source_id
          WHERE link.signal_id = head.signal_id AND link.version = head.content_version AND link.relation = 'supports'::text), '[]'::jsonb) AS sources
   FROM signal_publication_state head
     JOIN signal_versions snapshot ON snapshot.signal_id = head.signal_id AND snapshot.version = head.content_version
  WHERE head.status = 'published'::text AND hzense_public_signal_is_current(head.event_id);`,
  };
}

export function signalImmutabilityFixture(owner = 'hzense_migrator') {
  return {
    views: [currentPublicSignalViewFixture(owner)],
    triggers: sealedSignalTriggers.map((contract) => ({
      ...contract,
      table_owner: owner,
      enabled: 'A',
      routine_schema: 'public',
      routine_arguments: '',
      constraint_trigger: contract.constraint_trigger ?? false,
      parent_trigger: false,
      deferrable: contract.deferrable ?? false,
      initially_deferred: contract.initially_deferred ?? false,
      argument_count: 0,
      arguments_hex: '',
      column_numbers: '',
      when_expression: null,
      old_transition_table: null,
      new_transition_table: null,
    })),
    routines: bodies.map(([, name, argumentsList, result, attributes, , source]) => ({
      name,
      source,
      owner,
      identity_arguments: argumentsList,
      language: /LANGUAGE (\w+)/.exec(attributes)[1],
      kind: 'f',
      result_type: result,
      security_definer:
        /SECURITY DEFINER/.test(attributes) ||
        migration.includes(`ALTER FUNCTION public.${name}() SECURITY DEFINER;`),
      leakproof: false,
      strict: false,
      returns_set: false,
      volatility: /\bSTABLE\b/.test(attributes) ? 's' : 'v',
      parallel: 'u',
      support_function: false,
      binary: null,
      sql_body: null,
      configuration: [
        'search_path=pg_catalog, pg_temp',
        ...(/SET timezone = 'UTC'/.test(attributes) ? ['TimeZone=UTC'] : []),
      ],
      unsafe_acl_count: 0,
      owner_execute_count: 1,
      acl_entries: [{ grantee: owner, grantor: owner, privilege: 'EXECUTE', grantable: false }],
    })),
    stamps: allStampedSignalTables.map((table_name) => ({
      table_name,
      data_type: 'xid8',
      not_null: true,
      generated_kind: '',
      default_expression: 'pg_current_xact_id()',
    })),
  };
}

export function signalImmutabilityQueryFixture(sql, fixture = signalImmutabilityFixture()) {
  if (sql.includes('hzense:current-publication:views')) {
    return { rows: fixture.views, rowCount: fixture.views.length };
  }
  for (const key of ['triggers', 'routines', 'stamps']) {
    if (sql.includes(`hzense:signal-immutability:${key}`)) {
      return { rows: fixture[key], rowCount: fixture[key].length };
    }
  }
  return null;
}
