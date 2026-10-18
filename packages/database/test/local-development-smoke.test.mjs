import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildLocalSmokeFixture,
  createLocalSmokeClient,
  parseLocalSmokeArguments,
  runLocalDevelopmentSmoke,
  verifyLocalSmokeBoundary,
} from '../../../scripts/local-development-smoke.mjs';

describe('local development HTTP smoke safety (mock transport, not integration acceptance)', () => {
  it('pins literal loopback origin without accepting a login token or alternate host', () => {
    expect(parseLocalSmokeArguments([])).toEqual({
      port: 3000,
      origin: 'http://127.0.0.1:3000',
    });
    expect(parseLocalSmokeArguments(['--port=3001']).port).toBe(3001);
    for (const args of [
      ['--host=localhost'],
      ['--port=80'],
      ['--port=65536'],
      ['--port=3000', '--port=3001'],
      ['--token-file=.hzense-local/login-' + 'a'.repeat(32) + '.token'],
    ])
      expect(() => parseLocalSmokeArguments(args)).toThrow();
  });

  it('adds a unique fixture title while preserving its explicit fictional marker and other facts', async () => {
    const source = await readFile(
      new URL('../../../docs/fixtures/local-signal.md', import.meta.url),
      'utf8',
    );
    const fixture = buildLocalSmokeFixture(source, 'a'.repeat(12));
    expect(fixture.title).toMatch(/^【本地模拟】.* a{12}$/);
    expect(Array.from(fixture.title).length).toBeLessThanOrEqual(80);
    expect(fixture.bytes.toString().replace(/ a{12}/u, '')).toBe(source);
    expect(() => buildLocalSmokeFixture('ordinary source', 'a'.repeat(12))).toThrow();
    expect(() => buildLocalSmokeFixture(source, 'not-random')).toThrow();
  });

  it('never retains or sends cookies and never requests nonlocal paths or follows redirects', async () => {
    const calls = [];
    const request = createLocalSmokeClient('http://127.0.0.1:3000', async (url, options) => {
      calls.push({ url: String(url), options });
      return new globalThis.Response('{}', {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'hzense-local.session-token=synthetic-cookie; Path=/; HttpOnly',
        },
      });
    });
    await request.json('/api/health/database');
    await request.json('/api/admin/signal-generation');
    expect(calls[0].options.headers.Cookie).toBeUndefined();
    expect(calls[1].options.headers.Cookie).toBeUndefined();
    expect(calls.every(({ options }) => options.credentials === 'omit')).toBe(true);
    expect(calls.every(({ options }) => options.redirect === 'manual')).toBe(true);
    for (const path of [
      'https://production.invalid/',
      '//remote.invalid/',
      '/\\remote.invalid/',
      '/path#fragment',
    ])
      await expect(request.json(path)).rejects.toThrow();
    expect(calls).toHaveLength(2);
    const redirected = createLocalSmokeClient(
      'http://127.0.0.1:3000',
      async () =>
        new globalThis.Response(null, {
          status: 302,
          headers: { location: 'https://production.invalid/' },
        }),
    );
    await expect(redirected.json('/api/admin/signal-generation')).rejects.toThrow(
      'redirect_refused',
    );
    for (const origin of [
      'http://localhost:3000',
      'https://127.0.0.1:3000',
      'http://192.168.1.1:3000',
    ])
      expect(() => createLocalSmokeClient(origin)).toThrow();
  });

  it('requires database health and wrong forwarded Host/Origin rejection before any write', async () => {
    const calls = [];
    const client = createLocalSmokeClient('http://127.0.0.1:3000', async (url, options) => {
      calls.push({ url: String(url), options });
      const status = options.headers['X-Forwarded-Host']
        ? 401
        : options.headers.Origin.startsWith('https:')
          ? 403
          : 200;
      return new globalThis.Response(
        JSON.stringify(status === 200 ? { status: 'ok' } : { error: 'forbidden' }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    await verifyLocalSmokeBoundary(client);
    expect(calls).toHaveLength(3);
    expect(
      calls.every(
        ({ url, options }) =>
          url.startsWith('http://127.0.0.1:3000/') &&
          options.method === 'GET' &&
          options.headers.Cookie === undefined,
      ),
    ).toBe(true);
    expect(calls[1].options.headers['X-Forwarded-Host']).toBe('not-local.invalid');
    expect(calls[1].options.headers.Host).toBeUndefined();
    expect(calls[2].options.headers.Origin).toBe('https://not-local.invalid');
    await expect(
      client.request('/api/admin/imports', { method: 'POST', authorityProbe: 'forwarded-host' }),
    ).rejects.toThrow('invalid_authority_probe');
    expect(calls).toHaveLength(3);
    const unsafe = createLocalSmokeClient(
      'http://127.0.0.1:3000',
      async () =>
        new globalThis.Response('{"status":"ok"}', {
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(verifyLocalSmokeBoundary(unsafe)).rejects.toThrow('http_200_unexpected_status');
  });

  it('does not automatically repeat an ambiguous write or expose returned private diagnostics', async () => {
    let attempts = 0;
    const client = createLocalSmokeClient('http://127.0.0.1:3000', async () => {
      attempts += 1;
      throw new Error('synthetic-secret-do-not-print');
    });
    await expect(
      client.json('/api/admin/signal-generation', { method: 'POST', json: { action: 'run' } }),
    ).rejects.toThrow('http_outcome_unknown_no_retry');
    expect(attempts).toBe(1);
    const failed = createLocalSmokeClient(
      'http://127.0.0.1:3000',
      async () =>
        new globalThis.Response(JSON.stringify({ error: 'secret'.repeat(20) }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(failed.json('/api/admin/imports')).rejects.toThrow('http_503_unexpected_status');
  });

  it('refuses deployed or proxy-influenced execution before reading files or making requests', async () => {
    for (const environment of [
      { CI: '1' },
      { VERCEL: '1' },
      { HTTPS_PROXY: 'http://proxy' },
      { NODE_OPTIONS: '--use-env-proxy' },
    ])
      await expect(
        runLocalDevelopmentSmoke({
          args: [],
          root: '/nonexistent',
          environment,
        }),
      ).rejects.toThrow();
  });
});
