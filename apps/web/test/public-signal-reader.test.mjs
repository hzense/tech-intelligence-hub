import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  createPublicSignalReader,
  mapPublicSignalRows,
  mergeCurrentSignalSearch,
  publicSignalByIdQuery,
  publicSignalListQuery,
  publicSignalSearchQuery,
  readSignalReadMode,
} from '../lib/public-signal-reader-core.ts';
import { createLazyRuntimeTopicReader } from '../lib/runtime-reader-core.ts';
import { getSignalEntries } from '../lib/seed-runtime.ts';
import { getSearchDocumentProjections } from '../lib/search-runtime.ts';

function row(overrides = {}) {
  return {
    signal_id: 'signal-current',
    version: 3,
    publication_revision: '2',
    title: 'Current research',
    type: 'research',
    occurred_at: new Date('2026-09-01T00:00:00Z'),
    captured_at: new Date('2026-09-02T00:00:00Z'),
    summary: 'Public summary',
    analysis: 'Public analysis',
    importance: 3,
    strength: 4,
    confidence: '0.8',
    novelty: '0.5',
    topics: [{ id: 'topic-ai', title: 'Public AI Topic' }],
    people: [
      {
        id: 'person-one',
        name: 'Public Person',
        event_role: 'research_author',
        private_quote: 'NEVER EXPOSE',
      },
    ],
    organizations: [{ id: 'org-one', name: 'Public Organization', event_role: 'subject' }],
    sources: [
      {
        id: 'source-one',
        name: 'Public Source',
        url: 'https://example.com/event',
        metadata: { secret: 'NEVER EXPOSE' },
      },
    ],
    metadata: { private_token: 'NEVER EXPOSE' },
    ...overrides,
  };
}
function runtimeEnvironment() {
  return {
    VERCEL_ENV: 'production',
    HZENSE_RUNTIME_DATABASE_URL:
      'postgresql://hzense_runtime:synthetic-password@ep-public-pooler.us-east-1.aws.neon.tech:5432/hzense?sslmode=verify-full&channel_binding=prefer',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-public-pooler.us-east-1.aws.neon.tech',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  };
}

test('Signal read mode defaults to legacy and rejects every unknown explicit value', () => {
  assert.equal(readSignalReadMode({}), 'legacy');
  assert.equal(readSignalReadMode({ HZENSE_SIGNAL_READ_MODE: 'legacy' }), 'legacy');
  assert.equal(readSignalReadMode({ HZENSE_SIGNAL_READ_MODE: 'database' }), 'database');
  for (const value of ['', 'database ', 'DATABASE', 'shadow', 'true']) {
    assert.throws(() => readSignalReadMode({ HZENSE_SIGNAL_READ_MODE: value }), {
      name: 'PublicSignalReaderError',
    });
  }
});

test('maps only explicitly allowed public DTO fields and keeps event/capture times separate', () => {
  const [signal] = mapPublicSignalRows([row()]);
  assert.equal(signal.public_version, 3);
  assert.equal(signal.publication_revision, 2);
  assert.equal(signal.confidence, 0.8);
  assert.equal(signal.occurred_at, '2026-09-01T00:00:00.000Z');
  assert.equal(signal.captured_at, '2026-09-02T00:00:00.000Z');
  assert.deepEqual(signal.entities, ['person-one', 'org-one']);
  assert.equal(signal.analysis, 'Public analysis');
  assert.equal(JSON.stringify(signal).includes('NEVER EXPOSE'), false);
  assert.equal('metadata' in signal, false);
});

test('rejects malformed public rows, missing people, unsafe hrefs and non-finite scores', () => {
  for (const overrides of [
    { people: [] },
    { sources: [] },
    { topics: null },
    { summary: '' },
    { analysis: '' },
    { confidence: 'NaN' },
    { importance: 9 },
    { version: 0 },
    { publication_revision: '9007199254740993' },
    { occurred_at: 'bad' },
    { captured_at: 'bad' },
    { type: 'invented' },
    { signal_id: '../admin' },
    { sources: [{ id: 'source-one', name: 'Source', url: 'javascript:alert(1)' }] },
    { sources: [{ id: 'source-one', name: 'Source', url: 'https://user:pass@example.com/' }] },
  ])
    assert.throws(() => mapPublicSignalRows([row(overrides)]), { name: 'PublicSignalReaderError' });
});

test('current view list and lookup are parameterized and have no legacy/public table fallback', async () => {
  const calls = [];
  const reader = createPublicSignalReader({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [row()] };
    },
  });
  assert.equal((await reader.list())[0].id, 'signal-current');
  assert.equal((await reader.byId('signal-current')).id, 'signal-current');
  assert.equal(calls[0].sql, publicSignalListQuery);
  assert.deepEqual(calls[0].parameters, [10001]);
  assert.equal(calls[1].sql, publicSignalByIdQuery);
  assert.deepEqual(calls[1].parameters, ['signal-current']);
  for (const { sql } of calls) {
    assert.match(sql, /FROM public\.current_public_signals/);
    assert.doesNotMatch(
      sql,
      /SELECT \*|search_documents|public\.signal_versions|public_source_evidence/,
    );
  }
  assert.equal(await reader.byId("' OR true--"), undefined);
  assert.equal(calls.length, 2);
});

test('withdrawn or never published lookup remains missing, including a known old Seed id', async () => {
  const seed = (await getSignalEntries())[0];
  let count = 0;
  const reader = createPublicSignalReader({
    query: async () => {
      count += 1;
      return { rows: [] };
    },
  });
  assert.equal(await reader.byId(seed.id), undefined);
  assert.deepEqual(await reader.list(), []);
  assert.equal(count, 2);
});

test('database errors never return stale Seed entries or a previous successful response', async () => {
  let healthy = true;
  const reader = createPublicSignalReader({
    query: async () => {
      if (!healthy) throw new Error('synthetic unavailable');
      return { rows: [row()] };
    },
  });
  assert.equal((await reader.list()).length, 1);
  healthy = false;
  await assert.rejects(reader.list(), {
    name: 'PublicSignalReaderError',
    message: 'Public signals are unavailable',
  });
  await assert.rejects(reader.byId('signal-current'), { name: 'PublicSignalReaderError' });
  await assert.rejects(reader.search('research'), { name: 'PublicSignalReaderError' });
});

test('bounded lists fail closed rather than silently hiding the rest of the current projection', async () => {
  const reader = createPublicSignalReader({
    query: async () => ({ rows: Array(10001).fill(row()) }),
  });
  await assert.rejects(reader.list(), { name: 'PublicSignalReaderError' });
});

test('search binds normalized literal terms in the live view and never queries the old index', async () => {
  const calls = [];
  const reader = createPublicSignalReader({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [row()] };
    },
  });
  const results = await reader.search('Ｒｅｓｅａｒｃｈ');
  assert.equal(results[0].id, 'signal-current');
  assert.equal(results[0].type, 'signal');
  assert.equal(results[0].body, 'Public analysis');
  assert.equal(calls[0].sql, publicSignalSearchQuery);
  assert.deepEqual(calls[0].parameters, [['research'], 10001]);
  await reader.search("x%' OR TRUE --");
  assert.deepEqual(calls[1].parameters[0], ["x%'", 'or', 'true', '--']);
  assert.doesNotMatch(calls[1].sql, /x%|search_documents/);
  assert.deepEqual(await reader.search('  '), []);
  await assert.rejects(reader.search('x'.repeat(121)), { name: 'SearchQueryError' });
  assert.equal(calls.length, 2);
});

test('search discards all old Signal hits including same-id withdrawn content before merging', () => {
  const result = (id, type, href = `/${type}/${id}`) => ({
    id,
    type,
    href,
    title: id,
    summary: '',
    keywords: '',
    body: '',
    score: 1,
  });
  const merged = mergeCurrentSignalSearch(
    [
      result('withdrawn', 'signal'),
      result('signal-current', 'signal'),
      result('wrong-type', 'resource', '/signals/withdrawn'),
      result('old-topic', 'topic'),
    ],
    [result('signal-current', 'signal')],
  );
  assert.deepEqual(merged.map((entry) => entry.id).sort(), ['old-topic', 'signal-current']);
});

test('Signal view and Topic/search queries share the existing lazy max-one Runtime pool', async () => {
  const options = [];
  const reader = createLazyRuntimeTopicReader({
    environment: runtimeEnvironment,
    createPool: (config) => {
      options.push(config);
      return {
        idleCount: 0,
        totalCount: 1,
        waitingCount: 0,
        query: async (sql) => ({ rows: sql.includes('current_public_signals') ? [row()] : [] }),
      };
    },
  });
  assert.equal(reader.hasPool(), false);
  await reader.readPublicSignals();
  await reader.readPublicSignalById('signal-current');
  await reader.searchPublicSignals('research');
  await reader.readTopics();
  assert.equal(options.length, 1);
  assert.equal(options[0].max, 1);
});

test('old in-process content remains available without projecting any Signals when excluded', async () => {
  const all = await getSearchDocumentProjections();
  const without = await getSearchDocumentProjections(false);
  assert.ok(all.some((entry) => entry.sourceType === 'signal'));
  assert.deepEqual(
    without,
    all.filter((entry) => entry.sourceType !== 'signal'),
  );
});

test('server routing is request-bound, current-only and does not prerender Signal or Topic ids', async () => {
  const source = async (name) => readFile(new URL(name, import.meta.url), 'utf8');
  const server = await source('../lib/server/public-signals.ts');
  assert.match(server, /import 'server-only'/);
  assert.match(server, /await connection\(\)/);
  assert.doesNotMatch(server, /unstable_cache|use cache|new Pool|loadSeedCatalog/);
  for (const name of ['../app/signals/[id]/page.tsx', '../app/topics/[id]/page.tsx']) {
    assert.match(
      await source(name),
      /generateStaticParams\(\) \{\s*if \(readSignalReadMode\(process\.env\) === 'database'\) return \[\]/,
    );
  }
  const seed = await source('../lib/seed-runtime.ts');
  assert.match(seed, /getPublicSignals\(\)/);
  assert.match(seed, /getPublicSignalById\(id\)/);
  assert.doesNotMatch(seed, /catch|unstable_cache/);
  assert.match(await source('../app/sitemap.ts'), /getSignalEntries\(\)/);
  assert.match(await source('../app/radar/page.tsx'), /等待基于新版本重新计算/);
});
