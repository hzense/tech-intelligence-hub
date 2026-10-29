import assert from 'node:assert/strict';
import test from 'node:test';
import { getLeafTopicIds, getTopicEntries, getTopicEntryById } from '../lib/content-runtime.ts';
import { getRadarSnapshots } from '../lib/seed-runtime.ts';
import { projectTopicAssessments } from '../lib/topic-assessments.ts';

const sampleSnapshot = {
  id: 'radar-synthetic-ai-security',
  topic: 'topic-ai-security',
  date: '2026-09-01',
  domain: 'security',
  attention: 55,
  trend: 'growth',
  maturity: 'emerging',
  strategic_value: 'medium',
  confidence: 0.5,
  evidence_signals: ['signal-synthetic'],
  reasoning: 'Synthetic test fixture',
};

function topic(id, status = 'active') {
  return {
    filePath: `topics/${id}.md`,
    relativePath: `topics/${id}.md`,
    slug: `topics/${id}`,
    frontMatter: { id, title: id, type: 'topic', status },
    body: 'Original editorial content',
    summary: 'Original summary',
    sections: [],
  };
}

test('Topic list and detail share the complete latest assessment without inventing scores', async () => {
  const topics = await getTopicEntries();
  const projected = projectTopicAssessments(topics, await getRadarSnapshots());
  assert.ok(topics.length > 0);
  for (const entry of topics) {
    const id = entry.frontMatter.id;
    const expected = projected.find((item) => item.frontMatter.id === id)?.assessment;
    assert.deepEqual(entry.assessment, expected);
    assert.deepEqual((await getTopicEntryById(id))?.assessment, expected);
  }
});

test('selects all metrics from the newest snapshot, not the highest score or input order', () => {
  const source = sampleSnapshot;
  const older = { ...source, date: '2026-08-01', attention: 99, trend: 'rapid_growth' };
  const newer = {
    ...source,
    id: 'radar-newer',
    date: '2026-08-02',
    attention: 0,
    trend: 'decline',
    maturity: 'mature',
    strategic_value: 'low',
  };
  const document = topic(source.topic);
  for (const snapshots of [
    [older, newer],
    [newer, older],
  ]) {
    const entries = projectTopicAssessments([document], snapshots);
    assert.deepEqual(entries[0].assessment, newer);
    assert.equal(entries[0].assessment.attention, 0);
  }
});

test('never falls back to legacy Markdown or a previously projected assessment', () => {
  const source = sampleSnapshot;
  const legacy = topic(source.topic);
  Object.assign(legacy.frontMatter, {
    attention: 85,
    trend: 'rapid_growth',
    maturity: 'emerging',
    strategic_value: 'high',
  });
  const [result] = projectTopicAssessments([{ ...legacy, assessment: source }], []);
  assert.equal(result.assessment, undefined);
  assert.equal(result.assessment?.attention ?? '—', '—');
});

test('keeps unassessed Topics last, excludes archived pages and does not mutate cached documents', () => {
  const source = sampleSnapshot;
  const unknown = topic('topic-unknown');
  const scored = topic(source.topic);
  const archived = topic('topic-archived', 'archived');
  const documents = [unknown, archived, scored];
  const before = globalThis.structuredClone(documents);
  documents.forEach((entry) => {
    Object.freeze(entry.frontMatter);
    Object.freeze(entry);
  });
  Object.freeze(documents);
  const snapshots = Object.freeze([Object.freeze({ ...source, attention: 0 })]);
  const entries = projectTopicAssessments(documents, snapshots);
  assert.deepEqual(
    entries.map((entry) => entry.frontMatter.id),
    [source.topic, 'topic-unknown'],
  );
  assert.equal(entries[1].assessment, undefined);
  assert.notEqual(entries[0], scored);
  const { assessment, ...projectedContent } = entries[0];
  assert.equal(assessment.attention, 0);
  assert.deepEqual(projectedContent, scored);
  assert.deepEqual(documents, before);
});

test('real Topics without Radar snapshots remain available without invented scores', async () => {
  const snapshots = await getRadarSnapshots();
  for (const entry of await getTopicEntries()) {
    if (!snapshots.some((snapshot) => snapshot.topic === entry.frontMatter.id)) {
      assert.equal(entry.assessment, undefined);
      assert.equal((await getTopicEntryById(entry.frontMatter.id)).assessment, undefined);
    }
  }
});

test('insight labels use the full taxonomy leaves, not a fixed depth or the enabled content subset', async () => {
  const leaves = await getLeafTopicIds();
  for (const id of [
    'topic-artificial-intelligence',
    'topic-foundation-models',
    'topic-ai-agents',
    'topic-memory',
  ]) {
    assert.equal(
      leaves.has(id),
      false,
      `${id} is still a parent even if some children have no page`,
    );
  }
  for (const id of [
    'topic-language-models',
    'topic-agent-memory',
    'topic-humanoid-robotics',
    'topic-quantum',
  ]) {
    assert.equal(leaves.has(id), true, `${id} has no child regardless of depth`);
  }
  assert.equal(leaves.has('topic-not-in-taxonomy'), false);
});
