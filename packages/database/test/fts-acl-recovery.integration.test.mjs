import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runtimeReaderSearchColumns } from '../src/runtime-reader-preflight.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const sql = await readFile(
  resolve(process.cwd(), '../../db/roles/restore_fts_reader_acl.sql'),
  'utf8',
);
const captureSql = await readFile(
  resolve(process.cwd(), '../../db/roles/fts_acl_recovery_state.sql'),
  'utf8',
);
const stateQuery = captureSql
  .split('-- BEGIN SHARED ACL STATE QUERY')[1]
  .split('-- END SHARED ACL STATE QUERY')[0];

// Vanilla CI PostgreSQL has no Neon postmaster settings. Test the UNMODIFIED
// script's fail-closed target guard separately. Only the mutation-core tests
// replace this single guard; they are NOT proof of a Neon rehearsal or approval.
// There is deliberately no bypass flag or alternative entrypoint in shipped SQL.
const coreSql = sql.replace(
  /-- BEGIN NEON TARGET GUARD[\s\S]*?-- END NEON TARGET GUARD/,
  '-- CI fixture only: Neon server identity is unavailable on vanilla PostgreSQL.',
);
const target = 'ab'.repeat(32);
const production = 'cd'.repeat(32);
const source = 'ef'.repeat(32);
const password = randomUUID();
const searchColumns = [
  ...runtimeReaderSearchColumns,
  'id',
  'importance',
  'topics',
  'entities',
  'embedding',
  'search_vector',
];
const grantSearch =
  'GRANT SELECT (' +
  runtimeReaderSearchColumns.join(', ') +
  ') ON public.search_documents TO hzense_runtime';

function connection(role) {
  const url = new URL(adminUrl);
  url.pathname = '/hzense';
  url.username = role;
  url.password = password;
  return new pg.Client({ connectionString: url.toString() });
}

suite('FTS ACL recovery PostgreSQL core integration (not Neon target acceptance)', () => {
  let admin;
  let owner;
  let runtime;
  let databaseCreated = false;
  const createdRoles = [];
  let beforeFingerprint;
  let afterFingerprint;

  async function fingerprint() {
    return (await owner.query(stateQuery)).rows[0].fingerprint;
  }

  async function declarations(overrides = {}) {
    const values = {
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint,
      target_fingerprint: target,
      production_fingerprint: production,
      source_fingerprint: source,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) {
      await owner.query('SELECT set_config($1, $2, false)', ['hzense.acl_recovery.' + key, value]);
    }
  }

  async function failCore(pattern, overrides) {
    await declarations(overrides);
    await expect(owner.query(coreSql)).rejects.toThrow(pattern);
    await owner.query('ROLLBACK');
  }

  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1') {
      throw new Error('ACL recovery integration requires the disposable CI cluster');
    }
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    // Fixed production names are used ONLY in an empty disposable cluster so
    // the SQL ownership guards are exercised without modifying those guards.
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = 'hzense' UNION ALL " +
        "SELECT 1 FROM pg_roles WHERE rolname IN ('hzense_migrator', 'hzense_runtime')",
    );
    if (existing.rowCount) throw new Error('Refusing to replace existing recovery fixture objects');
    for (const role of ['hzense_migrator', 'hzense_runtime']) {
      await admin.query(
        'CREATE ROLE ' + role + " LOGIN NOINHERIT CONNECTION LIMIT 20 PASSWORD '" + password + "'",
      );
      createdRoles.push(role);
    }
    await admin.query('CREATE DATABASE hzense OWNER hzense_migrator');
    databaseCreated = true;
    owner = connection('hzense_migrator');
    await owner.connect();
    await owner.query("SET timezone = 'UTC'");
    // Minimal same-schema fixture; full migration/configurator remain covered
    // by the existing migration and runtime-reader suites, not this fixture.
    await owner.query(
      'CREATE TABLE public.search_documents (' +
        searchColumns.map((name) => name + ' text').join(', ') +
        ');' +
        'CREATE TABLE public.topics (id text, title text, parent_id text, status text, runtime_enabled text, metadata text);' +
        'CREATE TABLE public.hzense_schema_migrations (name text PRIMARY KEY);' +
        "INSERT INTO public.hzense_schema_migrations VALUES ('0003_search_documents_fts.sql');" +
        'GRANT USAGE ON SCHEMA public TO hzense_runtime;' +
        'GRANT SELECT (id, title, parent_id, status, runtime_enabled) ON public.topics TO hzense_runtime;',
    );
    runtime = connection('hzense_runtime');
    await runtime.connect();
  });

  beforeEach(async () => {
    await owner.query('ROLLBACK');
    await owner.query(
      'REVOKE ALL ON public.search_documents FROM hzense_runtime, PUBLIC;' +
        'GRANT SELECT (id, title, parent_id, status, runtime_enabled) ON public.topics TO hzense_runtime;',
    );
    afterFingerprint = await fingerprint();
    await owner.query(grantSearch);
    beforeFingerprint = await fingerprint();
    expect(beforeFingerprint).not.toBe(afterFingerprint);
  });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    try {
      if (databaseCreated) await admin.query('DROP DATABASE hzense');
      for (const role of createdRoles.toReversed()) await admin.query('DROP ROLE ' + role);
    } finally {
      if (admin) await admin.end();
    }
  });

  it('rejects the original script on vanilla PostgreSQL, even with spoofed custom Neon settings', async () => {
    await declarations();
    for (const key of ['project_id', 'branch_id', 'timeline_id'])
      await owner.query('SELECT set_config($1, $2, false)', ['neon.' + key, 'test-only']);
    await expect(owner.query(sql)).rejects.toThrow('exact reviewed Neon branch and timeline');
    await owner.query('ROLLBACK');
    expect(await fingerprint()).toBe(beforeFingerprint);
  });

  it('restores exact R1 catalog state and preserves Topic reads with a real Runtime login', async () => {
    await declarations();
    await owner.query(coreSql);
    expect(await fingerprint()).toBe(afterFingerprint);
    await runtime.query(
      'SELECT id, title, parent_id, status, runtime_enabled FROM public.topics LIMIT 0',
    );
    await expect(
      runtime.query('SELECT title FROM public.search_documents LIMIT 0'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query('SELECT metadata FROM public.topics LIMIT 0')).rejects.toMatchObject(
      { code: '42501' },
    );
  });

  it('reproduces the unparenthesized CASE syntax regression without changing ACLs', async () => {
    await declarations();
    const invalidSql = coreSql.replace(
      '(CASE WHEN pass = 1 THEN before_fingerprint ELSE after_fingerprint END)',
      'CASE WHEN pass = 1 THEN before_fingerprint ELSE after_fingerprint END',
    );
    expect(invalidSql).not.toBe(coreSql);
    await expect(owner.query(invalidSql)).rejects.toMatchObject({ code: '42601' });
    await owner.query('ROLLBACK');
    expect(await fingerprint()).toBe(beforeFingerprint);
  });

  it('rolls back a completed REVOKE when the after-state fingerprint is wrong', async () => {
    await failCore('catalog fingerprint mismatch at pass 2', {
      after_fingerprint: '12'.repeat(32),
    });
    expect(await fingerprint()).toBe(beforeFingerprint);
    await runtime.query('SELECT title FROM public.search_documents LIMIT 0');
  });

  it('preserves another role column grant exactly', async () => {
    await owner.query('REVOKE SELECT (body) ON public.search_documents FROM hzense_runtime');
    await owner.query('GRANT SELECT (body) ON public.search_documents TO pg_monitor');
    try {
      await owner.query('REVOKE ALL ON public.search_documents FROM hzense_runtime');
      afterFingerprint = await fingerprint();
      await owner.query(grantSearch);
      beforeFingerprint = await fingerprint();
      await declarations();
      await owner.query(coreSql);
      expect(await fingerprint()).toBe(afterFingerprint);
      expect(
        (
          await owner.query(
            "SELECT has_column_privilege('pg_monitor', 'public.search_documents', 'body', 'SELECT') AS allowed",
          )
        ).rows[0].allowed,
      ).toBe(true);
    } finally {
      await owner.query('ROLLBACK');
      await owner.query('REVOKE SELECT (body) ON public.search_documents FROM pg_monitor');
    }
  });

  it('detects unrelated default ACL drift without normalizing it away', async () => {
    await owner.query('ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO pg_monitor');
    try {
      const drift = await fingerprint();
      expect(drift).not.toBe(beforeFingerprint);
      await failCore('catalog fingerprint mismatch at pass 1');
      expect(await fingerprint()).toBe(drift);
    } finally {
      await owner.query('ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM pg_monitor');
    }
  });

  it('rejects a non-owner authenticated connection before any table mutation', async () => {
    await declarations();
    for (const key of [
      'before_fingerprint',
      'after_fingerprint',
      'target_fingerprint',
      'production_fingerprint',
      'source_fingerprint',
      'expires_at',
    ]) {
      const result = await owner.query('SELECT current_setting($1) AS value', [
        'hzense.acl_recovery.' + key,
      ]);
      await runtime.query('SELECT set_config($1, $2, false)', [
        'hzense.acl_recovery.' + key,
        result.rows[0].value,
      ]);
    }
    await expect(runtime.query(coreSql)).rejects.toThrow(
      'authenticated owner or transaction mismatch',
    );
    await runtime.query('ROLLBACK');
    expect(await fingerprint()).toBe(beforeFingerprint);
  });

  it('refuses stale before-state evidence without revoking permissions', async () => {
    await failCore('catalog fingerprint mismatch at pass 1', {
      before_fingerprint: '12'.repeat(32),
    });
    expect(await fingerprint()).toBe(beforeFingerprint);
  });

  it('refuses table-level PUBLIC access that a column REVOKE cannot neutralize', async () => {
    await owner.query('GRANT SELECT ON public.search_documents TO PUBLIC');
    const drift = await fingerprint();
    await failCore('effective Search table privileges', { before_fingerprint: drift });
    expect(await fingerprint()).toBe(drift);
  });

  it('refuses unexpected columns and grant options even if the input fingerprint matches', async () => {
    await owner.query('GRANT SELECT (embedding) ON public.search_documents TO hzense_runtime');
    await failCore('Search effective column contract mismatch', {
      before_fingerprint: await fingerprint(),
    });
    await owner.query('REVOKE SELECT (embedding) ON public.search_documents FROM hzense_runtime');
    await owner.query(
      'GRANT SELECT (title) ON public.search_documents TO hzense_runtime WITH GRANT OPTION',
    );
    await failCore('Search effective column contract mismatch', {
      before_fingerprint: await fingerprint(),
    });
  });

  it('refuses Topic contract damage', async () => {
    await owner.query('REVOKE SELECT (title) ON public.topics FROM hzense_runtime');
    await failCore('five-column Topic contract', { before_fingerprint: await fingerprint() });
  });

  it('refuses unsafe membership before mutation', async () => {
    await admin.query('GRANT hzense_migrator TO hzense_runtime WITH INHERIT FALSE, SET TRUE');
    try {
      await failCore('indirect Runtime role access', { before_fingerprint: await fingerprint() });
    } finally {
      await admin.query('REVOKE hzense_migrator FROM hzense_runtime');
    }
  });

  it('refuses expired, placeholder and production/source target declarations', async () => {
    await failCore('fresh bounded approval window', { expires_at: '2000-01-01T00:00:00Z' });
    await failCore('five reviewed SHA-256 declarations', { target_fingerprint: '0'.repeat(64) });
    await failCore('distinct states and isolated target bindings', {
      target_fingerprint: production,
    });
    await failCore('distinct states and isolated target bindings', { target_fingerprint: source });
    expect(await fingerprint()).toBe(beforeFingerprint);
  });

  it('refuses an occupied maintenance lock', async () => {
    // Advisory locks are database-local: hold it through a second hzense login.
    const blocker = connection('hzense_migrator');
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(1215921955, 1298498925)');
      await failCore('Another HZense maintenance operation is active');
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});
