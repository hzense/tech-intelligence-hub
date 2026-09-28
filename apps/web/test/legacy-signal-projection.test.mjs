import assert from 'node:assert/strict';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { loadSeedCatalog } from '@hzense/content';
import { projectLegacySignalEntries } from '../lib/legacy-signal-projection.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';

const seedRoot = fileURLToPath(new URL('../../../data/seed/', import.meta.url));
const taxonomyFile = fileURLToPath(
  new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url),
);

test('every existing historical Signal projects without losing identities, references or retained scores', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const legacy = catalog.signals.filter(
    (signal) =>
      (signal.status === 'accepted' || signal.status === 'reviewed') &&
      !signal.id.startsWith('editorial-'),
  );
  const projected = projectLegacySignalEntries(catalog);
  const byId = new Map(projected.map((entry) => [entry.id, entry]));
  const entityById = new Map(catalog.entities.map((entity) => [entity.id, entity]));
  const topicById = new Map(catalog.topics.map((topic) => [topic.id, topic]));
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  assert.equal(projected.length, legacy.length);
  assert.equal(byId.size, legacy.length);
  for (const raw of legacy) {
    const entry = byId.get(raw.id);
    assert.ok(entry, raw.id);
    const signal = toUnifiedSignal(entry);
    assert.equal(signal.publication.basis, 'legacy_seed');
    assert.equal(signal.publication.state, 'archive');
    assert.equal(signal.publication.version, null);
    assert.equal(signal.occurredAt, raw.occurred_at);
    assert.equal(signal.capturedAt, raw.captured_at);
    assert.deepEqual(signal.assessment, {
      importance: raw.importance,
      confidence: raw.confidence,
      novelty: raw.novelty,
    });
    assert.deepEqual(
      signal.topics.map((topic) => topic.id),
      raw.topics,
    );
    assert.deepEqual(
      signal.topics.map((topic) => topic.title),
      raw.topics.map((id) => topicById.get(id)?.title),
    );
    assert.deepEqual(
      signal.sources.map((source) => source.url),
      [raw.source_url],
    );
    assert.deepEqual(
      signal.sources.map((source) => source.name),
      [sourceById.get(raw.source_id)?.name],
    );
    assert.deepEqual(
      [...signal.people, ...signal.organizations, ...signal.relatedEntities]
        .map((entity) => entity.id)
        .sort(),
      [...raw.entities].sort(),
      raw.id,
    );
    for (const person of signal.people) {
      assert.equal(entityById.get(person.id)?.type, 'person');
      assert.equal(person.eventRole, raw.entity_roles?.[person.id] ?? '');
    }
    for (const organization of signal.organizations) {
      assert.ok(['company', 'institution'].includes(entityById.get(organization.id)?.type));
      assert.equal(organization.eventRole, raw.entity_roles?.[organization.id] ?? '');
    }
    for (const related of signal.relatedEntities) {
      assert.equal(entityById.get(related.id)?.type, related.type);
      assert.ok(!['person', 'company', 'institution'].includes(related.type));
    }
  }
});

test('source-backed historical people and organizations remain archive relationships', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const projected = projectLegacySignalEntries(catalog);
  const policy = projected.find(
    (entry) => entry.id === 'signal-20260723-us-datacenter-ratepayer-pledge',
  );
  const acquisition = projected.find(
    (entry) => entry.id === 'signal-20260806-amd-taalas-acquisition',
  );
  assert.equal(policy?.public_people.length, 1);
  assert.equal(policy?.public_people[0]?.event_role, '承诺扩展推广人');
  assert.deepEqual(
    policy?.public_organizations.map((entity) => entity.name),
    ['The White House'],
  );
  assert.deepEqual(
    acquisition?.public_organizations.map((entity) => entity.name),
    ['AMD', 'Taalas'],
  );
  assert.equal(acquisition?.public_people.length, 2);
  assert.equal(toUnifiedSignal(acquisition).publication.state, 'archive');
});

test('SemiAnalysis is attributed as an information source, not a related company', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const signals = projectLegacySignalEntries(catalog).filter(
    (entry) => entry.source_id === 'source-semianalysis',
  );
  assert.ok(signals.length > 0);
  assert.equal(
    catalog.entities.some((entity) => entity.id === 'company-semianalysis'),
    false,
  );
  for (const signal of signals) {
    assert.equal(signal.public_sources?.[0]?.name, 'SemiAnalysis');
    assert.equal(signal.entities.includes('company-semianalysis'), false);
    assert.equal(
      signal.public_organizations?.some((entity) => entity.name === 'SemiAnalysis'),
      false,
    );
  }
});

test('historical entity backfill distinguishes a decision maker from a reporting publisher', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const projected = projectLegacySignalEntries(catalog);
  const meeting = projected.find(
    (entry) => entry.id === 'signal-20260821-china-next-generation-network-policy',
  );
  const marketReport = projected.find(
    (entry) => entry.id === 'signal-20260902-china-ic-production-statistics',
  );
  const companyRelease = projected.find(
    (entry) => entry.id === 'signal-20260901-claude-fable-mythos-51',
  );
  assert.equal(meeting?.public_people[0]?.event_role, '会议主持人');
  assert.equal(meeting?.public_organizations[0]?.event_role, '会议机构');
  assert.equal(marketReport?.public_organizations[0]?.event_role, '报道发布方');
  assert.deepEqual(
    marketReport?.public_people.map((person) => person.event_role),
    ['报道受访政策官员', '报道受访行业人士'],
  );
  assert.deepEqual(
    companyRelease?.public_people.map((person) => person.event_role),
    ['Jane Street 早期体验发言人', 'Cognition 早期体验发言人'],
  );
});

test('historical projection rejects broken references instead of displaying opaque IDs', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const first = catalog.signals[0];
  assert.ok(first);
  assert.throws(
    () =>
      projectLegacySignalEntries({ ...catalog, signals: [{ ...first, entities: ['missing'] }] }),
    /Unknown historical Signal entity/,
  );
  assert.throws(
    () => projectLegacySignalEntries({ ...catalog, signals: [{ ...first, topics: ['missing'] }] }),
    /Unknown historical Signal topic/,
  );
});
