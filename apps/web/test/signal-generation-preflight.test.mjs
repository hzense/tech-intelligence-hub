import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  readGenerationConfiguration,
  readGenerationDatabaseConfiguration,
} from '../lib/signal-generation-config.ts';
import { createGenerationPreflight } from '../lib/signal-generation-preflight.ts';
import { generationRoleCheckSQL } from '../../../packages/database/src/signal-generation-role-check.mjs';

const env = {
  VERCEL_ENV: 'production',
  HZENSE_SIGNAL_GENERATION_ENABLED: '0',
  HZENSE_RUNTIME_EXPECTED_HOST: 'ep-fixture-pooler.eu-central-1.aws.neon.tech',
  HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'fixturedb',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  HZENSE_GENERATION_DATABASE_URL:
    'postgresql://hzense_generation_admin:fixture-password@ep-fixture-pooler.eu-central-1.aws.neon.tech:5432/fixturedb?sslmode=verify-full&channel_binding=prefer',
};
const driverError = new Error(`sensitive driver details ${env.HZENSE_GENERATION_DATABASE_URL}`);

function fixture(options = {}) {
  const calls = [];
  const queryCalls = [];
  const created = [];
  const check = createGenerationPreflight({
    environment: () => ({ ...env, ...options.env }),
    createClient(config) {
      created.push(config);
      calls.push('create');
      if (options.createFails) throw driverError;
      return {
        async connect() {
          calls.push('connect');
          if (options.connectWait) await options.connectWait;
          if (options.connectFails) throw driverError;
        },
        verifiedTls() {
          calls.push('tls');
          if (options.tlsThrows) throw driverError;
          return options.tls ?? true;
        },
        async query(text, values) {
          calls.push(text);
          queryCalls.push({ text, values });
          if (options.queryFails?.(text)) throw driverError;
          if (text.includes("current_setting('transaction_read_only')"))
            return {
              rows: [{ identity: options.identity ?? true, read_only: options.readOnly ?? true }],
            };
          if (text === generationRoleCheckSQL)
            return { rows: [{ safe: options.permissions ?? true }] };
          if (text.includes('session_user=current_user AS safe'))
            return { rows: [{ safe: options.roleIdentity ?? true }] };
          if (text.includes('WHERE false')) return { rows: options.probeRows ?? [] };
          return { rows: [] };
        },
        async end() {
          calls.push('end');
          if (options.endWait) await options.endWait;
          if (options.endFails) throw driverError;
        },
      };
    },
  });
  return { check, calls, queryCalls, created };
}

test('connection-only configuration works with generation disabled and no budgets without enabling generation', async () => {
  const config = readGenerationDatabaseConfiguration(env);
  assert.equal(config.user, 'hzense_generation_admin');
  assert.equal(config.connectionString, env.HZENSE_GENERATION_DATABASE_URL);
  assert.equal(config.database, 'fixturedb');
  assert.throws(() => readGenerationConfiguration(env), { code: 'not_configured' });
  assert.throws(
    () => readGenerationConfiguration({ ...env, HZENSE_SIGNAL_GENERATION_ENABLED: '1' }),
    {
      code: 'not_configured',
    },
  );
  const f = fixture();
  assert.deepEqual(await f.check(), {
    status: 'ok',
    checks: {
      configuration: true,
      connection: true,
      tls: true,
      identity: true,
      readOnly: true,
      permissions: true,
    },
  });
  assert.equal(f.created[0].connectionString, env.HZENSE_GENERATION_DATABASE_URL);
});

test('connection policy retains Production, target, account, and certificate checks', async () => {
  const url = env.HZENSE_GENERATION_DATABASE_URL;
  for (const change of [
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: undefined },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { HZENSE_RUNTIME_EXPECTED_NAME: 'different' },
    { HZENSE_RUNTIME_EXPECTED_PORT: '5433' },
    { HZENSE_RUNTIME_EXPECTED_HOST: 'different-pooler.neon.tech' },
    { HZENSE_RUNTIME_EXPECTED_USER: 'hzense_generation_admin' },
    { HZENSE_GENERATION_DATABASE_URL: undefined },
    ...[
      url.replace('hzense_generation_admin', 'hzense_migrator'),
      url.replace('fixture-password', ''),
      url.replace('verify-full', 'require'),
      url.replace('verify-full', 'no-verify'),
      url.replace('&channel_binding=prefer', ''),
      url.replace('channel_binding=prefer', 'channel_binding=disable'),
      url.replace(':5432/', '/'),
      url.replace('-pooler.', '.'),
      `${url}&options=-c%20role%3Dhzense_migrator`,
      `${url}&sslmode=no-verify`,
    ].map((HZENSE_GENERATION_DATABASE_URL) => ({ HZENSE_GENERATION_DATABASE_URL })),
  ]) {
    const f = fixture({ env: change });
    const result = await f.check();
    assert.equal(result.error, 'configuration_invalid', JSON.stringify(change));
    assert.equal(result.checks.configuration, false);
    assert.equal(f.created.length, 0);
    assert.throws(() => readGenerationDatabaseConfiguration({ ...env, ...change }), {
      code: 'not_configured',
    });
  }
});

test('preflight uses a read-only transaction, real identity, bounded queries, zero-row probe and rollback', async () => {
  const f = fixture();
  await f.check();
  assert.deepEqual(f.calls.slice(0, 6), [
    'create',
    'connect',
    'tls',
    'BEGIN READ ONLY',
    "SET LOCAL statement_timeout = '3000ms'",
    "SET LOCAL lock_timeout = '1000ms'",
  ]);
  assert.deepEqual(f.calls.slice(-3), [
    'SELECT id FROM ONLY public.signal_generation_runs WHERE false',
    'ROLLBACK',
    'end',
  ]);
  const identityQuery = f.queryCalls.find(({ text }) => text.includes('current_database()'));
  assert.deepEqual(identityQuery.values, ['fixturedb']);
  assert.match(identityQuery.text, /session_user = current_user/);
  assert.ok(f.calls.includes(generationRoleCheckSQL));
  for (const { text } of f.queryCalls)
    assert.match(
      text,
      /^(?:BEGIN READ ONLY|SET LOCAL (?:statement_timeout|lock_timeout)|SELECT|WITH allowed|ROLLBACK)/,
    );
  assert.equal(
    f.calls.some((call) =>
      /^(?:COMMIT|UPDATE|INSERT|DELETE|CREATE|ALTER|GRANT|SET ROLE)/.test(call),
    ),
    false,
  );
});

test('failures are fixed-code redacted and close the client; all begun transactions attempt rollback', async () => {
  for (const [options, error, rollback] of [
    [{ createFails: true }, 'connection_failed', false],
    [{ connectFails: true }, 'connection_failed', false],
    [{ tls: false }, 'tls_unverified', false],
    [{ tlsThrows: true }, 'tls_unverified', false],
    [{ identity: false }, 'identity_mismatch', true],
    [{ readOnly: false }, 'read_only_required', true],
    [{ roleIdentity: false }, 'permissions_invalid', true],
    [{ permissions: false }, 'permissions_invalid', true],
    [{ probeRows: [{ id: 'must-not-escape' }] }, 'permissions_invalid', true],
    [{ queryFails: (sql) => sql === 'BEGIN READ ONLY' }, 'read_only_required', true],
    [{ queryFails: (sql) => sql.startsWith('SET LOCAL') }, 'read_only_required', true],
    [{ queryFails: (sql) => sql === generationRoleCheckSQL }, 'permissions_invalid', true],
    [{ queryFails: (sql) => sql.includes('WHERE false') }, 'permissions_invalid', true],
    [{ queryFails: (sql) => sql === 'ROLLBACK' }, 'cleanup_failed', true],
    [{ endFails: true }, 'cleanup_failed', true],
  ]) {
    const f = fixture(options);
    const result = await f.check();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error, error);
    assert.equal(f.calls.includes('ROLLBACK'), rollback);
    if (!options.createFails) assert.equal(f.calls.at(-1), 'end');
    assert.deepEqual(Object.keys(result).sort(), ['checks', 'error', 'status']);
    assert.ok(Object.values(result.checks).every((value) => typeof value === 'boolean'));
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture|password|postgres|sensitive|must-not-escape|SELECT/,
    );
  }
});

test('an existing diagnosis survives cleanup failure and cleanup always ends the connection', async () => {
  const f = fixture({ identity: false, queryFails: (sql) => sql === 'ROLLBACK', endFails: true });
  assert.equal((await f.check()).error, 'identity_mismatch');
  assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'end']);
});

test('concurrent probes share one fresh connection through cleanup and later probes can rerun', async () => {
  let releaseConnect;
  let releaseEnd;
  const connectWait = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const endWait = new Promise((resolve) => {
    releaseEnd = resolve;
  });
  const f = fixture({ connectWait, endWait });
  const first = f.check();
  assert.equal(f.check(), first);
  releaseConnect();
  while (!f.calls.includes('end'))
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(f.check(), first);
  assert.equal(f.created.length, 1);
  releaseEnd();
  assert.equal((await first).status, 'ok');
  const second = f.check();
  assert.notEqual(second, first);
  assert.equal((await second).status, 'ok');
  assert.equal(f.created.length, 2);
});

test('failed probes also release single-flight and permit a later configuration attempt', async () => {
  const options = { env: { VERCEL_ENV: 'preview' } };
  const f = fixture(options);
  assert.equal((await f.check()).error, 'configuration_invalid');
  options.env.VERCEL_ENV = 'production';
  assert.equal((await f.check()).status, 'ok');
  assert.equal(f.created.length, 1);
});

test('server adapter uses a real verified Node TLS socket and a short-lived client, not the generation pool', async () => {
  const adapter = await readFile(
    new URL('../lib/server/signal-generation-preflight.ts', import.meta.url),
    'utf8',
  );
  assert.match(adapter, /import 'server-only'/);
  assert.match(adapter, /import \{ TLSSocket \} from 'node:tls'/);
  assert.match(adapter, /new pg\.Client\(/);
  assert.match(adapter, /connectionTimeoutMillis: 3500/);
  assert.match(adapter, /query_timeout: 3500/);
  assert.match(adapter, /enableChannelBinding: true/);
  assert.match(adapter, /client\.connection\.stream/);
  assert.match(
    adapter,
    /stream instanceof TLSSocket && stream\.encrypted === true && stream\.authorized === true/,
  );
  assert.doesNotMatch(
    adapter,
    /new pg\.Pool|signal-generation-store|signal-generation-provider|generationDashboard|console\./,
  );
});
import { URL } from 'node:url';
