import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { handleUpload, getPayloadFromClientToken } from '@vercel/blob/client';
import { del, get } from '@vercel/blob';
import { importBlobReadOptions } from '../lib/import-blob-read-options.ts';
import { assertImportBlobVersion } from '../lib/import-blob-validation.ts';
const { Request } = globalThis;
// Synthetic token: cryptographic contract only; never contacts a Blob store.
const token = 'vercel_blob_rw_synthetic_store_secret';
test('private original reads request identity encoding through the installed SDK and retain ETag rejection', async (t) => {
  const require = createRequire(import.meta.url);
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
    require.resolve('@vercel/blob'),
  )('undici');
  const previous = getGlobalDispatcher(),
    agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });
  const options = importBlobReadOptions(token);
  assert.equal(options.access, 'private');
  assert.equal(options.useCache, false);
  assert.equal(options.abortSignal.aborted, false);
  agent
    .get('https://synthetic.private.blob.vercel-storage.com')
    .intercept({
      path: '/imports/batch/item?cache=0',
      method: 'GET',
      headers: { 'accept-encoding': 'identity', authorization: `Bearer ${token}` },
    })
    .reply(200, 'hello', { headers: { etag: '"original-v1"', 'content-length': '5' } });
  const result = await get('imports/batch/item', options);
  assert.equal(result.statusCode, 200);
  assertImportBlobVersion(result.statusCode, result.blob.etag, '"original-v1"');
  assert.throws(
    () => assertImportBlobVersion(200, result.blob.etag, '"other-version"'),
    (e) => e.reason === 'blob_etag_mismatch',
  );
  await result.stream.cancel();
  agent.assertNoPendingInterceptors();
});
test('installed Blob SDK transmits conditional deletion rather than ignoring ifMatch', async (t) => {
  const require = createRequire(import.meta.url);
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
    require.resolve('@vercel/blob'),
  )('undici');
  const previous = getGlobalDispatcher(),
    agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });
  let requests = 0;
  agent
    .get('https://vercel.com')
    .intercept({
      path: '/api/blob/delete',
      method: 'POST',
      headers: { 'x-if-match': 'etag-v1' },
      body: JSON.stringify({ urls: ['imports/synthetic/original'] }),
    })
    .reply(() => {
      requests++;
      return { statusCode: 200, data: '{}' };
    });
  await del('imports/synthetic/original', {
    token,
    ifMatch: 'etag-v1',
    abortSignal: globalThis.AbortSignal.timeout(2000),
  });
  assert.equal(requests, 1);
  agent.assertNoPendingInterceptors();
  await assert.rejects(del(['first', 'second'], { token, ifMatch: 'etag-v1' }));
  assert.equal(requests, 1);
});
test('installed Blob SDK signs exact path, bounded size, expiry and no-overwrite claims', async () => {
  const path = 'imports/synthetic-batch/synthetic-item',
    validUntil = Date.now() + 300000;
  const result = await handleUpload({
    token,
    request: new Request('https://hzense.com/api/admin/imports/upload'),
    body: {
      type: 'blob.generate-client-token',
      payload: { pathname: path, clientPayload: '{}', multipart: false },
    },
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ['application/octet-stream'],
      maximumSizeInBytes: 10,
      validUntil,
      allowOverwrite: false,
      addRandomSuffix: false,
      callbackUrl: 'https://hzense.com/api/imports/blob',
      tokenPayload: 'owner-bound',
    }),
    onUploadCompleted: async () => {},
  });
  const payload = getPayloadFromClientToken(result.clientToken);
  assert.equal(payload.pathname, path);
  assert.equal(payload.maximumSizeInBytes, 10);
  assert.equal(payload.validUntil, validUntil);
  assert.equal(payload.allowOverwrite, false);
  assert.equal(payload.addRandomSuffix, false);
  assert.equal(payload.onUploadCompleted.tokenPayload, 'owner-bound');
  assert.equal(payload.onUploadCompleted.callbackUrl, 'https://hzense.com/api/imports/blob');
});
test('installed Blob SDK refuses forged callbacks before invoking completion', async () => {
  let called = 0;
  const body = {
    type: 'blob.upload-completed',
    payload: {
      blob: { pathname: 'imports/a/b', url: 'https://untrusted.example/ignored' },
      tokenPayload: 'owner-bound',
    },
  };
  const run = (signature) =>
    handleUpload({
      token,
      body,
      request: new Request('https://hzense.com/api/imports/blob', {
        headers: { 'x-vercel-signature': signature },
      }),
      onBeforeGenerateToken: async () => {
        throw new Error('forbidden');
      },
      onUploadCompleted: async () => {
        called++;
      },
    });
  await assert.rejects(run('00'.repeat(32)));
  assert.equal(called, 0);
  await run(createHmac('sha256', token).update(JSON.stringify(body)).digest('hex'));
  assert.equal(called, 1);
});
