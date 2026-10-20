import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { fetchImportHop, fetchImportURL, resolveImportHost } from '../lib/import-fetch.ts';
import { ImportIOError, importFetchDiagnostic } from '../lib/import-io.ts';

const url = new URL('https://example.com/private?token=do-not-log');
const address = { address: '93.184.216.34', family: 4 };
function transport({ status = 200, headers = {}, data, failure, wait = false } = {}) {
  const response = new EventEmitter();
  response.statusCode = status;
  response.headers = { 'content-type': 'text/plain', ...headers };
  response.destroy = () => {};
  const req = new EventEmitter();
  req.destroy = (error) => {
    // Node may report an aborted response before the request's original error.
    response.emit('error', new Error('aborted secret response'));
    req.emit('error', error);
  };
  let captured;
  const request = (target, options, callback) => {
    captured = { target, options };
    req.end = () => {
      if (wait) return;
      globalThis.queueMicrotask(() => {
        if (failure) {
          req.emit('error', failure);
          return;
        }
        callback(response);
        if (status !== 200 || headers['content-encoding']) return;
        response.emit('data', data ?? Buffer.from('hello'));
        response.emit('end');
      });
    };
    return req;
  };
  return { request, req, response, captured: () => captured };
}

test('fetch transport records only a bounded HTTP status, never the URL or body', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const fake = transport({ status, headers: { 'x-secret': 'never-log' } });
    await assert.rejects(fetchImportHop(url, address, fake.request), (error) => {
      assert.equal(error.code, 'fetch_failed');
      assert.deepEqual(importFetchDiagnostic(error), { reason: 'http_status', status });
      assert.equal(error.message, 'fetch_failed');
      return true;
    });
  }
});

test('fetch transport preserves the byte limit despite request/response error ordering', async () => {
  const fake = transport({ data: Buffer.alloc(25 * 1024 * 1024 + 1) });
  await assert.rejects(fetchImportHop(url, address, fake.request), (error) => {
    assert.equal(error.code, 'limit_exceeded');
    assert.equal(importFetchDiagnostic(error), undefined);
    return true;
  });
});

test('fetch transport accepts the exact byte limit and keeps TLS, DNS pinning and identity encoding', async () => {
  const data = Buffer.alloc(25 * 1024 * 1024);
  const fake = transport({ data });
  const result = await fetchImportHop(url, address, fake.request);
  assert.equal(result.bytes.length, data.length);
  assert.equal(result.type, 'text/plain');
  const { options } = fake.captured();
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false);
  assert.equal(options.servername, 'example.com');
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  assert.equal(options.headers['User-Agent'], 'HZense-Import/1.0');
  options.lookup('example.com', { all: false }, (error, ip, family) => {
    assert.equal(error, null);
    assert.equal(ip, address.address);
    assert.equal(family, 4);
  });
});

test('fetch timeout stays a deterministic failure without leaking exception messages', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = transport({ wait: true });
  // No response exists yet; do not synthesize an impossible response error.
  fake.req.destroy = (error) => fake.req.emit('error', error);
  const result = fetchImportHop(url, address, fake.request);
  t.mock.timers.tick(15000);
  await assert.rejects(result, (error) => {
    assert.equal(error.code, 'fetch_failed');
    assert.deepEqual(importFetchDiagnostic(error), { reason: 'timeout' });
    return true;
  });
});

test('fetch transport distinguishes unsupported encoding and network errors', async () => {
  const encoded = transport({ headers: { 'content-encoding': 'gzip' } });
  await assert.rejects(fetchImportHop(url, address, encoded.request), (error) => {
    assert.deepEqual(importFetchDiagnostic(error), { reason: 'encoding' });
    return true;
  });
  for (const request of [
    transport({ failure: new Error('certificate for secret.example.com') }).request,
    () => {
      throw new Error('request setup includes a secret URL');
    },
  ]) {
    await assert.rejects(fetchImportHop(url, address, request), (error) => {
      assert.equal(error.code, 'fetch_failed');
      assert.deepEqual(importFetchDiagnostic(error), { reason: 'network' });
      assert.equal(error.message, 'fetch_failed');
      return true;
    });
  }
});

test('DNS diagnostics do not expose the target, address or native error', async () => {
  for (const code of ['ENOTFOUND', 'ENODATA', 'ETIMEOUT', 'SERVFAIL']) {
    const resolve = async () => {
      throw Object.assign(new Error('private.example.com lookup failed'), { code });
    };
    await assert.rejects(
      resolveImportHost('private.example.com', { resolve4: resolve, resolve6: resolve }),
      (error) => {
        assert.equal(error.code, 'fetch_failed');
        assert.deepEqual(importFetchDiagnostic(error), { reason: 'dns' });
        return true;
      },
    );
  }
  await assert.rejects(
    resolveImportHost('example.com', {
      resolve4: async () => ['127.0.0.1'],
      resolve6: async () => [],
    }),
    { code: 'fetch_failed' },
  );
});

test('diagnostic projection drops arbitrary properties and invalid reasons/statuses', () => {
  for (const diagnostic of [
    { reason: 'http_status', status: 99 },
    { reason: 'http_status', status: 600 },
    { reason: 'http_status', status: '403' },
    { reason: 'http_status', status: 403.5 },
    { reason: 'secret:api-key' },
    null,
  ]) {
    assert.equal(importFetchDiagnostic(new ImportIOError('fetch_failed', diagnostic)), undefined);
  }
  const error = new ImportIOError('fetch_failed', {
    reason: 'http_status',
    status: 403,
    url: url.href,
    body: 'private document',
    headers: { authorization: 'secret' },
  });
  assert.deepEqual(importFetchDiagnostic(error), { reason: 'http_status', status: 403 });
  assert.equal(
    importFetchDiagnostic({ code: 'fetch_failed', diagnostic: error.diagnostic }),
    undefined,
  );
  assert.equal(
    importFetchDiagnostic(new ImportIOError('parse_failed', error.diagnostic)),
    undefined,
  );
});

test('URL fetch emits a safe diagnostic once and logging failures preserve the original error', async () => {
  const failure = new ImportIOError('fetch_failed', { reason: 'http_status', status: 429 });
  const seen = [];
  for (const throws of [false, true]) {
    await assert.rejects(
      fetchImportURL(
        url.href,
        {
          resolve: async () => address,
          hop: async () => {
            throw failure;
          },
        },
        {
          onDiagnostic(value) {
            seen.push(value);
            if (throws) throw new Error('log unavailable');
          },
        },
      ),
      (error) => error === failure,
    );
  }
  assert.deepEqual(seen, [
    { reason: 'http_status', status: 429 },
    { reason: 'http_status', status: 429 },
  ]);
  const service = readFileSync(new URL('../lib/server/import-service.ts', import.meta.url), 'utf8');
  assert.match(service, /event: 'import_fetch_failed', \.\.\.diagnostic/);
});
