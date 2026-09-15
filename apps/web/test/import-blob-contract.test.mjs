import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleUpload, getPayloadFromClientToken } from '@vercel/blob/client';
const { Request } = globalThis;
// Synthetic token: cryptographic contract only; never contacts a Blob store.
const token = 'vercel_blob_rw_synthetic_store_secret';
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
