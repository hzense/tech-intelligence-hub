import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSignalMaximumEntries } from '../lib/public-signal-reader-core.ts';
import {
  createUnifiedSignalReader,
  unifiedPublicStatusQuery,
} from '../lib/unified-signal-reader-core.ts';

const row = {
  signal_id: 'chip-announcement',
  title: '芯片发布',
  occurred_at: '2026-11-25T03:15:00.000Z',
  source_urls: ['https://chipmaker.com/news', 'https://publisher.com/article'],
  topic_ids: ['topic-ai-accelerator', 'topic-industry'],
};

function sourceReader(rows, ready = true) {
  const queries = [];
  const reader = createUnifiedSignalReader({
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return { rows: sql === unifiedPublicStatusQuery ? [{ ready }] : rows };
    },
  });
  return { reader, queries };
}

test('source directory reads public titles, dates, URLs and all topic IDs in one bounded content query', async () => {
  const { reader, queries } = sourceReader([
    row,
    {
      signal_id: 'no-source',
      title: '暂无来源',
      occurred_at: '2026-11-24',
      source_urls: [],
      topic_ids: [],
    },
  ]);
  assert.deepEqual(await reader.sourceDirectory(), [
    {
      id: row.signal_id,
      title: row.title,
      date: '2026-11-25',
      sources: row.source_urls.map((url) => ({ url })),
      topicIds: row.topic_ids,
    },
    { id: 'no-source', title: '暂无来源', date: '2026-11-24', sources: [], topicIds: [] },
  ]);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].sql, unifiedPublicStatusQuery);
  const content = queries[1];
  assert.match(content.sql, /FROM public\.unified_public_signals\s/);
  assert.match(content.sql, /jsonb_array_elements\(u\.content->'sources'\)/);
  assert.match(content.sql, /jsonb_array_elements\(u\.content->'topics'\)/);
  assert.match(content.sql, /LIMIT \$1$/);
  assert.deepEqual(content.parameters, [publicSignalMaximumEntries + 1]);
  assert.doesNotMatch(
    content.sql,
    /u\.content\s*(?:,|FROM)|summary|people|organizations|archived|private|SELECT \*/i,
  );
});

test('directory fails closed on incomplete reads, drift and overflow rather than returning partial counts', async () => {
  const publicFailure = {
    name: 'PublicSignalReaderError',
    message: 'Public signals are unavailable',
  };
  const unready = sourceReader([], false);
  await assert.rejects(unready.reader.sourceDirectory(), publicFailure);
  assert.equal(unready.queries.length, 1);
  for (const rows of [
    [row, row],
    [{ ...row, occurred_at: '2026-02-31' }],
    [{ ...row, source_urls: null }],
    [{ ...row, topic_ids: null }],
    [{ ...row, topic_ids: ['invalid id'] }],
    [{ ...row, topic_ids: ['topic-ai', 'topic-ai'] }],
    [{ ...row, title: 'a'.repeat(100001) }],
    [{ ...row, source_urls: [row.source_urls[0], row.source_urls[0]] }],
    [{ ...row, source_urls: ['https://private:password@publisher.com'] }],
    Array(publicSignalMaximumEntries + 1).fill(row),
  ])
    await assert.rejects(sourceReader(rows).reader.sourceDirectory(), publicFailure);
  assert.deepEqual(await sourceReader([]).reader.sourceDirectory(), []);
});
