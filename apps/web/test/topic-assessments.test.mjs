import assert from 'node:assert/strict';
import test from 'node:test';
import { getTopicEntries, getTopicEntryById } from '../lib/content-runtime.ts';
import { getRadarEntries } from '../lib/radar-runtime.ts';
import { getRadarSnapshots } from '../lib/seed-runtime.ts';
import { projectTopicAssessments } from '../lib/topic-assessments.ts';
import {
  formatTopicMaturity,
  formatTopicStrategicValue,
  formatTopicTrend,
} from '../lib/topic-presentation.ts';
import {
  formatRadarMaturity,
  formatRadarStrategicValue,
  formatRadarTrend,
} from '../lib/radar-presentation.ts';

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

test('Topic list, detail and homepage Radar reader share each complete latest assessment', async () => {
  const topics = await getTopicEntries();
  const radar = await getRadarEntries();
  assert.ok(radar.some((entry) => entry.snapshot.topic === 'topic-ai-security'));
  for (const entry of radar) {
    const id = entry.snapshot.topic;
    const listed = topics.find((item) => item.frontMatter.id === id);
    const detail = await getTopicEntryById(id);
    assert.deepEqual(listed?.assessment, entry.snapshot);
    assert.deepEqual(detail?.assessment, entry.snapshot);
    assert.deepEqual(entry.topic.assessment, entry.snapshot);
    assert.equal(formatTopicTrend(detail.assessment.trend), formatRadarTrend(entry.snapshot.trend));
    assert.equal(
      formatTopicMaturity(detail.assessment.maturity),
      formatRadarMaturity(entry.snapshot.maturity),
    );
    assert.equal(
      formatTopicStrategicValue(detail.assessment.strategic_value),
      formatRadarStrategicValue(entry.snapshot.strategic_value),
    );
  }
  assert.deepEqual(
    topics.filter((entry) => entry.assessment).map((entry) => entry.frontMatter.id),
    radar.map((entry) => entry.snapshot.topic),
  );
});

test('selects all metrics from the newest snapshot, not the highest score or input order', async () => {
  const source = (await getRadarSnapshots())[0];
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

test('never falls back to legacy Markdown or a previously projected assessment', async () => {
  const source = (await getRadarSnapshots())[0];
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
  assert.equal(formatTopicTrend(result.assessment?.trend), '待评估');
  assert.equal(formatTopicMaturity(result.assessment?.maturity), '待评估');
  assert.equal(formatTopicStrategicValue(result.assessment?.strategic_value), '待评估');
});

test('keeps unassessed Topics last, excludes archived pages and does not mutate cached documents', async () => {
  const source = (await getRadarSnapshots())[0];
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
