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
          builder.onResolve({ filter: /^(server-only|\.\/runtime-reader)$/ }, ({ path }) => ({
            path,
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'server-only'
                ? ''
                : `export async function readRuntimeLeafTopics(){const f=globalThis.${key};f.calls++;if(f.error)throw f.error;return f.rows;}`,
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
