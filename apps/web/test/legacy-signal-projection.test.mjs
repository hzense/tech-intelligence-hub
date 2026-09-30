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
      assert.ok(person.eventRole.trim(), `${raw.id}: ${person.id} needs an event role`);
    }
    for (const organization of signal.organizations) {
      assert.ok(['company', 'institution'].includes(entityById.get(organization.id)?.type));
      assert.equal(organization.eventRole, raw.entity_roles?.[organization.id] ?? '');
      assert.ok(organization.eventRole.trim(), `${raw.id}: ${organization.id} needs an event role`);
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
  assert.deepEqual(policy?.public_people, []);
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
    assert.equal(signal.title.includes('SemiAnalysis'), false, signal.id);
    assert.equal(signal.entities.includes('company-semianalysis'), false);
    assert.equal(
      signal.public_organizations?.some((entity) => entity.name === 'SemiAnalysis'),
      false,
    );
  }
});

test('AISI is both the incident-report source and the named evaluator, not just a publisher', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const entry = projectLegacySignalEntries(catalog).find(
    (signal) => signal.id === 'signal-20260804-aisi-agent-cyber-evaluation',
  );
  assert.equal(entry?.public_sources?.[0]?.name, 'UK AI Security Institute');
  assert.deepEqual(
    entry?.public_organizations?.map((organization) => [organization.id, organization.event_role]),
    [
      ['institution-aisi', '评估实施与事件披露机构'],
      ['company-anthropic', '被测 Mythos 5 模型提供方（非评估实施方）'],
      ['company-openai', '被测 GPT-5.6-Sol 模型提供方（非评估实施方）'],
    ],
  );
});

test('historical entity backfill keeps reporting publishers as sources, not event organizations', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const projected = projectLegacySignalEntries(catalog);
  const meeting = projected.find(
    (entry) => entry.id === 'signal-20260821-china-next-generation-network-policy',
  );
  const marketReport = projected.find(
    (entry) => entry.id === 'signal-20260902-china-ic-production-statistics',
  );
  const talksReport = projected.find(
    (entry) => entry.id === 'signal-20260905-us-china-ai-talks-september-report',
  );
  const companyRelease = projected.find(
    (entry) => entry.id === 'signal-20260901-claude-fable-mythos-51',
  );
  assert.deepEqual(meeting?.public_people, []);
  assert.equal(meeting?.public_organizations[0]?.event_role, '会议机构');
  assert.deepEqual(
    marketReport?.public_organizations.map((organization) => organization.id),
    [
      'institution-china-ndrc',
      'company-sichuan-shunxin-semiconductor',
      'company-jiangsu-yangheyang-microelectronics',
    ],
  );
  assert.equal(marketReport?.public_sources?.[0]?.name, '新华社 / 新华网');
  assert.deepEqual(
    marketReport?.public_people.map((person) => person.event_role),
    [
      '报道受访政策官员',
      '报道受访行业人士',
      '四川顺芯半导体总经理、报道受访企业负责人',
      '江苏扬贺扬微电子运营总监、报道受访企业负责人',
    ],
  );
  assert.deepEqual(
    talksReport?.public_organizations.map((organization) => organization.id),
    ['institution-white-house'],
  );
  assert.match(talksReport?.public_organizations[0]?.event_role, /当时否认/);
  assert.equal(talksReport?.public_sources?.[0]?.name, '联合报系');
  assert.deepEqual(
    talksReport?.public_people.map((person) => person.event_role),
    ['报道引述的 AI 政策评论人士（非会谈代表）'],
  );
  for (const entityId of ['institution-xinhua', 'company-united-daily-news']) {
    assert.equal(
      catalog.entities.some((entity) => entity.id === entityId),
      false,
    );
  }
  const sourceTypeById = new Map(catalog.sources.map((source) => [source.id, source.type]));
  for (const entry of projected) {
    if (!['news_media', 'newsletter'].includes(sourceTypeById.get(entry.source_id))) continue;
    assert.equal(
      entry.public_organizations?.some((entity) =>
        ['报道发布方', '研究发布方', '转载方', '信息来源'].includes(entity.event_role),
      ),
      false,
      entry.id,
    );
  }
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

test('historical leader-only links are hidden without removing the Signal or rewriting its body', async () => {
  const catalog = await loadSeedCatalog(seedRoot, taxonomyFile);
  const leader = { id: 'person-li-qiang', name: '李强', type: 'person', status: 'active' };
  const sourceSignal = {
    ...catalog.signals[0],
    title: '李强主持会议',
    summary: '李强主持会议，公布政策部署。',
    entities: [leader.id],
    entity_roles: { [leader.id]: '会议主持人' },
  };
  const [entry] = projectLegacySignalEntries({
    ...catalog,
    entities: [...catalog.entities, leader],
    signals: [sourceSignal],
  });
  assert.equal(entry.id, sourceSignal.id);
  assert.equal(entry.title, sourceSignal.title);
  assert.equal(entry.summary, sourceSignal.summary);
  assert.equal(entry.source_url, sourceSignal.source_url);
  assert.deepEqual(entry.topics, sourceSignal.topics);
  assert.deepEqual(entry.entities, []);
  assert.deepEqual(entry.public_people, []);
  assert.deepEqual(entry.entity_roles, {});
  assert.deepEqual(sourceSignal.entities, [leader.id]);
});
