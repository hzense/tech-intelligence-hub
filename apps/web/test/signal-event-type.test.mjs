import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { resolveSignalEventType } from '../lib/signal-event-type.ts';
import { isSignalEventType } from '../../../packages/ingestion/src/signal-types.mjs';
import classifications from '../../../data/seed/signal-event-classifications.json' with { type: 'json' };

const signals = parse(
  await readFile(new URL('../../../data/seed/signals.yaml', import.meta.url), 'utf8'),
);

test('reviewed legacy events have one active classification without changing archived Seed content', () => {
  const snapshot = JSON.stringify(signals);
  const ids = new Set();
  for (const rule of classifications) {
    assert.equal(ids.has(rule.id), false);
    ids.add(rule.id);
    const signal = signals.find((entry) => entry.id === rule.id);
    assert.ok(signal, rule.id);
    assert.equal(signal.type, rule.previousType);
    assert.equal(isSignalEventType(signal.type), false);
    assert.equal(resolveSignalEventType(signal), rule.type);
  }
  for (const signal of signals)
    assert.ok(isSignalEventType(resolveSignalEventType(signal)), signal.id);
  assert.equal(JSON.stringify(signals), snapshot);
});

test('a reviewed classification never applies to different text, identity or an explicitly reclassified revision', () => {
  const old = signals.find(
    (signal) => signal.id === 'signal-20260721-openai-huggingface-evaluation-incident',
  );
  assert.equal(resolveSignalEventType(old), 'incident');
  assert.equal(resolveSignalEventType({ ...old, title: '新的研究报告' }), null);
  assert.equal(resolveSignalEventType({ ...old, summary: '不同事件' }), null);
  assert.equal(resolveSignalEventType({ ...old, id: 'another-signal' }), null);
  assert.equal(resolveSignalEventType({ ...old, type: 'research' }), 'research');
});

test('the core event distinguishes reports and notices from incidents, and investment plans from fundraising', () => {
  const type = (id) => resolveSignalEventType(signals.find((signal) => signal.id === id));
  assert.equal(type('signal-20260910-anthropic-threat-report'), 'research');
  assert.equal(type('signal-20260908-us-agencies-ai-distillation-advisory'), 'disclosure');
  assert.equal(type('signal-20260618-openai-medicare-portal'), 'incident');
  assert.equal(type('signal-20260716-tsmc-ai-arizona-guidance'), 'operations');
  assert.equal(type('signal-20260806-softbank-q1-fy2026-ai-investments'), 'disclosure');
});
