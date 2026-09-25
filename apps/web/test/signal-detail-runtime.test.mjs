import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

test(
  'built Signal details stay request-rendered with editorial publication on and off',
  {
    skip: process.env.HZENSE_SIGNAL_DETAIL_INTEGRATION !== '1',
    timeout: 60_000,
  },
  async (t) => {
    for (const enabled of ['0', '1']) {
      await t.test(`editorial publication = ${enabled}`, async (t) => {
        const socket = createServer();
        await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
        const { port } = socket.address();
        await new Promise((resolve) => socket.close(resolve));
        // No inherited credentials, AI calls, or database queries. The malformed
        // editorial ID reaches the real connection() boundary, then returns before
        // SQL. This exercises the fallback path that used to throw on production.
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(port),
          ],
          {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            env: {
              PATH: process.env.PATH,
              NODE_ENV: 'production',
              NEXT_TELEMETRY_DISABLED: '1',
              VERCEL_ENV: 'production',
              HZENSE_SEARCH_MODE: 'in-process',
              HZENSE_SIGNAL_READ_MODE: 'legacy',
              HZENSE_EDITORIAL_PUBLICATION_ENABLED: enabled,
              HZENSE_EDITORIAL_READER_DATABASE_URL:
                'postgresql://hzense_editorial_reader:synthetic@ep-fixture-pooler.us-east-1.aws.neon.tech:5432/editorial?sslmode=verify-full&channel_binding=prefer',
              HZENSE_RUNTIME_EXPECTED_HOST: 'ep-fixture-pooler.us-east-1.aws.neon.tech',
              HZENSE_RUNTIME_EXPECTED_NAME: 'editorial',
              HZENSE_RUNTIME_EXPECTED_PORT: '5432',
              HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        const exited = new Promise((resolve) => child.once('exit', resolve));
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          await exited;
        });
        for (let count = 0; !output.includes('Ready in'); count++) {
          assert.equal(child.exitCode, null, output);
          assert.ok(count < 200, 'Build the web app before running this integration test');
          await delay(50);
        }
        const origin = `http://127.0.0.1:${port}`;
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await globalThis.fetch(`${origin}/signals/editorial-invalid`, {
            headers: { 'user-agent': 'Googlebot' },
            signal: globalThis.AbortSignal.timeout(10000),
          });
          const body = await response.text();
          assert.equal(response.status, 404, output);
          assert.match(body, /这个页面还没有形成情报/);
          assert.doesNotMatch(body, /DYNAMIC_SERVER_USAGE|Application error/);
        }
        if (enabled === '0') {
          const response = await globalThis.fetch(
            `${origin}/signals/signal-20260910-anthropic-threat-report`,
          );
          assert.equal(response.status, 200);
          const body = await response.text();
          assert.match(body, /signal-detail-body/);
          assert.match(body, /rel="canonical"/);
          assert.match(response.headers.get('cache-control'), /no-store/);
        }
        assert.doesNotMatch(output, /DYNAMIC_SERVER_USAGE/);
      });
    }
    const manifest = JSON.parse(
      await readFile(new URL('../.next/prerender-manifest.json', import.meta.url), 'utf8'),
    );
    assert.equal(manifest.dynamicRoutes['/signals/[id]'], undefined);
    assert.equal(
      Object.keys(manifest.routes).some((path) => path.startsWith('/signals/')),
      false,
    );
  },
);
