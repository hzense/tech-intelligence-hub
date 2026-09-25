import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';
import {
  createEditorialSignalReader,
  editorialReaderConnectionString,
  editorialSignalListQuery,
  editorialSignalByIdQuery,
  mapEditorialSignalRows,
  searchSignalEntries,
} from '../lib/editorial-signal-reader-core.ts';
import { mergeCurrentSignalSearch } from '../lib/public-signal-reader-core.ts';

const signalId = `editorial-${'a'.repeat(32)}`;
function readerEnvironment() {
  return {
    VERCEL_ENV: 'production',
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
    HZENSE_EDITORIAL_READER_DATABASE_URL:
      'postgresql://hzense_editorial_reader:synthetic@ep-editorial-pooler.us-east-1.aws.neon.tech:5432/editorial?sslmode=verify-full&channel_binding=prefer',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-editorial-pooler.us-east-1.aws.neon.tech',
    HZENSE_RUNTIME_EXPECTED_NAME: 'editorial',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  };
}
function row(overrides = {}) {
  return {
    signal_id: signalId,
    revision: 1,
    published_at: new Date('2026-09-25T12:00:00Z'),
    content: {
      title: 'An editorial event',
      summary: 'Administrator reviewed this event',
      eventDate: '2026-09-24',
      persons: ['Public Person'],
      organizations: ['Public Organization'],
      topics: [{ id: 'topic-ai', title: '人工智能' }],
      sourceUrls: [],
      privateExcerpt: 'DO NOT LEAK',
      runId: 'DO NOT LEAK',
      owner: 'DO NOT LEAK',
    },
    owner_id: 'DO NOT LEAK',
    ...overrides,
  };
}
test('manual public DTO has no fabricated scores or URLs, and allowlists its fields', () => {
  const [entry] = mapEditorialSignalRows([row()]);
  assert.equal(entry.publication_basis, 'manual_confirmation');
  for (const metric of ['confidence', 'importance', 'strength', 'novelty'])
    assert.equal(metric in entry, false);
  assert.deepEqual(entry.public_sources, []);
  assert.equal(entry.source_url, '');
  assert.equal(entry.public_people[0].name, 'Public Person');
  assert.equal(entry.public_organizations[0].name, 'Public Organization');
  assert.deepEqual(entry.public_topics, [{ id: 'topic-ai', title: '人工智能' }]);
  assert.equal(entry.occurred_at, '2026-09-24T00:00:00.000Z');
  assert.equal(JSON.stringify(entry).includes('DO NOT LEAK'), false);
});
test('reader validates required manual fields, safe source links, opaque ids and revision', () => {
  for (const content of [
    { persons: [] },
    { organizations: [] },
    { topics: [] },
    { eventDate: '2026-02-30' },
    { sourceUrls: ['javascript:alert(1)'] },
    { sourceUrls: ['https://user:secret@example.com'] },
  ])
    assert.throws(
      () => mapEditorialSignalRows([row({ content: { ...row().content, ...content } })]),
      { name: 'PublicSignalReaderError' },
    );
  for (const values of [
    { signal_id: 'editorial-00000000-0000-0000-0000-000000000000-0' },
    { revision: 0 },
    { published_at: null },
  ]) {
    assert.throws(() => mapEditorialSignalRows([row(values)]), { name: 'PublicSignalReaderError' });
  }
});
test('reader requires its dedicated least privilege role and full TLS verification', () => {
  const environment = readerEnvironment();
  const valid = environment.HZENSE_EDITORIAL_READER_DATABASE_URL;
  assert.equal(editorialReaderConnectionString(environment), valid);
  for (const url of [
    undefined,
    valid.replace('hzense_editorial_reader', 'owner'),
    valid.replace('verify-full', 'disable'),
    valid.replace('verify-full', 'require'),
    `${valid}&sslmode=disable`,
    `${valid}&options=-crole=owner`,
  ]) {
    assert.throws(
      () =>
        editorialReaderConnectionString({
          ...environment,
          HZENSE_EDITORIAL_READER_DATABASE_URL: url,
        }),
      { name: 'PublicSignalReaderError', message: 'Public signals are unavailable' },
    );
  }
});
test('reader binds the production physical target and refuses TLS bypass or preview', () => {
  for (const override of [
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: undefined },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { HZENSE_RUNTIME_EXPECTED_HOST: 'ep-other-pooler.us-east-1.aws.neon.tech' },
    { HZENSE_RUNTIME_EXPECTED_NAME: 'other-database' },
    { HZENSE_RUNTIME_EXPECTED_PORT: '5433' },
    { HZENSE_RUNTIME_EXPECTED_USER: 'owner' },
    { HZENSE_RUNTIME_EXPECTED_NAME: undefined },
  ]) {
    assert.throws(() => editorialReaderConnectionString({ ...readerEnvironment(), ...override }), {
      name: 'PublicSignalReaderError',
      message: 'Public signals are unavailable',
    });
  }
});
test('every read hits the public view and observes withdrawal immediately across list, lookup and search', async () => {
  let rows = [row()];
  const calls = [];
  const reader = createEditorialSignalReader({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows };
    },
  });
  assert.equal((await reader.list()).length, 1);
  assert.equal((await reader.byId(signalId)).id, signalId);
  assert.equal(searchSignalEntries(await reader.list(), 'Public Person')[0].id, signalId);
  assert.equal(searchSignalEntries(await reader.list(), 'Public Organization')[0].id, signalId);
  assert.equal(searchSignalEntries(await reader.list(), '人工智能')[0].id, signalId);
  const stale = searchSignalEntries(await reader.list(), 'editorial');
  rows = [];
  assert.deepEqual(await reader.list(), []);
  assert.equal(await reader.byId(signalId), undefined);
  assert.deepEqual(
    mergeCurrentSignalSearch(stale, searchSignalEntries(await reader.list(), 'editorial')),
    [],
  );
  assert.equal(calls[0].sql, editorialSignalListQuery);
  assert.deepEqual(calls[0].parameters, [10001]);
  assert.equal(calls[1].sql, editorialSignalByIdQuery);
  assert.deepEqual(calls[1].parameters, [signalId]);
  assert.equal(await reader.byId("' OR true--"), undefined);
  for (const { sql } of calls) {
    assert.match(sql, /FROM public\.editorial_public_signals/);
    assert.doesNotMatch(sql, /private|search_documents|SELECT \*/);
  }
});
test('query outage fails closed and never returns a previous success', async () => {
  let healthy = true;
  const reader = createEditorialSignalReader({
    query: async () => {
      if (!healthy) throw new Error('private connection credential');
      return { rows: [row()] };
    },
  });
  await reader.list();
  healthy = false;
  await assert.rejects(reader.list(), {
    name: 'PublicSignalReaderError',
    message: 'Public signals are unavailable',
  });
  await assert.rejects(reader.byId(signalId), { name: 'PublicSignalReaderError' });
});
test('server entrypoints gate readers, bind requests, and remove old indexed signals in every mode', async () => {
  const source = (name) => readFile(new URL(name, import.meta.url), 'utf8');
  const reader = await source('../lib/server/editorial-signals.ts');
  assert.match(reader, /HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1'/);
  assert.match(reader, /await connection\(\)/);
  assert.match(reader, /max: 2/);
  assert.doesNotMatch(reader, /unstable_cache|use cache|private\./);
  const search = await source('../lib/server/search.ts');
  assert.equal(
    (search.match(/return mergeCurrentSignalSearch\(legacy, current\)/g) ?? []).length,
    2,
  );
  assert.match(
    await source('../lib/search-runtime.ts'),
    /publication_basis !== 'manual_confirmation'/,
  );
  const detail = await source('../app/signals/[id]/page.tsx');
  assert.match(detail, /export const dynamic = 'force-dynamic'/);
  assert.doesNotMatch(detail, /generateStaticParams/);
  assert.match(detail, /entry\.publication_basis === 'manual_confirmation'/);
  assert.match(detail, /未提供公开来源链接/);
  assert.match(detail, /href=\{`\/topics\/\$\{topic\}`\}/);
});

test('actual server search orchestration cannot resurrect an editorial hit from the old index in any mode', async () => {
  const result = searchSignalEntries(mapEditorialSignalRows([row()]), 'editorial')[0];
  const state = { current: [result], indexed: [result] };
  globalThis.__editorialSearchTest = state;
  const previousSignalMode = process.env.HZENSE_SIGNAL_READ_MODE;
  const previousSearchMode = process.env.HZENSE_SEARCH_MODE;
  try {
    const bundled = await build({
      entryPoints: [new URL('../lib/server/search.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-public-search-providers',
          setup(plugin) {
            const modules = {
              'server-only': 'export {};',
              '../search-runtime':
                'export async function searchPublishedContent(q,t,include=true) { return include ? globalThis.__editorialSearchTest.current : []; }',
              './runtime-reader':
                'export async function searchRuntimeDocuments() { return globalThis.__editorialSearchTest.indexed; }',
              './public-signals':
                'export async function searchPublicSignals() { return globalThis.__editorialSearchTest.current; }',
            };
            plugin.onResolve(
              {
                filter:
                  /^(server-only|\.\.\/search-runtime|\.\/runtime-reader|\.\/public-signals)$/,
              },
              (args) => ({ path: args.path, namespace: 'test-provider' }),
            );
            plugin.onLoad({ filter: /.*/, namespace: 'test-provider' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const { searchPublishedContent } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    for (const signalMode of ['legacy', 'database']) {
      for (const searchMode of ['in-process', 'database', 'shadow']) {
        process.env.HZENSE_SIGNAL_READ_MODE = signalMode;
        process.env.HZENSE_SEARCH_MODE = searchMode;
        for (const type of [undefined, 'signal']) {
          state.current = [result];
          assert.equal((await searchPublishedContent('editorial', type))[0].id, signalId);
          state.current = [];
          assert.deepEqual(await searchPublishedContent('editorial', type), []);
        }
        assert.deepEqual(await searchPublishedContent('editorial', 'resource'), []);
      }
    }
  } finally {
    if (previousSignalMode === undefined) delete process.env.HZENSE_SIGNAL_READ_MODE;
    else process.env.HZENSE_SIGNAL_READ_MODE = previousSignalMode;
    if (previousSearchMode === undefined) delete process.env.HZENSE_SEARCH_MODE;
    else process.env.HZENSE_SEARCH_MODE = previousSearchMode;
    delete globalThis.__editorialSearchTest;
  }
});

test('actual server reader is disabled by default, uses only its reader pool, and re-reads withdrawals', async () => {
  const state = {
    rows: [row()],
    queries: 0,
    connections: 0,
    poolOptions: [],
    checks: 0,
    releases: [],
    aclValid: true,
    queryFails: false,
  };
  globalThis.__editorialReaderTest = state;
  const previousFlag = process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
  const environment = readerEnvironment();
  const previousEnvironment = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, environment);
    const bundled = await build({
      entryPoints: [new URL('../lib/server/editorial-signals.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-editorial-pool',
          setup(plugin) {
            const modules = {
              'server-only': 'export {};',
              'next/server':
                'export async function connection() { globalThis.__editorialReaderTest.connections++; }',
              pg: `export default { Pool: class {
                constructor(options) { globalThis.__editorialReaderTest.poolOptions.push(options); }
                on() {}
                async connect() {
                  const state = globalThis.__editorialReaderTest;
                  return {
                    checked: false,
                    async query() {
                      if (!this.checked) throw new Error('query before ACL check');
                      state.queries++;
                      if (state.queryFails) throw new Error('private query error');
                      return { rows: state.rows };
                    },
                    release(discard) { state.releases.push(discard); },
                  };
                }
              } };`,
              '../../../../packages/database/src/editorial-signal-role.mjs': `
                export async function assertEditorialRole(client, role) {
                  const state = globalThis.__editorialReaderTest;
                  state.checks++;
                  if (role !== 'reader' || !state.aclValid) throw new Error('private ACL error');
                  client.checked = true;
                }
              `,
            };
            plugin.onResolve(
              { filter: /^(server-only|next\/server|pg|.*editorial-signal-role\.mjs)$/ },
              (args) => ({
                path: args.path,
                namespace: 'test-provider',
              }),
            );
            plugin.onLoad({ filter: /.*/, namespace: 'test-provider' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const api = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    delete process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
    delete process.env.HZENSE_EDITORIAL_READER_DATABASE_URL;
    assert.deepEqual(await api.getEditorialSignals(), []);
    assert.equal(await api.getEditorialSignalById(signalId), undefined);
    assert.equal(state.poolOptions.length, 0);
    process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = '1';
    await assert.rejects(api.getEditorialSignals(), { name: 'PublicSignalReaderError' });
    process.env.HZENSE_EDITORIAL_READER_DATABASE_URL =
      environment.HZENSE_EDITORIAL_READER_DATABASE_URL;
    assert.equal((await api.getEditorialSignals())[0].id, signalId);
    assert.equal((await api.getEditorialSignalById(signalId)).id, signalId);
    assert.equal(state.poolOptions.length, 1);
    assert.equal(state.poolOptions[0].max, 2);
    state.rows = [];
    assert.deepEqual(await api.getEditorialSignals(), []);
    assert.equal(await api.getEditorialSignalById(signalId), undefined);
    assert.equal(state.queries, 4);
    assert.equal(state.connections, 5);
    assert.equal(state.checks, 4);
    assert.deepEqual(state.releases, [false, false, false, false]);
    state.aclValid = false;
    for (const read of [
      () => api.getEditorialSignals(),
      () => api.getEditorialSignalById(signalId),
    ]) {
      await assert.rejects(read(), {
        name: 'PublicSignalReaderError',
        message: 'Public signals are unavailable',
      });
    }
    assert.equal(state.queries, 4, 'ACL drift must stop before any public query');
    assert.equal(state.checks, 6, 'do not cache a previously successful ACL check');
    assert.deepEqual(state.releases.slice(-2), [true, true]);
    state.aclValid = true;
    state.queryFails = true;
    await assert.rejects(api.getEditorialSignals(), { name: 'PublicSignalReaderError' });
    assert.equal(state.releases.at(-1), true);
    state.queryFails = false;
    assert.deepEqual(await api.getEditorialSignals(), []);
    assert.equal(state.queries, 6);
    delete process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
    assert.deepEqual(await api.getEditorialSignals(), []);
    assert.equal(state.queries, 6);
  } finally {
    if (previousFlag === undefined) delete process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
    else process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = previousFlag;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__editorialReaderTest;
  }
});
