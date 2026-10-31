import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const key = '__insightLeafTopics';
async function compile() {
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../lib/server/insight-topics.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'isolated-leaf-reader',
        setup(builder) {
          builder.onResolve(
            { filter: /^(server-only|\.\/runtime-reader|\.\/task-public-signals)$/ },
            ({ path }) => ({
              path,
              namespace: 'fixture',
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'server-only'
                ? ''
                : path === './runtime-reader'
                  ? `export async function readRuntimeLeafTopics(){const f=globalThis.${key};f.calls++;if(f.error)throw f.error;return f.rows;}`
                  : `export async function readTaskPublicSignals(){const f=globalThis.${key};f.signalReads++;if(f.signalError)throw f.signalError;return f.signals;}`,
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

test('shared insight topic validation accepts only 1–5 unique database leaves, including beyond 50', async (t) => {
  t.after(() => {
    delete globalThis[key];
  });
  const f = (globalThis[key] = {
    calls: 0,
    rows: Array.from({ length: 75 }, (_, index) => ({ id: `topic-leaf-${index}` })),
  });
  const { assertInsightLeafTopics, readInsightLeafTopics } = await compile();
  assert.deepEqual(await readInsightLeafTopics(), f.rows);
  await assertInsightLeafTopics(['topic-leaf-74']);
  await assertInsightLeafTopics(f.rows.slice(0, 5).map((row) => row.id));
  for (const ids of [
    [],
    null,
    undefined,
    ['topic-parent'],
    ['topic-unknown'],
    ['topic-leaf-0', 'topic-parent'],
    ['topic-leaf-0', 'topic-leaf-0'],
    f.rows.slice(0, 6).map((row) => row.id),
    [42],
  ]) {
    await assert.rejects(assertInsightLeafTopics(ids), {
      name: 'AutomationError',
      code: 'insight_topic_not_leaf',
    });
  }
  const calls = f.calls;
  await assert.rejects(assertInsightLeafTopics([]), { code: 'insight_topic_not_leaf' });
  assert.equal(f.calls, calls, 'Malformed selections do not query the database');
  f.error = new Error('private database connection detail');
  for (const read of [
    () => readInsightLeafTopics(),
    () => assertInsightLeafTopics(['topic-leaf-0']),
  ])
    await assert.rejects(read(), (error) => {
      assert.equal(error.code, 'database_unavailable');
      assert.equal(error.message, 'database_unavailable');
      assert.equal(error.cause, undefined);
      return true;
    });
});

test('tracked insight eligibility uses non-root database leaves and all-time unique direct public Signals', async (t) => {
  t.after(() => delete globalThis[key]);
  const f = (globalThis[key] = {
    calls: 0,
    signalReads: 0,
    rows: [
      { id: 'topic-ten', parentId: 'topic-parent' },
      { id: 'topic-nine', parentId: 'topic-parent' },
      { id: 'topic-root', parentId: null },
      { id: 'topic-other', parentId: 'topic-other-parent' },
    ],
    signals: [],
  });
  const signals = (topic, count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${topic}-${i}`,
      topics: [topic, topic, 'topic-parent'],
      occurred_at: '2001-01-01',
    }));
  f.signals = [
    ...signals('topic-ten', 10),
    ...signals('topic-nine', 9),
    ...signals('topic-root', 20),
  ];
  f.signals.push(...signals('topic-nine', 9), ...signals('topic-ten', 10));
  const { readTrackedInsightTopics, assertTrackedInsightTopics, readInsightLeafTopics } =
    await compile();
  assert.deepEqual(
    (await readTrackedInsightTopics()).map((topic) => topic.id),
    ['topic-ten'],
  );
  assert.equal(
    (await readInsightLeafTopics()).length,
    4,
    'Historical leaf classification is not narrowed to tracked eligibility',
  );
  await assertTrackedInsightTopics(['topic-ten']);
  for (const ids of [['topic-nine'], ['topic-root'], ['topic-other'], ['topic-ten', 'topic-nine']])
    await assert.rejects(assertTrackedInsightTopics(ids), { code: 'insight_topic_not_tracked' });
  await assert.rejects(assertTrackedInsightTopics(['topic-parent']), {
    code: 'insight_topic_not_leaf',
  });
  const before = f.signalReads;
  const snapshot = [...f.signals, ...signals('topic-other', 10)];
  await assertTrackedInsightTopics(['topic-ten', 'topic-other'], snapshot);
  assert.deepEqual(
    (await readTrackedInsightTopics(snapshot)).map((topic) => topic.id),
    ['topic-ten', 'topic-other'],
  );
  assert.equal(
    f.signalReads,
    before,
    'Supplied public evidence snapshot is reused without another read',
  );
  f.signals = f.signals.filter((signal) => signal.id !== 'topic-ten-9');
  await assert.rejects(assertTrackedInsightTopics(['topic-ten']), {
    code: 'insight_topic_not_tracked',
  });
  const reads = f.calls + f.signalReads;
  for (const ids of [
    [],
    null,
    undefined,
    ['topic-ten', 'topic-ten'],
    [42],
    Array(6).fill('topic-ten'),
  ])
    await assert.rejects(assertTrackedInsightTopics(ids), { code: 'insight_topic_not_leaf' });
  assert.equal(f.calls + f.signalReads, reads, 'Malformed input never reads storage');
  f.signalError = Error('private reader credentials');
  for (const read of [
    () => readTrackedInsightTopics(),
    () => assertTrackedInsightTopics(['topic-ten']),
  ])
    await assert.rejects(
      read(),
      (error) =>
        error.code === 'database_unavailable' &&
        error.message === 'database_unavailable' &&
        error.cause === undefined,
    );
  await assertTrackedInsightTopics(['topic-ten'], snapshot);
  f.error = Error('private catalog connection');
  await assert.rejects(readTrackedInsightTopics(snapshot), { code: 'database_unavailable' });
});
