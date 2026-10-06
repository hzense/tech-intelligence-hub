import { createHash } from 'node:crypto';
import { normalizeEditorialContent, editorialResourceName } from './editorial-signal-contract.mjs';
import { isExcludedPublicPerson } from '../../ingestion/src/person-resource-policy.mjs';
import {
  assertLegacySignalArchivePlan,
  canonicalLegacyArchiveJson,
} from './legacy-signal-archive.mjs';
import {
  assertUnifiedSignalContent,
  UNIFIED_SIGNAL_SCHEMA,
  unifiedSignalFail as fail,
} from './unified-signal-contract.mjs';

const hash = (value) =>
  createHash('sha256').update(canonicalLegacyArchiveJson(value)).digest('hex');
const same = (a, b) => canonicalLegacyArchiveJson(a) === canonicalLegacyArchiveJson(b);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function timestamp(value) {
  const result = value instanceof Date ? value.toISOString() : value;
  if (
    typeof result !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result.slice(0, 10)
  )
    fail('invalid_revision_time');
  // Preserve PostgreSQL microseconds; do not round historical revision times.
  return result;
}
function participant(entity, role = null) {
  return {
    id: entity.id ?? null,
    name: entity.name,
    event_role: role || null,
    kind: entity.type ?? null,
    introduction: entity.introduction ?? null,
    source_urls: entity.source_urls ?? [],
  };
}
function legacyContent(row) {
  const { signal: s, references: refs } = row;
  const entities = new Map(refs.entities.map((entry) => [entry.id, entry]));
  const linked = s.entities.map((id) => entities.get(id) ?? fail('missing_legacy_entity'));
  return assertUnifiedSignalContent(
    {
      title: s.title,
      summary: s.summary,
      type: s.type,
      occurred_at: s.occurred_at,
      captured_at: s.captured_at,
      importance: s.importance ?? null,
      confidence: s.confidence ?? null,
      novelty: s.novelty ?? null,
      people: linked
        .filter(
          (entity) =>
            entity.type === 'person' &&
            !isExcludedPublicPerson({
              ...entity,
              event_role: s.entity_roles?.[entity.id] ?? null,
            }),
        )
        .map((entity) => participant(entity, s.entity_roles?.[entity.id])),
      organizations: linked
        .filter((entity) => ['company', 'institution'].includes(entity.type))
        .map((entity) => participant(entity, s.entity_roles?.[entity.id])),
      topics: refs.topics.map(({ id, title }) => ({ id, title })),
      sources: [{ id: refs.source.id, name: refs.source.name, url: s.source_url }],
      related_entities: linked
        .filter((entity) => !['person', 'company', 'institution'].includes(entity.type))
        .map(({ id, name, type }) => ({ id, name, type })),
    },
    { historical: true },
  );
}
export function editorialUnifiedContent(raw) {
  const c = normalizeEditorialContent(raw);
  if (!same(c, raw)) fail('noncanonical_editorial_content');
  const resources = c.resources ?? [];
  const resolve = (name, person) => {
    const resource = resources.find(
      (item) =>
        (item.type === 'person') === person &&
        editorialResourceName(item.name) === editorialResourceName(name),
    );
    return participant(
      {
        id: resource?.entity_id === '__new__' ? null : (resource?.entity_id ?? null),
        name,
        type: person ? 'person' : (resource?.type ?? null),
        introduction: resource?.introduction ?? null,
        source_urls: resource?.source_urls ?? [],
      },
      resource?.event_role,
    );
  };
  return assertUnifiedSignalContent(
    {
      title: c.title,
      summary: c.summary,
      type: c.signalType ?? null,
      occurred_at: c.eventDate,
      captured_at: null,
      importance: null,
      confidence: null,
      novelty: null,
      people: c.persons
        .map((name) => resolve(name, true))
        .filter((item) => !isExcludedPublicPerson({ ...item, type: 'person' })),
      organizations: c.organizations.map((name) => resolve(name, false)),
      topics: c.topics,
      sources: c.sourceUrls.map((url) => ({ id: null, name: null, url })),
      related_entities: [],
    },
    { historical: true },
  );
}
function version({ id, revision, origin, basis, status, recordedAt, source, sourceHash, content }) {
  const row = {
    signal_id: id,
    version: revision,
    schema_version: UNIFIED_SIGNAL_SCHEMA,
    origin,
    publication_basis: basis,
    status,
    recorded_at: recordedAt,
    source_record: source,
    source_record_hash: sourceHash,
    content,
  };
  return { ...row, content_hash: hash(row) };
}

/**
 * Pure preview, never a writer or publication authorization. Caller must provide
 * the entire archive and ALL editorial revisions, not just public/latest rows.
 * Existing qualified V3 records must be inventoried separately before cutover.
 */
export function buildUnifiedSignalPlan({ archivePlan, editorialRevisions }) {
  assertLegacySignalArchivePlan(archivePlan);
  if (!Array.isArray(editorialRevisions)) fail('invalid_editorial_history');
  const versions = archivePlan.rows.map((row) =>
    version({
      id: row.signal_id,
      revision: 1,
      origin: 'legacy_seed',
      basis: 'legacy_import',
      status: row.projection === null ? 'draft' : 'published',
      recordedAt: null,
      source: { table: 'legacy_signal_archive', key: row.signal_id },
      sourceHash: row.record_hash,
      content: legacyContent(row),
    }),
  );
  const groups = new Map();
  const requestIds = new Set();
  for (const row of editorialRevisions) {
    if (
      !uuid(row.run_id) ||
      !uuid(row.request_id) ||
      typeof row.owner_id !== 'string' ||
      !row.owner_id ||
      !Number.isInteger(row.candidate_index) ||
      row.candidate_index < 0 ||
      row.candidate_index > 4 ||
      !Number.isInteger(row.revision) ||
      row.revision < 1 ||
      !['draft', 'publish', 'withdraw'].includes(row.action) ||
      !/^[a-f0-9]{64}$/.test(row.material_hash) ||
      !/^[a-f0-9]{64}$/.test(row.request_hash) ||
      requestIds.has(row.request_id)
    )
      fail('invalid_editorial_history');
    requestIds.add(row.request_id);
    // Exact algorithm used by editorial_public_signals; URLs are not regenerated.
    const id = `editorial-${createHash('md5').update(`${row.run_id}:${row.candidate_index}`).digest('hex')}`;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.revision - b.revision);
    let prior;
    for (const row of rows) {
      if (row.revision !== (prior?.revision ?? 0) + 1 || (prior && row.owner_id !== prior.owner_id))
        fail('incomplete_editorial_history');
      if (
        (row.action === 'withdraw' &&
          (prior?.action !== 'publish' || !same(row.content, prior.content))) ||
        (row.action === 'draft' && prior?.action === 'publish')
      )
        fail('invalid_editorial_transition');
      const createdAt = timestamp(row.created_at);
      versions.push(
        version({
          id,
          revision: row.revision,
          origin: 'ai_generation',
          basis: row.action === 'draft' ? null : 'manual_confirmation',
          status: { draft: 'draft', publish: 'published', withdraw: 'withdrawn' }[row.action],
          recordedAt: createdAt,
          source: { table: 'editorial_signal_revisions', key: row.request_id },
          sourceHash: hash({ ...row, created_at: createdAt }),
          content: editorialUnifiedContent(row.content),
        }),
      );
      prior = row;
    }
  }
  versions.sort((a, b) => compare(a.signal_id, b.signal_id) || a.version - b.version);
  const masters = new Map();
  const identities = new Set();
  for (const row of versions) {
    const key = `${row.signal_id}:${row.version}`;
    if (identities.has(key)) fail('signal_identity_conflict');
    identities.add(key);
    masters.set(row.signal_id, {
      id: row.signal_id,
      origin: row.origin,
      latest_version: row.version,
    });
  }
  const payload = {
    schema_version: UNIFIED_SIGNAL_SCHEMA,
    signals: [...masters.values()],
    signal_versions: versions,
    source_counts: { legacy: archivePlan.count, editorial_revisions: editorialRevisions.length },
    source_fingerprint: hash({
      archive: archivePlan.plan_hash,
      editorial: versions
        .filter((v) => v.origin === 'ai_generation')
        .map((v) => v.source_record_hash),
    }),
  };
  return JSON.parse(canonicalLegacyArchiveJson({ ...payload, plan_hash: hash(payload) }));
}

/** Rebuild from trusted source data before comparing with a reviewed preview. */
export function assertUnifiedSignalPlan(plan, sources) {
  const rebuilt = buildUnifiedSignalPlan(sources);
  if (!same(plan, rebuilt)) fail('unified_plan_source_mismatch');
  return rebuilt;
}

/** Offline preview only; not a replacement for a database authorization view. */
export function previewUnifiedPublicSignals(plan, sources) {
  const checked = assertUnifiedSignalPlan(plan, sources);
  const latest = new Map(checked.signal_versions.map((row) => [row.signal_id, row]));
  return [...latest.values()]
    .filter((row) => row.status === 'published')
    .map((row) => ({
      id: row.signal_id,
      version: row.version,
      origin: row.origin,
      publication_basis: row.publication_basis,
      content: row.content,
    }));
}
