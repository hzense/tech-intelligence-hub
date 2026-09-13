// Loopback-only test adapter. No production routes, environment validation,
// authentication, credentials or Next bootstrap code are overridden.
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createAiAdminHandler } from '../../../lib/admin-ai-core.ts';
import { createAiAdminExecutor } from '../../../lib/admin-ai-service.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const { Request } = globalThis;

export async function startAiAdminBrowserFixture({ pool, keyring, allowedHosts, invoke }) {
  const compiled = await build({
    entryPoints: [resolve(directory, 'entry.tsx')],
    absWorkingDir: resolve(directory, '../../..'),
    outfile: '/fixture/entry.js',
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    // Next/link normally receives these compile-time flags from Next. Empty
    // feature flags preserve its ordinary anchor behavior in this test mount.
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const assets = new Map(
    compiled.outputFiles.map((file) => [`/__fixture/${file.path.split('/').at(-1)}`, file]),
  );
  const execute = createAiAdminExecutor({ pool, keyring, allowedHosts, invoke });
  const cookie = `hzense_test_session=${randomUUID()}`;
  let origin;
  let droppedOperation;
  const requests = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      const authenticated = (incoming.headers.cookie ?? '')
        .split(';')
        .map((item) => item.trim())
        .includes(cookie);
      if (url.pathname.startsWith('/api/admin/ai/')) {
        const suffix = url.pathname.slice('/api/admin/ai/'.length);
        const method = incoming.method;
        let operation;
        let id;
        if (suffix === 'connections')
          operation = {
            GET: 'list-connections',
            POST: 'create-connection',
            PATCH: 'update-connection',
          }[method];
        else if (suffix === 'profiles')
          operation = { GET: 'list-profiles', POST: 'save-profile' }[method];
        else if (suffix === 'probes') operation = { GET: 'list-probes', POST: 'run-probe' }[method];
        else {
          let match = /^connections\/([^/]+)\/history$/.exec(suffix);
          if (match) {
            operation = 'connection-history';
            id = match[1];
          }
          match = /^profiles\/([^/]+)\/history$/.exec(suffix);
          if (match) {
            operation = 'profile-history';
            id = match[1];
          }
          match = /^probes\/([^/]+)$/.exec(suffix);
          if (match) {
            operation = 'get-probe';
            id = match[1];
          }
        }
        if (!operation) {
          outgoing.writeHead(404).end();
          return;
        }
        const handler = createAiAdminHandler({
          authenticate: async () => (authenticated ? { user: { id: 'synthetic-admin' } } : null),
          origin: () => origin,
          execute,
        });
        const request = new Request(url, {
          method,
          headers: incoming.headers,
          ...(method === 'GET' || method === 'HEAD'
            ? {}
            : { body: Readable.toWeb(incoming), duplex: 'half' }),
        });
        const response = await handler(request, operation, id);
        requests.push({ method, path: url.pathname, status: response.status });
        // Test-only response loss AFTER the real transaction commits. Return
        // an explicit unknown outcome instead of a TCP reset (Chromium may
        // transparently retry resets). The UI must reuse its original ID.
        if (response.ok && droppedOperation === operation) {
          droppedOperation = undefined;
          outgoing.writeHead(503, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          outgoing.end('{"error":"database_unavailable"}');
          return;
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!authenticated) {
        outgoing
          .writeHead(401, { 'Cache-Control': 'no-store' })
          .end('Fixture authentication required');
        return;
      }
      if (url.pathname === '/__fixture/bootstrap') {
        const [connections, profiles, probes] = await Promise.all([
          execute('list-connections', {}),
          execute('list-profiles', {}),
          execute('list-probes', {}),
        ]);
        outgoing.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        outgoing.end(JSON.stringify({ ...connections, ...profiles, ...probes }));
      } else if (assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        outgoing.writeHead(200, {
          'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          'Cache-Control': 'no-store',
        });
        outgoing.end(asset.contents);
      } else if (['/admin/ai', '/admin/ai/profiles'].includes(url.pathname)) {
        outgoing.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        outgoing.end(
          '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI component / HTTP / PostgreSQL test fixture — not Next production</title><link rel="stylesheet" href="/__fixture/entry.css"></head><body><h1>AI component / HTTP / PostgreSQL fixture</h1><p>Test adapter only: synthetic session and provider; no Google or production Next bootstrap.</p><nav><a href="/admin/ai">连接</a> <a href="/admin/ai/profiles">分阶段配置</a></nav><main id="fixture-root">Loading fixture…</main><script type="module" src="/__fixture/entry.js"></script></body></html>',
        );
      } else {
        outgoing.writeHead(404).end();
      }
    } catch {
      if (!outgoing.headersSent)
        outgoing.writeHead(500, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
      outgoing.end('{"error":"fixture_unavailable"}');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    cookie,
    requests,
    dropNextSuccessfulResponse: (operation) => {
      droppedOperation = operation;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}
