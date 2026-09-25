import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
const { Request, structuredClone } = globalThis;
import { createEditorialReviewService } from '../lib/editorial-review-service.ts';
import { createEditorialHandler } from '../lib/admin-editorial-handler.ts';
import { editorialMissing, editorialNames } from '../lib/editorial-review.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const content = {
  title: '合成标题',
  summary: '测试摘要',
  eventDate: '2026-09-25',
  organizations: ['合成组织'],
  persons: ['测试人物'],
  topics: [{ id: 'ai', title: 'AI' }],
  sourceUrls: [],
};
const materialHash = 'a'.repeat(64);
function setup() {
  const calls = [];
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async (owner, id, index) => {
      calls.push(['material', owner, id, index]);
      return { materialHash, content, warnings: [] };
    },
    topics: async () => content.topics,
    read: async () => null,
    save: async (owner, request, material) => {
      calls.push(['save', owner, request, material]);
      return {
        request_id: request.requestId,
        revision: 1,
        action: request.action,
        content: request.content,
      };
    },
  });
  return { service, calls };
}
const request = () => ({
  requestId,
  runId,
  candidateIndex: 0,
  expectedRevision: 0,
  materialHash,
  action: 'publish',
  content: structuredClone(content),
  consent: true,
});
test('four fields determine readiness; names normalize without invented entities', () => {
  assert.deepEqual(editorialMissing(content), []);
  assert.deepEqual(
    editorialMissing({
      ...content,
      eventDate: '2026-02-30',
      persons: [],
      organizations: [],
      topics: [],
    }),
    ['事件日期', '组织', '人物', '领域'],
  );
  assert.deepEqual(editorialNames('甲、乙\n甲，丙；丁'), ['甲', '乙', '丙', '丁']);
});
test('publication switch participates in build cache invalidation and stays closed in example configuration', async () => {
  const turbo = JSON.parse(await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'));
  assert.ok(turbo.globalEnv.includes('HZENSE_EDITORIAL_PUBLICATION_ENABLED'));
  const example = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^HZENSE_EDITORIAL_PUBLICATION_ENABLED=0$/m);
  assert.match(example, /^HZENSE_EDITORIAL_DATABASE_URL=$/m);
  assert.match(example, /^HZENSE_EDITORIAL_READER_DATABASE_URL=$/m);
});
test('service binds owner and immutable material while allowing manual four-field inputs', async () => {
  const { service, calls } = setup();
  const edit = request();
  edit.content.persons = ['人工补充姓名'];
  const result = await service.write('owner', edit);
  assert.equal(result.action, 'publish');
  assert.match(result.publicId, /^editorial-[a-f0-9]{32}$/);
  assert.equal(result.publicId.includes(runId), false);
  assert.equal(calls[1][1], 'owner');
  assert.deepEqual(calls[1][2].content.persons, ['人工补充姓名']);
  const dashboard = await service.read('owner', runId, 0);
  assert.equal(dashboard.revision, 0);
  assert.equal(dashboard.configured, true);
});
test('service rejects immutable text changes, missing confirmation, missing fields and unknown payload', async () => {
  const { service, calls } = setup();
  for (const modify of [
    (r) => {
      r.content.title = '篡改标题';
    },
    (r) => {
      r.content.sourceUrls = ['https://private.example/a'];
    },
    (r) => {
      r.consent = false;
    },
    (r) => {
      r.content.persons = [];
    },
    (r) => {
      r.extra = true;
    },
    (r) => {
      r.materialHash = 'b'.repeat(64);
    },
  ]) {
    const r = request();
    modify(r);
    await assert.rejects(service.write('owner', r));
  }
  assert.equal(
    calls.some((c) => c[0] === 'save'),
    false,
  );
});
test('partial draft allowed; feature disabled performs no save/read of ledger', async () => {
  const { service } = setup();
  const r = request();
  r.action = 'draft';
  r.consent = false;
  r.content.persons = [];
  assert.equal((await service.write('owner', r)).action, 'draft');
  let touched = false;
  const disabled = createEditorialReviewService({
    enabled: () => false,
    material: async () => ({ materialHash, content, warnings: [] }),
    topics: async () => [],
    read: async () => {
      touched = true;
    },
    save: async () => {
      touched = true;
    },
  });
  assert.equal((await disabled.read('owner', runId, 0)).configured, false);
  await assert.rejects(disabled.write('owner', request()), { code: 'not_configured' });
  assert.equal(touched, false);
});
test('API rejects unauthenticated/cross-origin/duplicate query and never accepts browser owner', async () => {
  let session = { user: { id: 'session-owner' } },
    writes = 0;
  const handler = createEditorialHandler({
    session: async () => session,
    origin: () => 'https://hzense.test',
    read: async (owner) => ({ owner }),
    write: async (owner) => {
      assert.equal(owner, 'session-owner');
      writes++;
      return { ok: true };
    },
  });
  const get = (query, headers = { host: 'hzense.test' }) =>
    new Request(`https://hzense.test/api/admin/editorial-signals?${query}`, { headers });
  assert.equal((await handler(get(`runId=${runId}&candidateIndex=0`))).status, 200);
  assert.equal(
    (await handler(get(`runId=${runId}&candidateIndex=0&candidateIndex=0`))).status,
    400,
  );
  assert.equal(
    (await handler(get(`runId=${runId}&candidateIndex=0`, { host: 'evil.test' }))).status,
    403,
  );
  const post = (origin) =>
    new Request('https://hzense.test/api/admin/editorial-signals', {
      method: 'POST',
      headers: { host: 'hzense.test', origin, 'content-type': 'application/json' },
      body: JSON.stringify(request()),
    });
  assert.equal((await handler(post('https://evil.test'))).status, 403);
  assert.equal((await handler(post('https://hzense.test'))).status, 200);
  session = null;
  assert.equal((await handler(post('https://hzense.test'))).status, 401);
  assert.equal(writes, 1);
});
test('API does not leak database errors and preserves ambiguous commit status', async () => {
  for (const [code, expected] of [
    ['commit_unknown', 'commit_unknown'],
    ['password secret host', 'unavailable'],
  ]) {
    const handler = createEditorialHandler({
      session: async () => ({ user: { id: 'owner' } }),
      origin: () => 'https://hzense.test',
      read: async () => {
        throw Object.assign(new Error('sensitive'), { code });
      },
      write: async () => {},
    });
    const response = await handler(
      new Request(
        `https://hzense.test/api/admin/editorial-signals?runId=${runId}&candidateIndex=0`,
        { headers: { host: 'hzense.test' } },
      ),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: expected });
  }
});
