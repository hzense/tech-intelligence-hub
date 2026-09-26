import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insightInput,
  selectInsightSignals,
  validateInsightReport,
  currentInsight,
} from '../lib/topic-insight-core.ts';

const signal = (id, day, overrides = {}) => ({
  id,
  title: `事件 ${id}`,
  summary: '公开摘要',
  occurred_at: `${day}T12:00:00.000Z`,
  topics: ['topic-ai'],
  public_version: 1,
  publication_revision: 1,
  public_people: [],
  public_organizations: [],
  public_sources: [],
  entities: [],
  ...overrides,
});
const report = (ids) => ({
  title: '专题判断',
  summary: '这是结合信号的判断，不是独立核验。',
  sections: [{ heading: '证据与变化', body: '依据所列信号，仍有不确定性。', signalIds: ids }],
  uncertainties: ['样本范围和来源覆盖尚未核验。'],
});
test('only current published signals in the 30-day event window become analysis inputs', () => {
  const result = selectInsightSignals(
    [
      signal('a', '2026-09-20'),
      signal('b', '2026-09-19'),
      signal('legacy', '2026-09-18', { public_version: undefined }),
      signal('old', '2026-07-01'),
      signal('future', '2026-10-01'),
      signal('other', '2026-09-20', { topics: ['topic-security'] }),
    ],
    ['topic-ai'],
    new Date('2026-09-26T00:00:00Z'),
  );
  assert.deepEqual(
    result.signals.map((entry) => entry.id),
    ['a', 'b'],
  );
});
test('report rejects invented citations and exposed reasoning', () => {
  assert.throws(
    () => validateInsightReport(report(['invented']), ['a', 'b']),
    /invalid_insight_citation/,
  );
  assert.throws(
    () => validateInsightReport({ ...report(['a']), summary: '<think>hidden</think>' }, ['a']),
    /invalid_insight/,
  );
});
test('an edited or withdrawn source invalidates an already published insight', () => {
  const signals = [signal('a', '2026-09-20'), signal('b', '2026-09-19')];
  const result = {
    kind: 'topic_insight',
    topicIds: ['topic-ai'],
    windowStart: '2026-08-27T00:00:00Z',
    windowEnd: '2026-09-26T00:00:00Z',
    generatedAt: '2026-09-26T01:00:00Z',
    inputs: signals.map(insightInput),
    report: report(['a', 'b']),
  };
  assert.equal(currentInsight(result, signals)?.report.title, '专题判断');
  assert.equal(
    currentInsight(result, [{ ...signals[0], summary: '修订后的摘要' }, signals[1]]),
    null,
  );
  assert.equal(currentInsight(result, [signals[0]]), null);
});
