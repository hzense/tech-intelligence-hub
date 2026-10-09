import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { loadMigrations, migrationLockKeys, verifyMigrationManifest } from '../src/migrate.mjs';
import {
  inspectRuntimeAclBaseline,
  runRuntimeAclBaselineCapture,
  runtimeAclBackupReference,
} from '../src/runtime-acl-baseline.mjs';
import { executeUnifiedSignalApply } from '../../../.github/scripts/unified-signal-apply.mjs';
import { assertUnifiedMaintenanceManifest } from '../../../.github/scripts/unified-signal-maintenance.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Real PostgreSQL clients, catalog capture and the protected apply ACL entry.
// The small schema/preflight and stopped backfill are deliberate test doubles;
// this does not replace the full migration, role or cutover integration suites.
suite('unified apply matches the captured PostgreSQL ACL contract', () => {
  const database = `hzense_unified_acl_${randomUUID().replaceAll('-', '')}`;
  const backupId = `unified-acl-local-fixture-${randomUUID()}`;
  const stopBeforeWrites = new Error('fixture-stops-after-real-acl-check');
  const initialSettings = {
    search_path: 'public',
    statement_timeout: '17s',
    lock_timeout: '19s',
    idle_in_transaction_session_timeout: '21s',
  };
  let admin, fixture, options, migrations;
  let databaseCreated = false;
  let runtimeRoleCreated = false;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const role = (await admin.query('SELECT current_user AS name')).rows[0].name;
    if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='hzense_runtime'")).rowCount) {
      await admin.query('CREATE ROLE hzense_runtime NOLOGIN');
      runtimeRoleCreated = true;
    }
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    options = {
      connectionString: url.toString(),
      profile: 'local-test',
      expectedDatabase: database,
      expectedUser: role,
      expectedPostgresMajor: 18,
    };
    fixture = new pg.Client({ connectionString: options.connectionString });
    await fixture.connect();
    // A public non-built-in argument type reproduces the production pgvector
    // deparser behavior even on local PostgreSQL without that extension.
    await fixture.query(`
      CREATE TYPE public.acl_probe_type AS ENUM ('fixture');
      CREATE FUNCTION public.acl_probe(value public.acl_probe_type)
        RETURNS public.acl_probe_type LANGUAGE sql IMMUTABLE AS 'SELECT value';
      CREATE TABLE public.acl_probe_data(id integer);
      CREATE TABLE public.unified_signal_cutover(
        singleton boolean PRIMARY KEY, ready boolean NOT NULL DEFAULT false, plan_hash text
      );
      INSERT INTO public.unified_signal_cutover(singleton) VALUES(true);
    `);
    const currentMigrations = await loadMigrations();
    await verifyMigrationManifest(currentMigrations);
    // This ACL regression exercises the historical, reviewed 0030 cutover.
    // Verify today's on-disk artifact first, then freeze only that operation's
    // exact snapshot instead of admitting later unrelated migrations.
    migrations = currentMigrations.filter(({ name }) => name < '0031_');
  }, 30_000);

  afterAll(async () => {
    await fixture?.end();
    if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`);
    if (runtimeRoleCreated) await admin.query('DROP ROLE hzense_runtime');
    await admin?.end();
  });

  const capture = () => runRuntimeAclBaselineCapture({ ...options, backupId });

  async function sessionSettings(query) {
    const values = {};
    for (const key of Object.keys(initialSettings))
      values[key] = (await query(`SHOW ${key}`)).rows[0][key];
    return values;
  }

  function execution(baseline, { failCatalog = false } = {}) {
    const queries = [];
    const closedSettings = [];
    const inspected = [];
    const policy = validateConnectionTarget(options);
    const backfill = vi.fn(async (client) => {
      // The ACL transaction must already have rolled back its local settings.
      expect(await sessionSettings(client.query.bind(client))).toEqual(initialSettings);
      throw stopBeforeWrites;
    });
    const deps = {
      options,
      validateConnectionTarget,
      loadMigrations: async () => migrations,
      verifyMigrationManifest: async (reviewed) => {
        expect(reviewed).toEqual(migrations);
      },
      migrationLockKeys,
      verifyDatabaseContract: async () => ({ migrationCount: 31, tableCount: 62 }),
      inspectDatabasePreflight: async (client) => {
        const identity = (
          await client.query(
            'SELECT current_database() AS database, current_user AS user, current_schema() AS schema',
          )
        ).rows[0];
        expect(identity).toEqual({ database, user: options.expectedUser, schema: 'public' });
        return { database, user: options.expectedUser, pendingMigrations: [] };
      },
      runtimeAclBackupReference,
      inspectRuntimeAclBaseline: async (...args) => {
        const result = await inspectRuntimeAclBaseline(...args);
        inspected.push(result);
        return result;
      },
      applyUnifiedSignalBackfill: backfill,
      createClient: (config) => {
        const client = new pg.Client(config);
        const connect = client.connect.bind(client);
        const query = client.query.bind(client);
        const end = client.end.bind(client);
        client.connect = async () => {
          await connect();
          for (const [key, value] of Object.entries(initialSettings))
            await query(`SELECT set_config($1,$2,false)`, [key, value]);
        };
        client.query = async (...args) => {
          queries.push(args[0]);
          if (failCatalog && args[0].includes('runtime-acl-baseline:routines'))
            return query('SELECT 1 / 0');
          return query(...args);
        };
        client.end = async () => {
          try {
            closedSettings.push(await sessionSettings(query));
          } finally {
            await end();
          }
        };
        return client;
      },
    };
    const approval = {
      manifestFingerprint: assertUnifiedMaintenanceManifest(migrations),
      targetFingerprint: hash(
        `hzense/unified-signal-preflight-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, policy.database, policy.user])}`,
      ),
      planFingerprint: 'a'.repeat(64),
      aclFingerprint: baseline.fingerprint,
      backupIdSha256: hash(backupId),
    };
    return {
      queries,
      closedSettings,
      inspected,
      backfill,
      run: () =>
        executeUnifiedSignalApply(
          { MAINTENANCE_BACKUP_ID: backupId },
          { operation: 'unified-signal-apply', approval },
          { checkFreshness: async () => {}, checkApproval: async () => {} },
          deps,
        ),
    };
  }

  function expectNoWritesOrLeakedSettings(run) {
    expect(run.queries.some((sql) => /^(?:INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i.test(sql))).toBe(
      false,
    );
    expect(run.closedSettings).toEqual([initialSettings]);
  }

  it('uses the same canonical function arguments as capture and restores caller settings before backfill', async () => {
    const baseline = await capture();
    const routine = baseline.categories.routines.records.find((row) => row.routine === 'acl_probe');
    expect(routine.identityArguments).toBe('value public.acl_probe_type');
    await fixture.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await fixture.query('SET LOCAL search_path=public');
      const visible = (
        await fixture.query(
          "SELECT pg_get_function_identity_arguments('public.acl_probe(public.acl_probe_type)'::regprocedure) AS arguments",
        )
      ).rows[0].arguments;
      expect(visible).toBe('value acl_probe_type');
      expect(visible).not.toBe(routine.identityArguments);
      // Reproduce the former apply entry (same inspector, missing local path)
      // without editing production code or executing any data write.
      const oldContext = await inspectRuntimeAclBaseline(fixture, {
        ...options,
        backupReference: runtimeAclBackupReference(backupId),
      });
      expect(oldContext.fingerprint).not.toBe(baseline.fingerprint);
      expect(oldContext.categories.routines.fingerprint).not.toBe(
        baseline.categories.routines.fingerprint,
      );
      for (const category of Object.keys(baseline.categories).filter((key) => key !== 'routines'))
        expect(oldContext.categories[category].fingerprint).toBe(
          baseline.categories[category].fingerprint,
        );
    } finally {
      await fixture.query('ROLLBACK');
    }
    const run = execution(baseline);
    await expect(run.run()).rejects.toMatchObject({
      cause: stopBeforeWrites,
      mayHaveCommitted: false,
    });
    expect(run.backfill).toHaveBeenCalledOnce();
    expect(run.inspected[0].fingerprint).toBe(baseline.fingerprint);
    expectNoWritesOrLeakedSettings(run);
  });

  it('rejects an actual ACL change before any backfill or GRANT and rolls back local settings', async () => {
    const baseline = await capture();
    await fixture.query('GRANT SELECT(id) ON public.acl_probe_data TO hzense_runtime');
    try {
      const run = execution(baseline);
      await expect(run.run()).rejects.toMatchObject({
        cause: { message: 'unified-signal-acl-drift' },
        mayHaveCommitted: false,
      });
      expect(run.backfill).not.toHaveBeenCalled();
      expect(run.inspected[0].categories.columns.fingerprint).not.toBe(
        baseline.categories.columns.fingerprint,
      );
      expect(run.inspected[0].categories.routines.fingerprint).toBe(
        baseline.categories.routines.fingerprint,
      );
      expectNoWritesOrLeakedSettings(run);
    } finally {
      await fixture.query('REVOKE SELECT(id) ON public.acl_probe_data FROM hzense_runtime');
    }
  });

  it('cleans up the read-only transaction after a real PostgreSQL catalog-query error', async () => {
    const run = execution(await capture(), { failCatalog: true });
    await expect(run.run()).rejects.toMatchObject({
      cause: { code: '22012' },
      mayHaveCommitted: false,
    });
    expect(run.backfill).not.toHaveBeenCalled();
    expectNoWritesOrLeakedSettings(run);
  });
});
