import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automationGenerationIds,
  summarizeAutomationGenerations,
  sourceAutomationLabel,
  sourceAutomationAllSourcesRejected,
  generationSummaryLabel,
} from '../lib/automation-generation-status.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const result = { generationIds: [id(1), id(2), id(3)] };
test('small SQL summaries preserve historical rejection labels without treating missing counts as zero', () => {
  const base = { status: 'completed', phase: 'no_new_sources' };
  assert.equal(
    sourceAutomationAllSourcesRejected({
      ...base,
      result: { discovery: { articleCount: 0, rejected: 8, duplicates: 0 } },
    }),
    true,
  );
  for (const articleCount of [undefined, null, '0', -1, 1, {}])
    assert.equal(
      sourceAutomationAllSourcesRejected({
        ...base,
        result: { discovery: { articleCount, rejected: 8, duplicates: 0 } },
      }),
      false,
    );
  for (const discovery of [
    { articleCount: 0, rejected: null, duplicates: 0 },
    { articleCount: 0, rejected: 8, duplicates: null },
    { articleCount: 0, rejected: '8', duplicates: 0 },
    { articleCount: 0, rejected: 8, duplicates: '0' },
  ])
    assert.equal(sourceAutomationAllSourcesRejected({ ...base, result: { discovery } }), false);
});
test('generation IDs are valid, deduplicated and bounded to eight sources', () => {
  assert.deepEqual(automationGenerationIds(null), []);
  assert.deepEqual(automationGenerationIds({ generationIds: ['bad', id(1), id(1)] }), [id(1)]);
  assert.equal(
    automationGenerationIds({ generationIds: Array.from({ length: 20 }, (_, n) => id(n)) }).length,
    8,
  );
});
test('parent dispatch completion does not claim model completion', () => {
  const progress = summarizeAutomationGenerations(result, [
    { id: id(1), status: 'completed', progress_phase: 'completed', candidate_count: 3 },
    { id: id(2), status: 'running', progress_phase: 'validating', candidate_count: 99 },
    { id: id(3), status: 'pending', progress_phase: 'queued', candidate_count: null },
  ]);
  assert.equal(progress.active, true);
  assert.equal(progress.knownCandidates, 3);
  assert.equal(progress.candidateCountComplete, false);
  assert.equal(
    sourceAutomationLabel({
      status: 'completed',
      phase: 'candidate_tasks_queued',
      generationProgress: progress,
    }),
    '候选生成中',
  );
  assert.equal(generationSummaryLabel(progress.tasks[1]), '校验结果');
});
test('queued generations keep refreshing without claiming the model is running', () => {
  const progress = summarizeAutomationGenerations(result, [
    { id: id(1), status: 'pending', progress_phase: 'queued', candidate_count: null },
    { id: id(2), status: 'pending', progress_phase: 'queued', candidate_count: null },
    { id: id(3), status: 'completed', progress_phase: 'completed', candidate_count: 2 },
  ]);
  assert.equal(progress.active, true);
  assert.equal(progress.running, 0);
  assert.equal(
    sourceAutomationLabel({
      status: 'completed',
      phase: 'candidate_tasks_queued',
      generationProgress: progress,
    }),
    '候选排队中',
  );
});
test('one rejected output and queued siblings expose both the queue and partial failure', () => {
  for (const [status, phase, expected] of [
    ['pending', 'queued', '候选排队中（部分失败）'],
    ['running', 'generating', '候选生成中（部分失败）'],
  ]) {
    const progress = summarizeAutomationGenerations(result, [
      { id: id(1), status: 'failed', progress_phase: 'saving', candidate_count: null },
      { id: id(2), status, progress_phase: phase, candidate_count: null },
      { id: id(3), status: 'pending', progress_phase: 'queued', candidate_count: null },
    ]);
    assert.equal(progress.active, true);
    assert.equal(
      sourceAutomationLabel({
        status: 'completed',
        phase: 'candidate_tasks_queued',
        generationProgress: progress,
      }),
      expected,
    );
  }
});
test('undispatched tasks need verification instead of appearing queued or running', () => {
  const progress = summarizeAutomationGenerations({ generationIds: [id(1)] }, [
    { id: id(1), status: 'pending', progress_phase: null, candidate_count: null },
  ]);
  assert.equal(progress.active, false);
  assert.equal(
    sourceAutomationLabel({
      status: 'completed',
      phase: 'candidate_tasks_queued',
      generationProgress: progress,
    }),
    '生成结果待核对',
  );
});
test('unreadable, unknown, malformed and hidden receipts are not zero success', () => {
  const missing = summarizeAutomationGenerations(result, null);
  assert.equal(missing.unavailable, 3);
  assert.equal(missing.active, false);
  assert.equal(missing.readFailed, true);
  assert.equal(summarizeAutomationGenerations(result, []).readFailed, false);
  assert.equal(missing.candidateCountComplete, false);
  assert.equal(
    sourceAutomationLabel({
      status: 'completed',
      phase: 'candidate_tasks_queued',
      generationProgress: missing,
    }),
    '生成结果待核对',
  );
  const unknown = summarizeAutomationGenerations(result, [
    { id: id(1), status: 'unknown', progress_phase: 'generating', candidate_count: null },
    { id: id(2), status: 'completed', progress_phase: null, candidate_count: null },
    { id: id(3), status: 'pending', progress_phase: null, candidate_count: null },
  ]);
  assert.equal(unknown.unknown, 1);
  assert.equal(unknown.active, false);
  assert.equal(unknown.candidateCountComplete, false);
});
test('source stages use the actual saved workflow phases', () => {
  for (const [phase, expected] of Object.entries({
    preparing: '准备采集',
    discovering: '联网发现',
    sources_discovered: '发现完成',
    importing_sources: '导入原文',
    creating_candidates: '登记候选任务',
    dispatching_candidates: '派发候选任务',
  })) {
    assert.equal(sourceAutomationLabel({ status: 'running', phase }), expected);
  }
});

test('new and historical all-rejected discovery runs display failure without mutating receipts', () => {
  const historical = {
    status: 'completed',
    phase: 'no_new_sources',
    result: { discovery: { articles: [], rejected: 8, duplicates: 0 } },
  };
  const original = globalThis.structuredClone(historical);
  for (const run of [
    historical,
    { status: 'failed', phase: 'discovery_failed', error_code: 'discovery_all_sources_rejected' },
  ]) {
    assert.equal(sourceAutomationAllSourcesRejected(run), true);
    assert.equal(sourceAutomationLabel(run), '采集失败，来源全部未通过校验');
  }
  assert.deepEqual(historical, original);
});

test('empty, duplicate, partial and malformed discovery receipts are not mislabeled all rejected', () => {
  for (const discovery of [
    { articles: [], rejected: 0, duplicates: 0 },
    { articles: [], rejected: 0, duplicates: 8 },
    { articles: [], rejected: 4, duplicates: 4 },
    { articles: [{ url: 'https://example.com' }], rejected: 7, duplicates: 0 },
    { articles: [], rejected: '8', duplicates: 0 },
    { articles: [], rejected: 8, duplicates: '0' },
    { articles: [], rejected: 8.5, duplicates: 0 },
    { articles: [], rejected: 9999, duplicates: 0 },
    { articles: {}, rejected: 8, duplicates: 0 },
    null,
  ]) {
    const run = { status: 'completed', phase: 'no_new_sources', result: { discovery } };
    assert.equal(sourceAutomationAllSourcesRejected(run), false);
    assert.equal(sourceAutomationLabel(run), '采集完成，无新来源');
  }
  for (const status of ['running', 'unknown', 'cancelled']) {
    assert.equal(
      sourceAutomationAllSourcesRejected({
        status,
        phase: 'no_new_sources',
        error_code: 'discovery_all_sources_rejected',
        result: { discovery: { articles: [], rejected: 8, duplicates: 0 } },
      }),
      false,
    );
  }
});

test('only actual completed candidates produce totals, including a valid empty result', () => {
  const single = { generationIds: [id(1)] };
  for (const candidate_count of [0, 5]) {
    const p = summarizeAutomationGenerations(single, [
      { id: id(1), status: 'completed', progress_phase: null, candidate_count },
    ]);
    assert.equal(p.candidateCountComplete, true);
    assert.equal(p.knownCandidates, candidate_count);
    assert.equal(
      sourceAutomationLabel({
        status: 'completed',
        phase: 'candidate_tasks_queued',
        generationProgress: p,
      }),
      candidate_count ? '私有候选已生成' : '生成完成（无合格候选）',
    );
  }
  const p = summarizeAutomationGenerations(result, [
    { id: id(1), status: 'completed', progress_phase: null, candidate_count: 2 },
    { id: id(2), status: 'failed', progress_phase: null, candidate_count: null },
    { id: id(3), status: 'cancelled', progress_phase: null, candidate_count: null },
  ]);
  assert.equal(
    sourceAutomationLabel({
      status: 'completed',
      phase: 'candidate_tasks_queued',
      generationProgress: p,
    }),
    '部分生成完成',
  );
  assert.equal(p.knownCandidates, 2);
});
