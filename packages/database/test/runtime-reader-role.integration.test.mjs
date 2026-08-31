import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { inspectRuntimeReaderPreflight } from '../src/runtime-reader-preflight.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integrationSuite = adminUrl ? describe.sequential : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_runtime_contract_${suffix}`;
const ownerRole = `hzense_runtime_owner_${suffix}`;
const runtimeRole = 'hzense_runtime';
const ownerPassword = `owner-${suffix}`;
const runtimePassword = `runtime-${suffix}`;
const sentinelDatabaseName = `hzense_runtime_sentinel_${suffix}`;
const roleSqlPath = resolve(process.cwd(), '../../db/roles/configure_runtime_reader.sql');

function quotedIdentifier(value) {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(role, password) {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function adminDatabaseUrl() {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withClient(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function readProvisioningState() {
  return withClient(adminDatabaseUrl(), async (client) => {
    const privileges = await client.query(
      `SELECT database_info.datacl::text AS database_acl,
              namespace_info.nspacl::text AS public_schema_acl,
              topics_info.relacl::text AS topics_acl,
              type_info.typacl::text AS topic_status_acl,
              (SELECT jsonb_object_agg(
                 column_info.attname,
                 COALESCE(column_info.attacl::text, '')
                 ORDER BY column_info.attname
               )
               FROM pg_attribute AS column_info
               WHERE column_info.attrelid = topics_info.oid
                 AND column_info.attnum > 0
                 AND NOT column_info.attisdropped) AS topic_column_acls
       FROM pg_database AS database_info
       CROSS JOIN pg_namespace AS namespace_info
       CROSS JOIN pg_class AS topics_info
       CROSS JOIN pg_type AS type_info
       WHERE database_info.datname = $1
         AND namespace_info.nspname = 'public'
         AND topics_info.oid = 'public.topics'::regclass
         AND type_info.oid = 'public.topic_status'::regtype`,
      [databaseName],
    );
    const defaults = await client.query(
      `SELECT default_acl.defaclnamespace,
              default_acl.defaclobjtype,
              default_acl.defaclacl::text AS acl
       FROM pg_default_acl AS default_acl
       JOIN pg_roles AS owner_info ON owner_info.oid = default_acl.defaclrole
       WHERE owner_info.rolname = $1
       ORDER BY default_acl.defaclnamespace, default_acl.defaclobjtype`,
      [ownerRole],
    );
    return { privileges: privileges.rows, defaults: defaults.rows };
  });
}

function strictRuntimePreflight(client) {
  return inspectRuntimeReaderPreflight(client, {
    expectedDatabase: databaseName,
    expectedUser: runtimeRole,
    expectedPostgresMajor: 18,
    expectedConnectionLimit: 20,
    profile: 'local-test',
  });
}

integrationSuite('PostgreSQL Runtime reader role provisioning integration', () => {
  let adminClient;
  let adminRole;
  let databaseCreated = false;
  let ownerRoleCreated = false;
  let runtimeRoleCreated = false;
  let otherDatabasesIsolated = false;
  let originalPublicDatabasePrivileges = [];
  let roleSql;

  async function isolateOtherDatabases() {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1') {
      throw new Error(
        'Runtime reader integration requires RUNTIME_READER_TEST_ISOLATED_CLUSTER=1 and a disposable PostgreSQL cluster',
      );
    }
    const publicPrivileges = await adminClient.query(
      `SELECT database_info.datname AS database_name,
              acl_info.privilege_type
       FROM pg_database AS database_info
       CROSS JOIN LATERAL aclexplode(
         COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
       ) AS acl_info
       WHERE database_info.datname <> $1
         AND database_info.datallowconn
         AND acl_info.grantee = 0
       ORDER BY database_info.datname, acl_info.privilege_type`,
      [databaseName],
    );
    originalPublicDatabasePrivileges = publicPrivileges.rows;
    const databaseNames = [...new Set(publicPrivileges.rows.map((row) => row.database_name))];
    otherDatabasesIsolated = true;
    try {
      for (const otherDatabaseName of databaseNames) {
        await adminClient.query(
          `REVOKE CONNECT, CREATE, TEMPORARY
           ON DATABASE ${quotedIdentifier(otherDatabaseName)} FROM PUBLIC`,
        );
      }
    } catch (error) {
      await restoreOtherDatabasePrivileges();
      throw error;
    }
  }

  async function restoreOtherDatabasePrivileges() {
    if (!otherDatabasesIsolated) return;
    const databaseNames = [
      ...new Set(originalPublicDatabasePrivileges.map((row) => row.database_name)),
    ];
    for (const otherDatabaseName of databaseNames) {
      await adminClient.query(
        `REVOKE CONNECT, CREATE, TEMPORARY
         ON DATABASE ${quotedIdentifier(otherDatabaseName)} FROM PUBLIC`,
      );
      for (const privilege of originalPublicDatabasePrivileges
        .filter((row) => row.database_name === otherDatabaseName)
        .map((row) => row.privilege_type)) {
        if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(privilege)) {
          throw new Error(`Unexpected database privilege in integration fixture: ${privilege}`);
        }
        await adminClient.query(
          `GRANT ${privilege} ON DATABASE ${quotedIdentifier(otherDatabaseName)} TO PUBLIC`,
        );
      }
    }
    otherDatabasesIsolated = false;
  }

  beforeAll(async () => {
    adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    adminRole = (await adminClient.query('SELECT current_user AS name')).rows[0]?.name;
    quotedIdentifier(adminRole);
    const preexistingRuntimeRole = await adminClient.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [runtimeRole],
    );
    if (preexistingRuntimeRole.rowCount !== 0) {
      throw new Error(
        'Integration admin cluster already contains hzense_runtime; refusing to alter or delete it',
      );
    }

    roleSql = await readFile(roleSqlPath, 'utf8');
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(ownerRole)}
       LOGIN NOINHERIT PASSWORD '${ownerPassword}'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    ownerRoleCreated = true;
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(runtimeRole)}
       LOGIN NOINHERIT PASSWORD '${runtimePassword}' CONNECTION LIMIT 20
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    runtimeRoleCreated = true;

    // PostgreSQL 18 may grant the creating role ADMIN membership automatically.
    // Production removes the same provider-created edge before ACL configuration.
    await adminClient.query(
      `REVOKE ${quotedIdentifier(runtimeRole)} FROM ${quotedIdentifier(adminRole)}`,
    );
    await adminClient.query(
      `ALTER ROLE ${quotedIdentifier(runtimeRole)} SET default_transaction_read_only = on`,
    );
    await adminClient.query(
      `CREATE DATABASE ${quotedIdentifier(databaseName)} OWNER ${quotedIdentifier(ownerRole)}`,
    );
    databaseCreated = true;

    await withClient(adminDatabaseUrl(), (client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: databaseUrl(ownerRole, ownerPassword) });
    await withClient(databaseUrl(ownerRole, ownerPassword), async (client) => {
      await client.query(
        `INSERT INTO public.topics
           (id, title, parent_id, status, metadata, runtime_enabled)
         VALUES
           ('runtime-reader-test', 'Runtime Reader Test', NULL, 'active', '{"secret":true}', true)`,
      );
      await client.query('CREATE SEQUENCE public.runtime_forbidden_sequence');
      await client.query(
        `CREATE FUNCTION public.runtime_forbidden_function()
         RETURNS text
         LANGUAGE sql
         SECURITY INVOKER
         AS 'SELECT ''forbidden''::text'`,
      );
      await client.query(
        `CREATE FUNCTION public.runtime_forbidden_definer()
         RETURNS text
         LANGUAGE sql
         SECURITY DEFINER
         AS 'SELECT ''forbidden''::text'`,
      );
      await client.query('CREATE SCHEMA runtime_private');
      await client.query(
        `CREATE FUNCTION runtime_private.runtime_operator_leak(text, text)
         RETURNS boolean
         LANGUAGE sql
         SECURITY DEFINER
         AS 'SELECT EXISTS (
           SELECT 1 FROM public.topics
           WHERE id = $1 AND metadata::text = $2
         )'`,
      );
      await client.query(
        `CREATE OPERATOR public.=== (
           LEFTARG = text,
           RIGHTARG = text,
           FUNCTION = runtime_private.runtime_operator_leak
         )`,
      );
    });
  }, 30_000);

  afterAll(async () => {
    if (!adminClient) return;
    if (databaseCreated) {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await adminClient.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
    }
    if (runtimeRoleCreated) {
      await adminClient.query(`DROP ROLE ${quotedIdentifier(runtimeRole)}`);
    }
    if (ownerRoleCreated) {
      await adminClient.query(`DROP ROLE ${quotedIdentifier(ownerRole)}`);
    }
    await restoreOtherDatabasePrivileges();
    await adminClient.end();
  }, 30_000);

  it('fails closed until a cluster administrator isolates every other database', async () => {
    const before = await readProvisioningState();
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(
        /remove unsafe hzense_runtime privileges from every other connectable database/,
      );
      await expect(readProvisioningState()).resolves.toEqual(before);
    } finally {
      await isolateOtherDatabases();
    }
  }, 30_000);

  it('fails closed for a non-owner and a missing provider read-only setting', async () => {
    const beforeNonOwner = await readProvisioningState();
    await expect(withClient(adminDatabaseUrl(), (client) => client.query(roleSql))).rejects.toThrow(
      /Run as owner of current_database/,
    );
    await expect(readProvisioningState()).resolves.toEqual(beforeNonOwner);

    await adminClient.query(
      `ALTER ROLE ${quotedIdentifier(runtimeRole)} RESET default_transaction_read_only`,
    );
    const beforeMissingSetting = await readProvisioningState();
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(/must set default_transaction_read_only=on/);
      await expect(readProvisioningState()).resolves.toEqual(beforeMissingSetting);
    } finally {
      await adminClient.query(
        `ALTER ROLE ${quotedIdentifier(runtimeRole)} SET default_transaction_read_only = on`,
      );
    }

    await adminClient.query(
      `ALTER ROLE ${quotedIdentifier(runtimeRole)} IN DATABASE ${quotedIdentifier(databaseName)}
       SET default_transaction_read_only = off`,
    );
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(/must set default_transaction_read_only=on/);
    } finally {
      await adminClient.query(
        `ALTER ROLE ${quotedIdentifier(runtimeRole)} IN DATABASE ${quotedIdentifier(databaseName)}
         RESET default_transaction_read_only`,
      );
    }

    await withClient(databaseUrl(ownerRole, ownerPassword), async (client) => {
      await client.query('CREATE SCHEMA runtime_guard_inheritance');
      await client.query(
        'CREATE TABLE runtime_guard_inheritance.inherited_topics () INHERITS (public.topics)',
      );
    });
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(/forbids PostgreSQL table inheritance/);
    } finally {
      await withClient(databaseUrl(ownerRole, ownerPassword), (client) =>
        client.query('DROP SCHEMA runtime_guard_inheritance CASCADE'),
      );
    }
  }, 30_000);

  it('fails closed while the PostgreSQL 18 creator membership edge exists', async () => {
    const before = await readProvisioningState();
    await adminClient.query(
      `GRANT ${quotedIdentifier(runtimeRole)} TO ${quotedIdentifier(adminRole)} WITH ADMIN OPTION`,
    );
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(/unsafe incoming or outgoing role membership/);
      await expect(readProvisioningState()).resolves.toEqual(before);
    } finally {
      await adminClient.query(
        `REVOKE ${quotedIdentifier(runtimeRole)} FROM ${quotedIdentifier(adminRole)}`,
      );
    }
  }, 30_000);

  it('provisions the exact five-column projection and allows safe extension invokers', async () => {
    await withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql));

    await expect(
      withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
    ).resolves.toMatchObject({
      database: databaseName,
      user: runtimeRole,
      postgresMajor: 18,
      connectionLimit: 20,
      defaultTransactionReadOnly: true,
      topicColumns: ['id', 'title', 'parent_id', 'status', 'runtime_enabled'],
    });

    await withClient(databaseUrl(runtimeRole, runtimePassword), async (client) => {
      const settings = await client.query(
        `SELECT current_setting('default_transaction_read_only') AS default_mode,
                current_setting('transaction_read_only') AS transaction_mode`,
      );
      expect(settings.rows[0]).toEqual({ default_mode: 'on', transaction_mode: 'on' });
      await expect(
        client.query(
          `SELECT id, title, parent_id, status::text, runtime_enabled
           FROM public.topics
           WHERE id = 'runtime-reader-test'`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      const allowedExtensionRoutines = await client.query(
        `SELECT count(*)::integer AS count
         FROM pg_proc AS routine_info
         JOIN pg_depend AS extension_dependency
           ON extension_dependency.classid = 'pg_proc'::regclass
          AND extension_dependency.objid = routine_info.oid
          AND extension_dependency.deptype = 'e'
         JOIN pg_extension AS extension_info ON extension_info.oid = extension_dependency.refobjid
         WHERE extension_info.extname = 'vector'
           AND NOT routine_info.prosecdef
           AND has_function_privilege(current_user, routine_info.oid, 'EXECUTE')`,
      );
      expect(allowedExtensionRoutines.rows[0]?.count).toBeGreaterThan(0);

      const accessibleEnums = await client.query(
        `SELECT type_info.typname AS name
         FROM pg_type AS type_info
         JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
         WHERE namespace_info.nspname = 'public'
           AND type_info.typtype = 'e'
           AND has_type_privilege(current_user, type_info.oid, 'USAGE')
         ORDER BY type_info.typname`,
      );
      expect(accessibleEnums.rows).toEqual([{ name: 'topic_status' }]);
    });
  }, 30_000);

  it('denies metadata, migration history, other tables, writes, DDL, TEMP, sequences and routines', async () => {
    await withClient(databaseUrl(runtimeRole, runtimePassword), async (client) => {
      // Prove HZense application ACLs remain authoritative even if the user-level default is overridden.
      await client.query('SET default_transaction_read_only = off');
      await client.query('SET transaction_read_only = off');

      for (const statement of [
        'SELECT metadata FROM public.topics',
        'SELECT * FROM public.topics',
        'SELECT name FROM public.hzense_schema_migrations',
        'SELECT id FROM public.sources',
        `INSERT INTO public.topics
           (id, title, parent_id, status, metadata, runtime_enabled)
         VALUES ('forbidden', 'Forbidden', NULL, 'watching', '{}', false)`,
        "UPDATE public.topics SET title = 'Forbidden' WHERE id = 'runtime-reader-test'",
        "DELETE FROM public.topics WHERE id = 'runtime-reader-test'",
        'CREATE TABLE public.runtime_forbidden_table (id text)',
        'CREATE TEMP TABLE runtime_forbidden_temp (id text)',
        "SELECT nextval('public.runtime_forbidden_sequence')",
        'SELECT public.runtime_forbidden_function()',
        'SELECT public.runtime_forbidden_definer()',
        `SELECT 'runtime-reader-test' OPERATOR(public.===) '{"secret": true}'::text`,
      ]) {
        await expect(client.query(statement)).rejects.toThrow(/permission denied/);
      }
    });
  }, 30_000);

  it('detects new cross-database access in both configuration and runtime preflight', async () => {
    await adminClient.query(
      `CREATE DATABASE ${quotedIdentifier(sentinelDatabaseName)} OWNER ${quotedIdentifier(ownerRole)}`,
    );
    const before = await readProvisioningState();
    try {
      await expect(
        withClient(databaseUrl(ownerRole, ownerPassword), (client) => client.query(roleSql)),
      ).rejects.toThrow(
        /remove unsafe hzense_runtime privileges from every other connectable database/,
      );
      await expect(readProvisioningState()).resolves.toEqual(before);
      await expect(
        withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
      ).rejects.toThrow(
        new RegExp(`privileges on other connectable databases: ${sentinelDatabaseName}`),
      );
    } finally {
      await adminClient.query(`DROP DATABASE ${quotedIdentifier(sentinelDatabaseName)}`);
    }
  }, 30_000);

  it('detects ACL drift, then reruns idempotently and protects future objects', async () => {
    const ownerUrl = databaseUrl(ownerRole, ownerPassword);
    await withClient(ownerUrl, (client) =>
      client.query('GRANT SELECT (metadata) ON public.topics TO hzense_runtime'),
    );
    try {
      await expect(
        withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
      ).rejects.toThrow(/topics\.metadata:SELECT/);
    } finally {
      await withClient(ownerUrl, (client) =>
        client.query('REVOKE SELECT (metadata) ON public.topics FROM hzense_runtime'),
      );
    }

    await withClient(ownerUrl, async (client) => {
      await client.query('CREATE SCHEMA runtime_drift_inheritance');
      await client.query(
        'CREATE TABLE runtime_drift_inheritance.inherited_topics () INHERITS (public.topics)',
      );
    });
    try {
      await expect(
        withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
      ).rejects.toThrow(
        /forbids PostgreSQL table inheritance: public\.topics->runtime_drift_inheritance\.inherited_topics/,
      );
    } finally {
      await withClient(ownerUrl, (client) =>
        client.query('DROP SCHEMA runtime_drift_inheritance CASCADE'),
      );
    }

    await withClient(ownerUrl, (client) =>
      client.query(
        'GRANT EXECUTE ON FUNCTION public.runtime_forbidden_function() TO hzense_runtime',
      ),
    );
    try {
      await expect(
        withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
      ).rejects.toThrow(/unsafe non-pgvector application|direct routine grants/);
    } finally {
      await withClient(ownerUrl, (client) =>
        client.query(
          'REVOKE EXECUTE ON FUNCTION public.runtime_forbidden_function() FROM hzense_runtime',
        ),
      );
    }

    await withClient(ownerUrl, (client) => client.query(roleSql));
    await expect(
      withClient(databaseUrl(runtimeRole, runtimePassword), strictRuntimePreflight),
    ).resolves.toMatchObject({ user: runtimeRole });

    await withClient(ownerUrl, async (client) => {
      await client.query('CREATE TABLE public.runtime_future_table (id text)');
      await client.query('CREATE SEQUENCE public.runtime_future_sequence');
      await client.query("CREATE TYPE public.runtime_future_type AS ENUM ('value')");
      await client.query(
        `CREATE FUNCTION public.runtime_future_function()
         RETURNS text
         LANGUAGE sql
         SECURITY INVOKER
         AS 'SELECT ''future''::text'`,
      );
    });
    try {
      await withClient(databaseUrl(runtimeRole, runtimePassword), async (client) => {
        await expect(client.query('SELECT id FROM public.runtime_future_table')).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          client.query("SELECT nextval('public.runtime_future_sequence')"),
        ).rejects.toThrow(/permission denied/);
        await expect(client.query('SELECT public.runtime_future_function()')).rejects.toThrow(
          /permission denied/,
        );
        const typeUsage = await client.query(
          `SELECT has_type_privilege(
             current_user,
             'public.runtime_future_type'::regtype,
             'USAGE'
           ) AS allowed`,
        );
        expect(typeUsage.rows[0]?.allowed).toBe(false);
      });
    } finally {
      await withClient(ownerUrl, async (client) => {
        await client.query('DROP FUNCTION public.runtime_future_function()');
        await client.query('DROP TYPE public.runtime_future_type');
        await client.query('DROP SEQUENCE public.runtime_future_sequence');
        await client.query('DROP TABLE public.runtime_future_table');
      });
    }
  }, 30_000);
});
