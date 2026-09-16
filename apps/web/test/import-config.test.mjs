import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { diagnoseImportConfiguration, importConfigurationMessages } from '../lib/import-config.ts';

function configuration() {
  return {
    VERCEL_ENV: 'production',
    HZENSE_IMPORT_ENABLED: '0',
    HZENSE_IMPORT_DATABASE_URL:
      'postgresql://hzense_import_admin:synthetic-secret@ep-test-pooler.neon.tech:5432/hzense?sslmode=verify-full&channel_binding=prefer',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-test-pooler.neon.tech',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
    HZENSE_IMPORT_BLOB_STORE_ID: 'synthetic',
    HZENSE_IMPORT_BLOB_TOKEN: 'vercel_blob_rw_synthetic_testsecret',
    HZENSE_IMPORT_PARSER_SNAPSHOT_ID: 'snap_synthetic',
    HZENSE_IMPORT_RETENTION_DAYS: '7',
    HZENSE_IMPORT_RESERVE_MICROUSD: '100000',
    HZENSE_IMPORT_DAILY_LIMIT_MICROUSD: '50000000',
    HZENSE_IMPORT_BATCH_LIMIT_MICROUSD: '10000000',
  };
}
test('closed gate diagnoses valid config without enabling it or mutating environment', () => {
  const env = Object.freeze(configuration());
  assert.deepEqual(diagnoseImportConfiguration(env), {
    enabled: false,
    valid: true,
    ready: false,
    issues: [],
  });
  assert.equal(diagnoseImportConfiguration({ ...env, HZENSE_IMPORT_ENABLED: '1' }).ready, true);
});
test('missing channel binding is diagnosed and never silently repaired', () => {
  const env = configuration();
  env.HZENSE_IMPORT_DATABASE_URL = env.HZENSE_IMPORT_DATABASE_URL.replace(
    '&channel_binding=prefer',
    '',
  );
  for (const enabled of ['0', '1']) {
    const result = diagnoseImportConfiguration({ ...env, HZENSE_IMPORT_ENABLED: enabled });
    assert.deepEqual(result.issues, ['database_tls']);
    assert.equal(result.ready, false);
  }
});
test('each dependency fails closed with static diagnostics only', () => {
  const cases = [
    ['VERCEL_ENV', 'preview', 'environment'],
    ['HZENSE_IMPORT_ENABLED', 'true', 'enabled'],
    ['HZENSE_IMPORT_DATABASE_URL', 'not-a-url-secret', 'database_url'],
    ['HZENSE_RUNTIME_EXPECTED_HOST', 'wrong-pooler.neon.tech', 'database_host_mismatch'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0', 'database_tls'],
    ['HZENSE_IMPORT_BLOB_TOKEN', 'secret-token-from-another-store', 'blob_binding'],
    ['HZENSE_IMPORT_PARSER_SNAPSHOT_ID', '', 'parser_snapshot'],
    ['HZENSE_IMPORT_RETENTION_DAYS', '8', 'retention'],
    ['HZENSE_IMPORT_RESERVE_MICROUSD', 'NaN', 'reserve'],
    ['HZENSE_IMPORT_DAILY_LIMIT_MICROUSD', '0', 'daily'],
    ['HZENSE_IMPORT_BATCH_LIMIT_MICROUSD', '9007199254740992', 'batch'],
  ];
  for (const [key, value, code] of cases) {
    const result = diagnoseImportConfiguration({
      ...configuration(),
      HZENSE_IMPORT_ENABLED: '1',
      [key]: value,
    });
    assert.equal(result.ready, false, key);
    assert.ok(result.issues.includes(code), key);
    assert.ok(result.issues.every((issue) => Object.hasOwn(importConfigurationMessages, issue)));
    assert.doesNotMatch(
      JSON.stringify(result),
      /secret|postgresql:|ep-test|snap_synthetic|vercel_blob_rw/,
    );
  }
});
test('role, duplicate parameters and non-verify TLS remain rejected', () => {
  const env = configuration();
  for (const [url, code] of [
    [
      env.HZENSE_IMPORT_DATABASE_URL.replace('hzense_import_admin', 'hzense_migrator'),
      'database_role',
    ],
    [env.HZENSE_IMPORT_DATABASE_URL + '&sslmode=verify-full', 'database_parameters'],
    [env.HZENSE_IMPORT_DATABASE_URL.replace('verify-full', 'require'), 'database_tls'],
    [env.HZENSE_IMPORT_DATABASE_URL + '#secret', 'database_parameters'],
    [env.HZENSE_IMPORT_DATABASE_URL + '\n', 'database_url'],
  ]) {
    const result = diagnoseImportConfiguration({ ...env, HZENSE_IMPORT_DATABASE_URL: url });
    assert.ok(result.issues.includes(code));
    assert.equal(result.valid, false);
  }
});
test('target diagnostics identify each mismatch without exposing either side', () => {
  const env = configuration();
  const cases = [
    [env.HZENSE_IMPORT_DATABASE_URL.replace(':5432', ''), ['database_port_missing']],
    [env.HZENSE_IMPORT_DATABASE_URL.replace(':5432', ':5433'), ['database_port_mismatch']],
    [
      env.HZENSE_IMPORT_DATABASE_URL.replace('/hzense?', '/private-db?'),
      ['database_name_mismatch'],
    ],
    [
      env.HZENSE_IMPORT_DATABASE_URL.replace('ep-test-pooler', 'ep-other-pooler'),
      ['database_host_mismatch'],
    ],
    [
      env.HZENSE_IMPORT_DATABASE_URL.replace('ep-test-pooler', 'ep-test'),
      ['database_pooled_endpoint', 'database_host_mismatch'],
    ],
    [
      env.HZENSE_IMPORT_DATABASE_URL.replace(':5432/hzense', '/private-db'),
      ['database_port_missing', 'database_name_mismatch'],
    ],
  ];
  for (const [url, expected] of cases) {
    for (const gate of ['0', '1']) {
      const result = diagnoseImportConfiguration({
        ...env,
        HZENSE_IMPORT_ENABLED: gate,
        HZENSE_IMPORT_DATABASE_URL: url,
      });
      assert.deepEqual(result.issues, expected);
      assert.equal(result.valid, false);
      assert.equal(result.ready, false);
      const displayed =
        JSON.stringify(result) +
        result.issues.map((code) => importConfigurationMessages[code]).join('');
      assert.doesNotMatch(
        displayed,
        /synthetic-secret|ep-test|ep-other|private-db|5432|5433|postgresql:\/\//,
      );
    }
  }
});
test('target diagnostics retain host case and database percent decoding semantics', () => {
  const env = configuration();
  const result = diagnoseImportConfiguration({
    ...env,
    HZENSE_RUNTIME_EXPECTED_HOST: env.HZENSE_RUNTIME_EXPECTED_HOST.toUpperCase(),
    HZENSE_IMPORT_DATABASE_URL: env.HZENSE_IMPORT_DATABASE_URL.replace('/hzense?', '/%68zense?'),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
  const nonNeon = env.HZENSE_IMPORT_DATABASE_URL.replace(
    'ep-test-pooler.neon.tech',
    'private-pooler.example',
  );
  assert.deepEqual(
    diagnoseImportConfiguration({
      ...env,
      HZENSE_IMPORT_DATABASE_URL: nonNeon,
      HZENSE_RUNTIME_EXPECTED_HOST: 'private-pooler.example',
    }).issues,
    ['database_pooled_endpoint'],
  );
});
test('page authenticates before diagnostics and operational path uses the same gate', () => {
  const page = readFileSync(
    new URL('../app/admin/(protected)/imports/page.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(page.indexOf('await requireAdminSession()') < page.indexOf('const diagnostics ='));
  assert.match(page, /dynamic = 'force-dynamic'/);
  assert.match(page, /configured=\{diagnostics.ready\}/);
  const service = readFileSync(new URL('../lib/server/import-service.ts', import.meta.url), 'utf8');
  assert.match(service, /import 'server-only'/);
  assert.match(
    service,
    /if \(!importConfigurationDiagnostics\(\).ready\) throw new ImportIOError\('not_configured'\)/,
  );
});
