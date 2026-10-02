import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automationGenerationIds,
  summarizeAutomationGenerations,
  sourceAutomationLabel,
  generationSummaryLabel,
} from '../lib/automation-generation-status.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const result = { generationIds: [id(1), id(2), id(3)] };
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
