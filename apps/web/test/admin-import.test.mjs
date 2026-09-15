import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
const { Request, ReadableStream } = globalThis;
import { createImportAdminHandler, importError } from '../lib/admin-import-core.ts';
import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { readImportBytes, ImportIOError } from '../lib/import-io.ts';
import { assertImportFetchURL, fetchImportURL } from '../lib/import-fetch.ts';
const origin = 'https://hzense.com';
test('retry limit is a conflict rather than a transient service error', async () => {
  const response = importError(new ImportTaskError('retry_not_allowed'));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'retry_not_allowed' });
});
test('list cursor is forwarded without allowing extra or repeated query fields', async () => {
  let received;
  const h = createImportAdminHandler({
    session: async () => ({ user: { id: 'admin' } }),
    origin: () => origin,
    execute: async (_owner, _method, body) => {
      received = body;
      return {};
    },
  });
  assert.equal((await h(new Request(`${origin}/api/admin/imports?before=example`))).status, 200);
  assert.deepEqual(received, { before: 'example' });
  assert.equal((await h(new Request(`${origin}/api/admin/imports?before=a&before=b`))).status, 400);
  assert.equal((await h(new Request(`${origin}/api/admin/imports?owner=someone`))).status, 400);
});
function request(body = {}, headers = {}) {
  return new Request(`${origin}/api/admin/imports`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
test('import API authenticates before reading input or accessing resources', async () => {
  let executed = false;
  const h = createImportAdminHandler({
    session: async () => null,
    origin: () => origin,
    execute: async () => {
      executed = true;
    },
  });
  assert.equal((await h(request())).status, 401);
  assert.equal(executed, false);
});
test('import API rejects cross-site writes and derives owner from session', async () => {
  let owner;
  const h = createImportAdminHandler({
    session: async () => ({ user: { id: 'admin-sub' } }),
    origin: () => origin,
    execute: async (id) => {
      owner = id;
      return { ok: true };
    },
  });
  assert.equal((await h(request({}, { origin: 'https://evil.example' }))).status, 403);
  assert.equal(owner, undefined);
  const response = await h(request({ owner: 'impostor' }));
  assert.equal(response.status, 200);
  assert.equal(owner, 'admin-sub');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
});
test('import API sanitizes errors and enforces actual body bytes', async () => {
  const h = createImportAdminHandler({
    session: async () => ({ user: { id: 'admin' } }),
    origin: () => origin,
    execute: async () => {
      throw new Error('postgres://private:secret@host');
    },
  });
  assert.deepEqual(await (await h(request())).json(), { error: 'unavailable' });
  assert.deepEqual(await (await h(request({ data: 'a'.repeat(270000) }))).json(), {
    error: 'limit_exceeded',
  });
});
test('bounded reader cancels over-limit and stalled sources', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(10));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readImportBytes(stream, 5), { code: 'limit_exceeded' });
  assert.ok(cancelled);
  await assert.rejects(readImportBytes(new ReadableStream({}), 100, 10), {
    code: 'limit_exceeded',
  });
});
test('URL import rejects credentialed, IP and non-HTTPS targets', () => {
  for (const url of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://127.0.0.1',
    'https://localhost/x',
    'https://example.com:8080',
  ])
    assert.throws(() => assertImportFetchURL(url));
});
test('URL import validates every redirect and rejects DNS rebinding targets', async () => {
  let calls = 0;
  const deps = {
    resolve: async () => ({ address: '93.184.216.34', family: 4 }),
    hop: async () => {
      calls++;
      return { bytes: Buffer.alloc(0), type: '', location: 'https://127.0.0.1/secret' };
    },
  };
  await assert.rejects(fetchImportURL('https://example.com', deps), { code: 'fetch_failed' });
  assert.equal(calls, 1);
  await assert.rejects(
    fetchImportURL('https://example.com', {
      ...deps,
      resolve: async () => ({ address: '169.254.169.254', family: 4 }),
    }),
    { code: 'fetch_failed' },
  );
  assert.equal(calls, 1);
});
test('URL import returns only bounded supported source types and caps redirects', async () => {
  const deps = {
    resolve: async () => ({ address: '93.184.216.34', family: 4 }),
    hop: async () => ({ bytes: Buffer.from('hello'), type: 'text/plain' }),
  };
  assert.equal((await fetchImportURL('https://example.com', deps)).format, 'text');
  await assert.rejects(
    fetchImportURL('https://example.com', {
      ...deps,
      hop: async () => ({ bytes: Buffer.from('x'), type: 'application/zip' }),
    }),
    { code: 'unsupported_content' },
  );
  let hops = 0;
  await assert.rejects(
    fetchImportURL('https://example.com', {
      ...deps,
      hop: async () => {
        hops++;
        return { bytes: Buffer.alloc(0), type: '', location: '/loop' };
      },
    }),
    ImportIOError,
  );
  assert.equal(hops, 4);
});
