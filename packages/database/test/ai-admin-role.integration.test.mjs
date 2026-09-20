import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { verifyDatabaseContract } from '../src/verify.mjs';
import { aiConfigurationColumns } from '../src/ai-configuration-catalog.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';
import {
  createAiConnection,
  updateAiConnection,
  listAiConnections,
  getAiConnectionHistory,
  runAiProbe,
  getAiProbe,
  saveAiProfile,
  getAiProfileHistory,
  listAiProfiles,
  resolveAiProfileForExecution,
  resolveAiGenerationAccess,
  listAiProbes,
} from '../src/ai-config-store.mjs';

const { Client, Pool } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_ai_config_${suffix}`;
const sentinelDatabase = `hzense_ai_sentinel_${suffix}`;
const ownerRole = `hzense_ai_owner_${suffix}`;
const restrictedRole = 'hzense_ai_admin';
const providerRole = 'cloud_admin';
const providerOwnerRole = 'neondb_owner';
const deniedRoles = ['hzense_runtime', 'hzense_signal_writer', 'hzense_publisher'];
const password = `fixture-ai-only-${suffix}`;
const roleSql = await readFile(
  new URL('../../../db/roles/configure_ai_admin.sql', import.meta.url),
  'utf8',
);
const createRoleSql = await readFile(
  new URL('../../../db/roles/create_ai_admin.sql', import.meta.url),
  'utf8',
);
const connectionId = randomUUID();
const profileId = randomUUID();
const probeId = randomUUID();
function quote(value) {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error('Unsafe AI fixture identifier');
  return `"${value}"`;
}
function urlFor(role, database = databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.toString();
}
async function connect(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}
const owner = (callback) => connect(urlFor(ownerRole), callback);
const service = (callback) => connect(urlFor(restrictedRole), callback);
const databaseAdmin = (callback) => connect(urlFor(), callback);
const verify = () =>
  verifyDatabaseContract({ connectionString: urlFor(ownerRole), profile: 'local-test' });

suite('PostgreSQL private AI configuration and administrator role', () => {
  let administrator;
  let databaseCreated = false;
  const createdRoles = [];
  let isolatedDatabases = [];
  // The disposable cluster's real bootstrap grantor has OID 10 but is named
  // postgres, not cloud_admin. Project only that expected provider identity;
  // every membership row/option remains the real PostgreSQL catalog value.
  // This does not verify a Neon branch or its provider-role identities.
  function providerMembershipSql(sql = roleSql) {
    expect(sql).toContain("pg_get_userbyid(m.grantor)='cloud_admin'");
    return sql.replaceAll("pg_get_userbyid(m.grantor)='cloud_admin'", 'm.grantor=10::oid');
  }
  async function roleMemberships(role = restrictedRole) {
    return (
      await administrator.query(
        `SELECT member,roleid,grantor,admin_option,inherit_option,set_option
        FROM pg_catalog.pg_auth_members WHERE member=$1::regrole OR roleid=$1::regrole
        ORDER BY member,roleid,grantor`,
        [role],
      )
    ).rows;
  }
  async function databasePrivileges() {
    return (
      await administrator.query(`SELECT datname,datdba,datacl::text,datconnlimit,datistemplate,datallowconn
        FROM pg_catalog.pg_database ORDER BY datname`)
    ).rows;
  }
  async function emptyRoleGrants() {
    expect(
      (
        await administrator.query(`SELECT 1 FROM pg_shdepend
          WHERE refclassid='pg_authid'::regclass AND refobjid='hzense_ai_admin'::regrole AND deptype='a'`)
      ).rows,
    ).toEqual([]);
  }
  async function withSentinel(callback, role = ownerRole) {
    await administrator.query(`CREATE DATABASE ${quote(sentinelDatabase)} OWNER ${quote(role)}`);
    try {
      return await callback();
    } finally {
      await waitForDatabaseDisconnects(administrator, sentinelDatabase);
      await administrator.query(`DROP DATABASE ${quote(sentinelDatabase)}`);
    }
  }
  async function restoreIsolatedDatabases() {
    for (const database of isolatedDatabases) {
      await administrator.query(
        `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(database.name)} FROM PUBLIC`,
      );
      for (const privilege of database.privileges) {
        if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(privilege))
          throw new Error('Unexpected fixture database privilege');
        await administrator.query(
          `GRANT ${privilege} ON DATABASE ${quote(database.name)} TO PUBLIC`,
        );
      }
    }
    isolatedDatabases = [];
  }
  async function configureProviderFixture({ database = 'postgres', template = false } = {}) {
    if (!['postgres', 'template1', 'unapproved_provider_database'].includes(database))
      throw new Error('Unexpected provider fixture name');
    return owner(async (client) => {
      // Only the fixed reserved name/template identity is projected. Privilege
      // checks still use the real sentinel OID, owner and ACL, and the view reads
      // fresh catalog state before and after GRANT. Production SQL explicitly
      // uses pg_catalog.pg_database and never trusts this test-only view.
      await client.query(`CREATE TEMP VIEW ai_database_catalog AS
        SELECT oid,CASE WHEN datname='${sentinelDatabase}' THEN '${database}'::name ELSE datname END AS datname,
          datdba,datacl,datallowconn,datconnlimit,
          CASE WHEN datname='${sentinelDatabase}' THEN ${template ? 'true' : 'false'} ELSE datistemplate END AS datistemplate
        FROM pg_catalog.pg_database`);
      expect(roleSql.match(/FROM pg_catalog\.pg_database d/g)).toHaveLength(2);
      const fixtureSql = roleSql
        .replaceAll('FROM pg_catalog.pg_database d', 'FROM pg_temp.ai_database_catalog d')
        .replace(/COMMIT;\s*$/, 'ROLLBACK;');
      return client.query(fixtureSql);
    });
  }
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('AI role tests require a disposable isolated PostgreSQL cluster');
    administrator = new Client({ connectionString: adminUrl });
    await administrator.connect();
    for (const role of [
      ownerRole,
      restrictedRole,
      ...deniedRoles,
      providerRole,
      providerOwnerRole,
    ]) {
      if ((await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        throw new Error(`Refusing to modify pre-existing fixture role ${role}`);
      await administrator.query(`CREATE ROLE ${quote(role)} LOGIN NOINHERIT CONNECTION LIMIT 2
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      createdRoles.push(role);
    }
    await administrator.query(`ALTER ROLE ${quote(providerRole)} NOLOGIN`);
    await administrator.query(`CREATE DATABASE ${quote(databaseName)} OWNER ${quote(ownerRole)}`);
    databaseCreated = true;
    const otherPublicPrivileges = (
      await administrator.query(
        `SELECT d.datname AS name,array_agg(a.privilege_type ORDER BY a.privilege_type) AS privileges
        FROM pg_catalog.pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
        WHERE d.datname<>$1 AND d.datallowconn AND a.grantee=0 GROUP BY d.datname ORDER BY d.datname`,
        [databaseName],
      )
    ).rows;
    if (otherPublicPrivileges.some((row) => !['postgres', 'template1'].includes(row.name)))
      throw new Error('AI role fixture refuses to modify unrelated database ACLs');
    // This disposable cluster's two known baseline databases need explicit
    // isolation. Restore their effective PUBLIC privileges during teardown.
    for (const database of otherPublicPrivileges) {
      isolatedDatabases.push(database);
      await administrator.query(
        `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(database.name)} FROM PUBLIC`,
      );
    }
    await databaseAdmin((client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: urlFor(ownerRole) });
    // Fixture hardening only; role provisioning must never rewrite PUBLIC rights.
    await owner((client) =>
      client.query(
        `REVOKE CREATE,TEMPORARY ON DATABASE ${quote(databaseName)} FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      ),
    );
  }, 30_000);
  afterAll(async () => {
    if (!administrator) return;
    try {
      await restoreIsolatedDatabases();
      if (databaseCreated) {
        await waitForDatabaseDisconnects(administrator, databaseName);
        await administrator.query(`DROP DATABASE ${quote(databaseName)}`);
      }
      for (const role of [...createdRoles].reverse())
        await administrator.query(`DROP ROLE ${quote(role)}`);
    } finally {
      await administrator.end();
    }
  }, 30_000);

  it('migrates and verifies 48 tables without adding any AI trigger/function or public read surface', async () => {
    expect(await verify()).toMatchObject({
      migrationCount: 20,
      tableCount: 48,
      pgvectorVersion: '0.8.6',
    });
    const result = await owner((client) =>
      client.query(
        `SELECT count(*)::integer AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname LIKE 'ai_%' AND NOT t.tgisinternal`,
      ),
    );
    expect(result.rows[0].count).toBe(0);
  });
  it('rolls 0013 back when owner default grants would expose AI tables, without repairing prior ACLs', async () => {
    const aclDatabase = `hzense_ai_acl_${suffix}`;
    await administrator.query(`CREATE DATABASE ${quote(aclDatabase)} OWNER ${quote(ownerRole)}`);
    try {
      await connect(urlFor(undefined, aclDatabase), (client) =>
        client.query('CREATE EXTENSION vector'),
      );
      await connect(urlFor(ownerRole, aclDatabase), (client) =>
        client.query(
          'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO hzense_runtime,hzense_signal_writer,hzense_publisher',
        ),
      );
      await expect(
        runMigrations({ connectionString: urlFor(ownerRole, aclDatabase) }),
      ).rejects.toThrow('AI configuration tables require owner-only ACLs');
      await connect(urlFor(ownerRole, aclDatabase), async (client) => {
        for (const table of Object.keys(aiConfigurationColumns))
          expect(
            (await client.query('SELECT to_regclass($1) AS relation', [`public.${table}`])).rows[0]
              .relation,
          ).toBeNull();
        expect(
          (
            await client.query(
              "SELECT 1 FROM public.hzense_schema_migrations WHERE name='0013_ai_configuration.sql'",
            )
          ).rowCount,
        ).toBe(0);
        for (const role of deniedRoles) {
          // Earlier migration state and operator default policy remain intact.
          expect(
            (
              await client.query(
                "SELECT has_table_privilege($1,'public.topics','SELECT') AS allowed",
                [role],
              )
            ).rows[0].allowed,
          ).toBe(true);
          expect(
            (
              await client.query(
                `SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
            WHERE d.defaclrole=current_user::regrole AND d.defaclobjtype='r' AND a.grantee=$1::regrole AND a.privilege_type='SELECT'`,
                [role],
              )
            ).rowCount,
          ).toBe(1);
        }
      });
    } finally {
      await waitForDatabaseDisconnects(administrator, aclDatabase);
      await administrator.query(`DROP DATABASE ${quote(aclDatabase)}`);
    }
  });

  for (const [label, change, restore, message] of [
    [
      'relaxed protocol check',
      "ALTER TABLE public.ai_connections DROP CONSTRAINT ai_connections_protocol_ck; ALTER TABLE public.ai_connections ADD CONSTRAINT ai_connections_protocol_ck CHECK (protocol = 'openai-compatible' OR true)",
      "ALTER TABLE public.ai_connections DROP CONSTRAINT ai_connections_protocol_ck; ALTER TABLE public.ai_connections ADD CONSTRAINT ai_connections_protocol_ck CHECK (protocol = 'openai-compatible')",
      'check constraint expression mismatch',
    ],
    [
      'missing JSON object check',
      'ALTER TABLE public.ai_profile_versions DROP CONSTRAINT ai_profile_versions_snapshot_ck',
      "ALTER TABLE public.ai_profile_versions ADD CONSTRAINT ai_profile_versions_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')",
      'check constraint count mismatch',
    ],
    [
      'enabled-by-default connection',
      'ALTER TABLE public.ai_connections ALTER COLUMN enabled SET DEFAULT true',
      'ALTER TABLE public.ai_connections ALTER COLUMN enabled SET DEFAULT false',
      'default expression mismatch',
    ],
    [
      'nullable configuration',
      'ALTER TABLE public.ai_probe_runs ALTER COLUMN configuration DROP NOT NULL',
      'ALTER TABLE public.ai_probe_runs ALTER COLUMN configuration SET NOT NULL',
      'column contract mismatch',
    ],
    [
      'missing budget index',
      'DROP INDEX public.ai_probe_runs_connection_created_idx',
      'CREATE INDEX ai_probe_runs_connection_created_idx ON public.ai_probe_runs(connection_id,created_at)',
      'missing valid non-unique btree index',
    ],
    [
      'cascading historical revision identity',
      'ALTER TABLE public.ai_connection_versions DROP CONSTRAINT ai_connection_versions_connection_id_fkey; ALTER TABLE public.ai_connection_versions ADD CONSTRAINT ai_connection_versions_connection_id_fkey FOREIGN KEY(connection_id) REFERENCES public.ai_connections(id) ON DELETE CASCADE',
      'ALTER TABLE public.ai_connection_versions DROP CONSTRAINT ai_connection_versions_connection_id_fkey; ALTER TABLE public.ai_connection_versions ADD CONSTRAINT ai_connection_versions_connection_id_fkey FOREIGN KEY(connection_id) REFERENCES public.ai_connections(id)',
      'foreign key',
    ],
  ]) {
    it(`detects catalog drift: ${label}`, async () => {
      await owner((client) => client.query(change));
      try {
        await expect(verify()).rejects.toThrow(message);
      } finally {
        await owner((client) => client.query(restore));
      }
      await verify();
    });
  }

  it('refuses non-owner and SET ROLE provisioning without granting access', async () => {
    await expect(databaseAdmin((client) => client.query(roleSql))).rejects.toThrow(
      'Authenticated database owner required',
    );
    await expect(
      databaseAdmin(async (client) => {
        await client.query(`SET ROLE ${quote(ownerRole)}`);
        return client.query(roleSql);
      }),
    ).rejects.toThrow('Authenticated database owner required');
    await expect(
      service((client) => client.query('SELECT * FROM public.ai_connections')),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('refuses an unsafe role and pre-existing privileges rather than silently repairing them', async () => {
    await administrator.query('ALTER ROLE hzense_ai_admin INHERIT');
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'Pre-create a restricted',
      );
    } finally {
      await administrator.query('ALTER ROLE hzense_ai_admin NOINHERIT');
    }
    await owner((client) => client.query('GRANT SELECT ON public.signals TO hzense_ai_admin'));
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'existing direct ACLs',
      );
    } finally {
      await owner((client) => client.query('REVOKE SELECT ON public.signals FROM hzense_ai_admin'));
    }
  });
  it('reproduces the non-superuser creator grant surviving REVOKE without target a/o dependencies', async () => {
    const probeRole = `hzense_ai_creator_probe_${suffix}`;
    const notices = [];
    const captureNotice = (notice) => notices.push(notice.message);
    administrator.on('notice', captureNotice);
    try {
      await administrator.query(`BEGIN;
        ALTER ROLE ${quote(providerOwnerRole)} CREATEROLE;
        SET LOCAL ROLE ${quote(providerOwnerRole)};
        SET LOCAL createrole_self_grant='';
        CREATE ROLE ${quote(probeRole)} NOLOGIN;
        REVOKE ${quote(probeRole)} FROM ${quote(providerOwnerRole)}`);
      const memberships = await roleMemberships(probeRole);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({
        grantor: 10,
        admin_option: true,
        inherit_option: false,
        set_option: false,
      });
      expect(notices.some((notice) => notice.includes('has not been granted membership'))).toBe(
        true,
      );
      expect(
        (
          await administrator.query(
            `SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass
            AND refobjid=$1::regrole AND deptype IN ('a','o')`,
            [probeRole],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await administrator.query('ROLLBACK');
      administrator.off('notice', captureNotice);
    }
    expect(
      (await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [probeRole])).rows,
    ).toEqual([]);
  });
  for (const commit of [false, true])
    it(`executes the projected credential candidate with ${commit ? 'commit and existing-password protection' : 'rollback and no residual role'}`, async () => {
      const probeRole = `hzense_ai_created_${suffix}`;
      // Map only the locally authenticated owner/database, temporary target
      // name and bootstrap grantor. No production/Neon identity is asserted.
      const candidate = providerMembershipSql(createRoleSql)
        .replaceAll("'neondb'", `'${databaseName}'`)
        .replaceAll("'neondb_owner'", `'${ownerRole}'`)
        .replaceAll('hzense_ai_admin', probeRole);
      await administrator.query(`ALTER ROLE ${quote(ownerRole)} CREATEROLE`);
      try {
        await owner(async (client) => {
          await client.query(
            "SET createrole_self_grant='inherit,set'; SET password_encryption='md5'",
          );
          const settings = async () =>
            (await client.query('SHOW createrole_self_grant; SHOW password_encryption')).map(
              (result) => result.rows,
            );
          const beforeSettings = await settings();
          const results = await client.query(
            commit ? candidate : candidate.replace(/COMMIT;\s*$/, 'ROLLBACK;'),
          );
          const secretResult = results.find((result) =>
            result.fields.some((field) => field.name === 'HZENSE_AI_DATABASE_PASSWORD - SECRET'),
          );
          const secret = secretResult?.rows[0]?.['HZENSE_AI_DATABASE_PASSWORD - SECRET'];
          // Never pass the credential itself to assertion diagnostics or logs.
          expect(typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)).toBe(true);
          expect(await settings()).toEqual(beforeSettings);
          expect(
            (await client.query("SELECT to_regclass('pg_temp.ai_setup_result') IS NULL AS gone"))
              .rows[0].gone,
          ).toBe(true);
          if (commit) {
            const memberships = await roleMemberships(probeRole);
            expect(memberships).toHaveLength(1);
            expect(memberships[0]).toMatchObject({
              grantor: 10,
              admin_option: true,
              inherit_option: false,
              set_option: false,
            });
            const verifier = async () =>
              (
                await administrator.query(
                  `SELECT md5(rolpassword) AS fingerprint,
                  rolpassword LIKE 'SCRAM-SHA-256$%' AS scram FROM pg_authid WHERE rolname=$1`,
                  [probeRole],
                )
              ).rows;
            const beforeVerifier = await verifier();
            expect(beforeVerifier[0].scram).toBe(true);
            await expect(client.query(candidate)).rejects.toThrow('AI role already exists');
            await client.query('ROLLBACK');
            expect(await verifier()).toEqual(beforeVerifier);
            expect(await roleMemberships(probeRole)).toEqual(memberships);
          } else {
            expect(
              (await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [probeRole]))
                .rows,
            ).toEqual([]);
          }
        });
      } finally {
        await administrator.query(`DROP ROLE IF EXISTS ${quote(probeRole)}`);
        await administrator.query(`ALTER ROLE ${quote(ownerRole)} NOCREATEROLE`);
      }
    });
  it('accepts only the projected bootstrap ADMIN-only creator edge without changing it', async () => {
    expect(roleSql.match(/pg_get_userbyid\(m\.grantor\)='cloud_admin'/g)).toHaveLength(2);
    await administrator.query(
      'GRANT hzense_ai_admin TO neondb_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
    );
    try {
      const before = await roleMemberships();
      await owner((client) =>
        client.query(providerMembershipSql().replace(/COMMIT;\s*$/, 'ROLLBACK;')),
      );
      expect(await roleMemberships()).toEqual(before);
      await emptyRoleGrants();
    } finally {
      await administrator.query('REVOKE hzense_ai_admin FROM neondb_owner');
    }
  });
  for (const [label, change, cleanup, projected = true] of [
    [
      'unapproved bootstrap grantor name',
      'GRANT hzense_ai_admin TO neondb_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
      'REVOKE hzense_ai_admin FROM neondb_owner',
      false,
    ],
    [
      'unapproved member',
      'GRANT hzense_ai_admin TO hzense_runtime WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
      'REVOKE hzense_ai_admin FROM hzense_runtime',
    ],
    [
      'missing ADMIN option',
      'GRANT hzense_ai_admin TO neondb_owner WITH ADMIN FALSE, INHERIT FALSE, SET FALSE',
      'REVOKE hzense_ai_admin FROM neondb_owner',
    ],
    [
      'INHERIT option',
      'GRANT hzense_ai_admin TO neondb_owner WITH ADMIN TRUE, INHERIT TRUE, SET FALSE',
      'REVOKE hzense_ai_admin FROM neondb_owner',
    ],
    [
      'SET option',
      'GRANT hzense_ai_admin TO neondb_owner WITH ADMIN TRUE, INHERIT FALSE, SET TRUE',
      'REVOKE hzense_ai_admin FROM neondb_owner',
    ],
    [
      'outgoing membership',
      'GRANT hzense_runtime TO hzense_ai_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
      'REVOKE hzense_runtime FROM hzense_ai_admin',
    ],
    [
      'additional incoming membership alongside the provider edge',
      'GRANT hzense_ai_admin TO neondb_owner,hzense_runtime WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
      'REVOKE hzense_ai_admin FROM neondb_owner,hzense_runtime',
    ],
  ]) {
    const candidate = () => (projected ? providerMembershipSql() : roleSql);
    it(`refuses ${label} before GRANT without repairing memberships`, async () => {
      await administrator.query(change);
      try {
        const before = await roleMemberships();
        await expect(owner((client) => client.query(candidate()))).rejects.toThrow(
          'unsafe memberships',
        );
        expect(await roleMemberships()).toEqual(before);
        await emptyRoleGrants();
      } finally {
        await administrator.query(cleanup);
      }
    });
    it(`rolls back new ACLs when ${label} appears after GRANT`, async () => {
      const sql = candidate();
      const verificationStart = sql.indexOf('DO $ai_admin_verify$');
      try {
        await owner(async (client) => {
          await client.query(sql.slice(0, verificationStart));
          await administrator.query(change);
          await expect(client.query(sql.slice(verificationStart))).rejects.toThrow(
            'membership contract mismatch',
          );
        });
        await emptyRoleGrants();
      } finally {
        await administrator.query(cleanup);
      }
    });
  }
  for (const [label, change, cleanup] of [
    ['LOGIN', 'ALTER ROLE hzense_ai_admin NOLOGIN', 'ALTER ROLE hzense_ai_admin LOGIN'],
    ['INHERIT', 'ALTER ROLE hzense_ai_admin INHERIT', 'ALTER ROLE hzense_ai_admin NOINHERIT'],
    ['SUPERUSER', 'ALTER ROLE hzense_ai_admin SUPERUSER', 'ALTER ROLE hzense_ai_admin NOSUPERUSER'],
    ['CREATEDB', 'ALTER ROLE hzense_ai_admin CREATEDB', 'ALTER ROLE hzense_ai_admin NOCREATEDB'],
    [
      'CREATEROLE',
      'ALTER ROLE hzense_ai_admin CREATEROLE',
      'ALTER ROLE hzense_ai_admin NOCREATEROLE',
    ],
    [
      'REPLICATION',
      'ALTER ROLE hzense_ai_admin REPLICATION',
      'ALTER ROLE hzense_ai_admin NOREPLICATION',
    ],
    ['BYPASSRLS', 'ALTER ROLE hzense_ai_admin BYPASSRLS', 'ALTER ROLE hzense_ai_admin NOBYPASSRLS'],
    [
      'connection limit',
      'ALTER ROLE hzense_ai_admin CONNECTION LIMIT 3',
      'ALTER ROLE hzense_ai_admin CONNECTION LIMIT 2',
    ],
    [
      'role settings',
      "ALTER ROLE hzense_ai_admin SET work_mem='8MB'",
      'ALTER ROLE hzense_ai_admin RESET work_mem',
    ],
  ])
    it(`rolls back new ACLs on post-GRANT ${label} drift`, async () => {
      const verificationStart = roleSql.indexOf('DO $ai_admin_verify$');
      try {
        await owner(async (client) => {
          await client.query(roleSql.slice(0, verificationStart));
          await administrator.query(change);
          await expect(client.query(roleSql.slice(verificationStart))).rejects.toThrow(
            'role contract mismatch',
          );
        });
        await emptyRoleGrants();
      } finally {
        await administrator.query(cleanup);
      }
    });
  it('refuses ambient PUBLIC access instead of changing unrelated ACLs', async () => {
    await owner((client) => client.query('GRANT SELECT ON public.signals TO PUBLIC'));
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'Ambient application data/function',
      );
    } finally {
      await owner((client) => client.query('REVOKE SELECT ON public.signals FROM PUBLIC'));
    }
  });
  for (const privilege of ['CONNECT', 'TEMPORARY', 'CREATE']) {
    it(`refuses another database's PUBLIC ${privilege} without repairing any ACL`, async () =>
      withSentinel(async () => {
        await administrator.query(
          `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC`,
        );
        await administrator.query(
          `GRANT ${privilege} ON DATABASE ${quote(sentinelDatabase)} TO PUBLIC`,
        );
        const before = await databasePrivileges();
        await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
          'unsafe privileges on another connectable database',
        );
        expect(await databasePrivileges()).toEqual(before);
        await emptyRoleGrants();
      }));
    it(`rolls back all grants if another database gains PUBLIC ${privilege} after provisioning`, async () =>
      withSentinel(async () => {
        await administrator.query(
          `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC`,
        );
        const before = await databasePrivileges();
        const driftedSql = roleSql.replace(
          'DO $ai_admin_verify$',
          `GRANT ${privilege} ON DATABASE ${quote(sentinelDatabase)} TO PUBLIC;\nDO $ai_admin_verify$`,
        );
        await expect(owner((client) => client.query(driftedSql))).rejects.toThrow(
          'unsafe privileges on another connectable database',
        );
        expect(await databasePrivileges()).toEqual(before);
        await emptyRoleGrants();
        await expect(
          service((client) => client.query('SELECT name FROM public.ai_connections')),
        ).rejects.toMatchObject({ code: '42501' });
      }));
  }
  for (const [label, fixture, change, accepted, sentinelOwner = providerRole] of [
    ['exact provider postgres', {}, undefined, true],
    [
      'unapproved provider database name',
      { database: 'unapproved_provider_database' },
      undefined,
      false,
    ],
    ['reserved postgres without provider ownership', {}, undefined, false, ownerRole],
    ['reserved postgres marked as a template', { template: true }, undefined, false],
    [
      'provider postgres with a connection limit',
      {},
      `ALTER DATABASE ${quote(sentinelDatabase)} CONNECTION LIMIT 1`,
      false,
    ],
    [
      'provider postgres with an explicit ACL',
      {},
      `REVOKE TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC; GRANT TEMPORARY ON DATABASE ${quote(sentinelDatabase)} TO PUBLIC`,
      false,
    ],
    [
      'provider postgres with PUBLIC CREATE',
      {},
      `GRANT CREATE ON DATABASE ${quote(sentinelDatabase)} TO PUBLIC`,
      false,
    ],
    [
      'exact provider template1',
      { database: 'template1', template: true },
      `REVOKE TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC`,
      true,
    ],
    [
      'provider template1 without template identity',
      { database: 'template1' },
      `REVOKE TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC`,
      false,
    ],
    [
      'provider template1 with default PUBLIC TEMPORARY',
      { database: 'template1', template: true },
      undefined,
      false,
    ],
    [
      'provider template1 with PUBLIC CREATE',
      { database: 'template1', template: true },
      `REVOKE TEMPORARY ON DATABASE ${quote(sentinelDatabase)} FROM PUBLIC; GRANT CREATE ON DATABASE ${quote(sentinelDatabase)} TO PUBLIC`,
      false,
    ],
  ])
    it(`${accepted ? 'accepts' : 'refuses'} ${label} using real OID-bound privileges`, async () =>
      withSentinel(async () => {
        if (change) await administrator.query(change);
        const before = await databasePrivileges();
        if (accepted) await configureProviderFixture(fixture);
        else
          await expect(configureProviderFixture(fixture)).rejects.toThrow(
            'unsafe privileges on another connectable database',
          );
        expect(await databasePrivileges()).toEqual(before);
        await emptyRoleGrants();
      }, sentinelOwner));
  for (const [label, drift, message] of [
    [
      'missing required column read',
      'REVOKE SELECT (name) ON public.ai_connections FROM hzense_ai_admin',
      'effective column privilege contract mismatch',
    ],
    [
      'table-wide read escalation',
      'GRANT SELECT ON public.ai_connections TO hzense_ai_admin',
      'no direct table or sequence privileges',
    ],
    [
      'protected history column write',
      'GRANT UPDATE (snapshot) ON public.ai_connection_versions TO hzense_ai_admin',
      'effective column privilege contract mismatch',
    ],
    [
      'column grant option',
      'GRANT SELECT (name) ON public.ai_connections TO hzense_ai_admin WITH GRANT OPTION',
      'effective column privilege contract mismatch',
    ],
    [
      'database grant option',
      `GRANT CONNECT ON DATABASE ${quote(databaseName)} TO hzense_ai_admin WITH GRANT OPTION`,
      'database privilege contract mismatch',
    ],
    [
      'schema grant option',
      'GRANT USAGE ON SCHEMA public TO hzense_ai_admin WITH GRANT OPTION',
      'schema privilege contract mismatch',
    ],
    [
      'ambient effective table read',
      'GRANT SELECT ON public.signals TO PUBLIC',
      'effective table privilege contract mismatch',
    ],
    [
      'ambient effective column read',
      'GRANT SELECT (title) ON public.signals TO PUBLIC',
      'effective column privilege contract mismatch',
    ],
    [
      'missing direct ACL hidden by matching ambient access',
      'REVOKE SELECT (name) ON public.ai_connections FROM hzense_ai_admin; GRANT SELECT (name) ON public.ai_connections TO PUBLIC',
      'direct column ACL contract mismatch',
    ],
  ])
    it(`rolls back every new grant when post-grant verification detects ${label}`, async () => {
      // Inject drift after GRANT, exercising the commit gate independently of
      // preflight. No elevated permission survives the failed transaction.
      const driftedSql = roleSql.replace('DO $ai_admin_verify$', `${drift};\nDO $ai_admin_verify$`);
      expect(driftedSql).not.toBe(roleSql);
      await expect(owner((client) => client.query(driftedSql))).rejects.toThrow(message);
      const remaining = await owner((client) =>
        client.query(`SELECT 1 FROM pg_shdepend
          WHERE refclassid='pg_authid'::regclass AND refobjid='hzense_ai_admin'::regrole AND deptype='a'`),
      );
      expect(remaining.rows).toEqual([]);
      await expect(
        service((client) => client.query('SELECT name FROM public.ai_connections')),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        service((client) => client.query('SELECT title FROM public.signals')),
      ).rejects.toMatchObject({ code: '42501' });
    });
  it('provisions only the authenticated restricted role and five exact private tables', async () => {
    await owner((client) => client.query(roleSql));
    const result = await service((client) =>
      client.query(`SELECT session_user, current_user,
      rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit
      FROM pg_roles WHERE rolname=current_user`),
    );
    expect(result.rows[0]).toEqual({
      session_user: restrictedRole,
      current_user: restrictedRole,
      rolsuper: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: 2,
    });
    const grants = await owner((client) =>
      client.query(`SELECT c.relname,a.attname,
      has_column_privilege('hzense_ai_admin',c.oid,a.attnum,'SELECT') AS readable,
      has_column_privilege('hzense_ai_admin',c.oid,a.attnum,'INSERT') AS insertable,
      has_column_privilege('hzense_ai_admin',c.oid,a.attnum,'UPDATE') AS updatable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped`),
    );
    const updates = {
      ai_connections: [
        'revision',
        'name',
        'protocol',
        'base_url',
        'enabled',
        'settings',
        'encrypted_key',
        'updated_at',
      ],
      ai_profiles: ['revision', 'name', 'stages', 'updated_at'],
      ai_probe_runs: [
        'status',
        'reserved_microusd',
        'charged_microusd',
        'input_tokens',
        'output_tokens',
        'result',
        'error_code',
        'finished_at',
      ],
    };
    for (const row of grants.rows) {
      const aiTable = Object.hasOwn(aiConfigurationColumns, row.relname);
      expect(row.readable).toBe(aiTable);
      expect(row.insertable).toBe(aiTable);
      expect(row.updatable).toBe(updates[row.relname]?.includes(row.attname) ?? false);
    }
    const directColumns = await owner((client) =>
      client.query(`SELECT c.relname,a.attname,acl.privilege_type,acl.is_grantable
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        CROSS JOIN LATERAL aclexplode(a.attacl) acl
        WHERE acl.grantee='hzense_ai_admin'::regrole`),
    );
    const expectedColumns = Object.entries(aiConfigurationColumns).flatMap(([table, columns]) =>
      Object.keys(columns).flatMap((column) =>
        ['SELECT', 'INSERT', ...(updates[table]?.includes(column) ? ['UPDATE'] : [])].map(
          (privilege) => `${table}.${column}.${privilege}`,
        ),
      ),
    );
    expect(
      directColumns.rows.map((row) => `${row.relname}.${row.attname}.${row.privilege_type}`).sort(),
    ).toEqual(expectedColumns.sort());
    expect(directColumns.rows.every((row) => !row.is_grantable)).toBe(true);
    expect(
      (
        await owner((client) =>
          client.query(`SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
            WHERE a.grantee='hzense_ai_admin'::regrole`),
        )
      ).rows,
    ).toEqual([]);
    const dangerous = await owner((client) =>
      client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','v','S') AND
      (has_table_privilege('hzense_ai_admin',c.oid,'DELETE') OR has_table_privilege('hzense_ai_admin',c.oid,'TRUNCATE') OR has_table_privilege('hzense_ai_admin',c.oid,'TRIGGER'))`),
    );
    expect(dangerous.rows).toEqual([]);
  });
  it('keeps a newly added column on every AI table unreadable and unwritable', async () => {
    for (const [table, columns] of Object.entries(aiConfigurationColumns)) {
      await owner((client) =>
        client.query(`ALTER TABLE public.${quote(table)} ADD COLUMN future_private text`),
      );
      try {
        const privileges = await owner((client) =>
          client.query(
            `SELECT has_column_privilege('hzense_ai_admin',$1,'future_private','SELECT') AS readable,
              has_column_privilege('hzense_ai_admin',$1,'future_private','INSERT') AS insertable,
              has_column_privilege('hzense_ai_admin',$1,'future_private','UPDATE') AS updatable`,
            [`public.${table}`],
          ),
        );
        expect(privileges.rows[0]).toEqual({
          readable: false,
          insertable: false,
          updatable: false,
        });
        await service((client) =>
          client.query(`SELECT ${quote(Object.keys(columns)[0])} FROM public.${quote(table)}`),
        );
        for (const query of [
          `SELECT future_private FROM public.${quote(table)}`,
          `SELECT * FROM public.${quote(table)}`,
          `UPDATE public.${quote(table)} SET future_private='not-authorized'`,
        ])
          await expect(service((client) => client.query(query))).rejects.toMatchObject({
            code: '42501',
          });
      } finally {
        await owner((client) =>
          client.query(`ALTER TABLE public.${quote(table)} DROP COLUMN future_private`),
        );
      }
    }
  });
  it('writes mutable settings, append-only masked history and probe costs through the real role', async () => {
    await service(async (client) => {
      await client.query(
        `INSERT INTO public.ai_connections(id,name,protocol,base_url,settings,encrypted_key)
        VALUES($1,'Fixture','openai-compatible','https://example.com/v1','{}','{"key_version":"test-only","ciphertext":"fixture-not-a-key"}')`,
        [connectionId],
      );
      await client.query(
        'INSERT INTO public.ai_connection_versions(connection_id,revision,snapshot) VALUES($1,1,$2)',
        [connectionId, { name: 'Fixture', has_key: true }],
      );
      await client.query(
        "UPDATE public.ai_connections SET name='Fixture two',revision=2,updated_at=now() WHERE id=$1",
        [connectionId],
      );
      await client.query(
        'INSERT INTO public.ai_connection_versions(connection_id,revision,snapshot) VALUES($1,2,$2)',
        [connectionId, { name: 'Fixture two', has_key: true }],
      );
      await client.query(
        "INSERT INTO public.ai_profiles(id,name,stages) VALUES($1,'Fixture profile','{}')",
        [profileId],
      );
      await client.query(
        "INSERT INTO public.ai_profile_versions(profile_id,revision,snapshot) VALUES($1,1,'{}')",
        [profileId],
      );
      await client.query(
        "UPDATE public.ai_profiles SET name='Edited profile',revision=2,updated_at=now() WHERE id=$1",
        [profileId],
      );
      await client.query(
        `INSERT INTO public.ai_probe_runs(id,connection_id,connection_revision,kind,fingerprint,status,configuration,reserved_microusd)
        VALUES($1,$2,2,'connection',repeat('a',64),'pending','{}',9007199254740993)`,
        [probeId, connectionId],
      );
      await client.query(
        "UPDATE public.ai_probe_runs SET status='unknown',charged_microusd=12,result='{}',error_code='fixture_timeout',finished_at=now() WHERE id=$1",
        [probeId],
      );
      const row = (
        await client.query(
          'SELECT reserved_microusd,charged_microusd,status FROM public.ai_probe_runs WHERE id=$1',
          [probeId],
        )
      ).rows[0];
      expect(row).toEqual({
        reserved_microusd: '9007199254740993',
        charged_microusd: '12',
        status: 'unknown',
      });
    });
  });
  for (const [label, sql, parameters] of [
    [
      'historical connection snapshot update',
      "UPDATE public.ai_connection_versions SET snapshot='{}' WHERE connection_id=$1",
      [connectionId],
    ],
    [
      'historical profile snapshot update',
      "UPDATE public.ai_profile_versions SET snapshot='{}' WHERE profile_id=$1",
      [profileId],
    ],
    [
      'history deletion',
      'DELETE FROM public.ai_connection_versions WHERE connection_id=$1',
      [connectionId],
    ],
    [
      'connection ID replacement',
      'UPDATE public.ai_connections SET id=$1 WHERE id=$2',
      [randomUUID(), connectionId],
    ],
    [
      'backdating budget window',
      "UPDATE public.ai_probe_runs SET created_at='2020-01-01' WHERE id=$1",
      [probeId],
    ],
    [
      'probe fingerprint replacement',
      "UPDATE public.ai_probe_runs SET fingerprint=repeat('b',64) WHERE id=$1",
      [probeId],
    ],
    [
      'probe config replacement',
      "UPDATE public.ai_probe_runs SET configuration='{}' WHERE id=$1",
      [probeId],
    ],
    [
      'probe revision replacement',
      'UPDATE public.ai_probe_runs SET connection_revision=1 WHERE id=$1',
      [probeId],
    ],
    ['private source access', 'SELECT * FROM public.sources', []],
    ['private candidate access', 'SELECT * FROM public.signal_candidate_verifications', []],
    ['public signal projection access', 'SELECT * FROM public.current_public_signals', []],
    [
      'publication write',
      'UPDATE public.signal_publication_control SET publication_enabled=true',
      [],
    ],
    ['publication function', 'SELECT public.hzense_lock_publication_controls($1)', [randomUUID()]],
    ['truncate', 'TRUNCATE public.ai_probe_runs', []],
    ['DDL', 'CREATE TABLE public.ai_unauthorized_fixture(id integer)', []],
  ])
    it(`denies ${label}`, async () => {
      await expect(service((client) => client.query(sql, parameters))).rejects.toMatchObject({
        code: '42501',
      });
    });
  for (const role of deniedRoles)
    it(`grants no new AI data access to ${role}`, async () => {
      for (const table of Object.keys(aiConfigurationColumns)) {
        await expect(
          connect(urlFor(role), (client) => client.query(`SELECT * FROM public.${quote(table)}`)),
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  for (const [label, sql, parameters, code] of [
    [
      'nonpositive revision',
      'UPDATE public.ai_connections SET revision=0 WHERE id=$1',
      [connectionId],
      '23514',
    ],
    [
      'unsupported protocol',
      "UPDATE public.ai_connections SET protocol='other' WHERE id=$1",
      [connectionId],
      '23514',
    ],
    [
      'array settings',
      "UPDATE public.ai_connections SET settings='[]' WHERE id=$1",
      [connectionId],
      '23514',
    ],
    [
      'string ciphertext envelope',
      `UPDATE public.ai_connections SET encrypted_key='"plaintext"' WHERE id=$1`,
      [connectionId],
      '23514',
    ],
    [
      'invalid profile stages',
      "UPDATE public.ai_profiles SET stages='null' WHERE id=$1",
      [profileId],
      '23514',
    ],
    [
      'negative reservation',
      'UPDATE public.ai_probe_runs SET reserved_microusd=-1 WHERE id=$1',
      [probeId],
      '23514',
    ],
    [
      'negative charged cost',
      'UPDATE public.ai_probe_runs SET charged_microusd=-1 WHERE id=$1',
      [probeId],
      '23514',
    ],
    [
      'negative token count',
      'UPDATE public.ai_probe_runs SET output_tokens=-1 WHERE id=$1',
      [probeId],
      '23514',
    ],
    [
      'invalid result object',
      "UPDATE public.ai_probe_runs SET result='[]' WHERE id=$1",
      [probeId],
      '23514',
    ],
    [
      'unrecognized probe state',
      "UPDATE public.ai_probe_runs SET status='published' WHERE id=$1",
      [probeId],
      '23514',
    ],
    [
      'duplicate immutable revision',
      "INSERT INTO public.ai_connection_versions(connection_id,revision,snapshot) VALUES($1,1,'{}')",
      [connectionId],
      '23505',
    ],
    [
      'missing referenced revision',
      "INSERT INTO public.ai_probe_runs(id,connection_id,connection_revision,kind,fingerprint,status,configuration) VALUES($1,$2,99,'models',repeat('a',64),'pending','{}')",
      [randomUUID(), connectionId],
      '23503',
    ],
    [
      'invalid fingerprint',
      "INSERT INTO public.ai_probe_runs(id,connection_id,connection_revision,kind,fingerprint,status,configuration) VALUES($1,$2,1,'models','BAD','pending','{}')",
      [randomUUID(), connectionId],
      '23514',
    ],
    [
      'invalid probe kind',
      "INSERT INTO public.ai_probe_runs(id,connection_id,connection_revision,kind,fingerprint,status,configuration) VALUES($1,$2,1,'publish',repeat('a',64),'pending','{}')",
      [randomUUID(), connectionId],
      '23514',
    ],
  ])
    it(`rejects ${label}`, async () => {
      await expect(service((client) => client.query(sql, parameters))).rejects.toMatchObject({
        code,
      });
    });
  const keyring = { active: 'test', keys: { test: Buffer.alloc(32, 7).toString('base64') } };
  const allowedHosts = ['example.com'];
  const settings = {
    timeout_ms: 10_000,
    max_concurrency: 1,
    daily_budget_microusd: 100_000_000,
    input_price_microusd_per_million: 1_000_000,
    output_price_microusd_per_million: 1_000_000,
  };
  const createRequest = () => ({
    name: 'Synthetic service connection',
    protocol: 'openai-compatible',
    base_url: 'https://example.com/v1',
    enabled: true,
    settings,
    api_key: 'synthetic-role-test-key',
  });
  async function withPool(callback) {
    const pool = new Pool({ connectionString: urlFor(restrictedRole), max: 2 });
    try {
      return await callback(pool);
    } finally {
      await pool.end();
    }
  }
  const result = (kind) => ({
    success: true,
    model_id: 'synthetic-model',
    input_tokens: 1,
    output_tokens: 1,
    result:
      kind === 'connection'
        ? { sentinel_matched: true }
        : { schema_valid: true, sentinel_matched: true },
  });

  it('serializes connection creation retries and rejects conflicting or obsolete create payloads', async () =>
    withPool(async (pool) => {
      const request = { ...createRequest(), id: randomUUID() };
      const create = (input = request) =>
        createAiConnection({ pool, request: input, keyring, allowedHosts });
      const [first, retry] = await Promise.all([create(), create()]);
      expect(retry).toEqual(first);
      expect(first).toMatchObject({ id: request.id, revision: 1 });
      expect(
        (await getAiConnectionHistory({ pool, id: request.id })).map((row) => row.revision),
      ).toEqual([1]);
      await expect(
        create({ ...request, settings: Object.fromEntries(Object.entries(settings).reverse()) }),
      ).resolves.toEqual(first);
      const zeroPriceRequest = {
        ...request,
        id: randomUUID(),
        settings: {
          ...settings,
          input_price_microusd_per_million: -0,
          output_price_microusd_per_million: -0,
        },
      };
      const zeroPriceConnection = await create(zeroPriceRequest);
      expect(zeroPriceConnection.settings.input_price_microusd_per_million).toBe(0);
      expect(zeroPriceConnection.settings.output_price_microusd_per_million).toBe(0);
      await expect(create(zeroPriceRequest)).resolves.toEqual(zeroPriceConnection);
      expect(await getAiConnectionHistory({ pool, id: zeroPriceRequest.id })).toHaveLength(1);
      for (const changes of [
        { name: 'A different connection' },
        { api_key: 'another-synthetic-role-test-key' },
        { enabled: false },
        { settings: { ...settings, max_concurrency: 2 } },
      ])
        await expect(create({ ...request, ...changes })).rejects.toMatchObject({
          code: 'request_id_conflict',
        });
      const conflictingId = randomUUID();
      const attempts = await Promise.allSettled([
        create({ ...request, id: conflictingId, name: 'First competing payload' }),
        create({ ...request, id: conflictingId, name: 'Second competing payload' }),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.find((attempt) => attempt.status === 'rejected').reason).toMatchObject({
        code: 'request_id_conflict',
      });
      expect(await getAiConnectionHistory({ pool, id: conflictingId })).toHaveLength(1);
      await updateAiConnection({
        pool,
        request: { id: request.id, expected_revision: 1, name: request.name },
        keyring,
        allowedHosts,
      });
      await expect(create()).resolves.toMatchObject({ revision: 1 });
      expect(await getAiConnectionHistory({ pool, id: request.id })).toHaveLength(1);
      await updateAiConnection({
        pool,
        request: { id: request.id, expected_revision: 1, name: 'Actual renamed connection' },
        keyring,
        allowedHosts,
      });
      await expect(create()).rejects.toMatchObject({ code: 'request_id_conflict' });
      await updateAiConnection({
        pool,
        request: { id: request.id, expected_revision: 2, revoke_key: true },
        keyring,
        allowedHosts,
      });
      await expect(create()).rejects.toMatchObject({ code: 'request_id_conflict' });
      expect(
        (await getAiConnectionHistory({ pool, id: request.id })).map((row) => row.revision),
      ).toEqual([3, 2, 1]);
    }));
  it('executes the real store with restricted credentials, masked revisions, persisted probes, explicit-ID profile retries and revocation', async () =>
    withPool(async (pool) => {
      const input = createRequest();
      const connection = await createAiConnection({ pool, request: input, keyring, allowedHosts });
      expect(connection).toMatchObject({ revision: 1, has_key: true, key_mask: '••••••••' });
      expect(JSON.stringify(connection)).not.toContain(input.api_key);
      const stage = {
        connection_id: connection.id,
        connection_revision: 1,
        model_id: 'synthetic-model',
        prompt: 'Synthetic test',
        temperature: -0,
        max_output_tokens: 128,
        require_tools: false,
      };
      const profileRequest = {
        id: randomUUID(),
        name: 'Synthetic profile',
        stages: { extract: stage, verify: stage, analyze: stage },
      };
      await expect(saveAiProfile({ pool, request: profileRequest })).rejects.toMatchObject({
        code: 'profile_not_ready',
      });
      let calls = 0;
      let firstRequest;
      let firstReceipt;
      for (const kind of ['connection', 'structured_output']) {
        const request = {
          id: randomUUID(),
          connection_id: connection.id,
          connection_revision: 1,
          kind,
          model_id: 'synthetic-model',
        };
        const receipt = await runAiProbe({
          pool,
          request,
          keyring,
          allowedHosts,
          invoke: async (invocation) => {
            calls++;
            expect(invocation.apiKey).toBe(input.api_key);
            const persisted = await getAiProbe({ pool, id: request.id });
            expect(persisted.status).toBe('running');
            return result(kind);
          },
        });
        expect(receipt).toMatchObject({ status: 'succeeded', input_tokens: 1, output_tokens: 1 });
        expect(BigInt(receipt.charged_microusd)).toBeGreaterThanOrEqual(
          BigInt(receipt.reserved_microusd),
        );
        if (kind === 'connection') {
          firstRequest = request;
          firstReceipt = receipt;
          await expect(saveAiProfile({ pool, request: profileRequest })).rejects.toMatchObject({
            code: 'profile_not_ready',
          });
        }
      }
      const [profile, profileRetry] = await Promise.all([
        saveAiProfile({ pool, request: profileRequest }),
        saveAiProfile({ pool, request: profileRequest }),
      ]);
      expect(profile).toMatchObject({ id: profileRequest.id, revision: 1 });
      expect(profileRetry).toEqual(profile);
      for (const storedStage of Object.values(profile.stages))
        expect(storedStage.temperature).toBe(0);
      await expect(saveAiProfile({ pool, request: profileRequest })).resolves.toEqual(profile);
      expect(await getAiProfileHistory({ pool, id: profile.id })).toHaveLength(1);
      await expect(
        saveAiProfile({
          pool,
          request: {
            ...profileRequest,
            stages: Object.fromEntries(Object.entries(profileRequest.stages).reverse()),
          },
        }),
      ).resolves.toEqual(profile);
      await expect(
        saveAiProfile({ pool, request: { ...profileRequest, name: 'A conflicting profile' } }),
      ).rejects.toMatchObject({ code: 'request_id_conflict' });
      await expect(
        saveAiProfile({
          pool,
          request: {
            ...profileRequest,
            stages: { ...profileRequest.stages, extract: { ...stage, prompt: 'Different prompt' } },
          },
        }),
      ).rejects.toMatchObject({ code: 'request_id_conflict' });
      expect(profile.readiness.ready).toBe(true);
      expect((await resolveAiProfileForExecution({ pool, id: profile.id })).id).toBe(profile.id);
      expect(
        (
          await saveAiProfile({
            pool,
            request: {
              ...profileRequest,
              id: profile.id,
              expected_revision: 1,
              name: 'Edited synthetic profile',
            },
          })
        ).revision,
      ).toBe(2);
      expect(
        (await getAiProfileHistory({ pool, id: profile.id })).map((row) => row.revision),
      ).toEqual([2, 1]);
      await expect(saveAiProfile({ pool, request: profileRequest })).rejects.toMatchObject({
        code: 'request_id_conflict',
      });
      expect(
        await runAiProbe({
          pool,
          request: firstRequest,
          keyring,
          allowedHosts,
          invoke: async () => {
            throw new Error('Must not replay network');
          },
        }),
      ).toEqual(firstReceipt);
      expect(calls).toBe(2);
      await expect(
        runAiProbe({
          pool,
          request: { ...firstRequest, kind: 'structured_output' },
          keyring,
          allowedHosts,
          invoke: async () => result('structured_output'),
        }),
      ).rejects.toMatchObject({ code: 'request_id_conflict' });
      const unchanged = await updateAiConnection({
        pool,
        request: {
          id: connection.id,
          expected_revision: 1,
          name: input.name,
          api_key: input.api_key,
        },
        keyring,
        allowedHosts,
      });
      expect(unchanged.revision).toBe(1);
      expect(
        (await listAiProfiles({ pool })).find((row) => row.id === profile.id).readiness.ready,
      ).toBe(true);
      expect(await getAiConnectionHistory({ pool, id: connection.id })).toHaveLength(1);
      await updateAiConnection({
        pool,
        request: { id: connection.id, expected_revision: 1, name: 'Changed' },
        keyring,
        allowedHosts,
      });
      await expect(
        updateAiConnection({
          pool,
          request: { id: connection.id, expected_revision: 1, name: 'Lost update' },
          keyring,
          allowedHosts,
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' });
      expect(
        (await listAiProfiles({ pool })).find((row) => row.id === profile.id).readiness.ready,
      ).toBe(false);
      await expect(resolveAiProfileForExecution({ pool, id: profile.id })).rejects.toMatchObject({
        code: 'profile_not_ready',
      });
      await updateAiConnection({
        pool,
        request: { id: connection.id, expected_revision: 2, revoke_key: true },
        keyring,
        allowedHosts,
      });
      const history = await getAiConnectionHistory({ pool, id: connection.id });
      expect(history.map((row) => row.revision)).toEqual([3, 2, 1]);
      expect(history[0].snapshot.has_key).toBe(false);
      expect(JSON.stringify(history)).not.toContain(input.api_key);
      expect(JSON.stringify(history)).not.toContain('ciphertext');
      expect(
        (await listAiConnections({ pool })).find((row) => row.id === connection.id).has_key,
      ).toBe(false);
      await expect(
        runAiProbe({
          pool,
          request: { ...firstRequest, id: randomUUID(), connection_revision: 3 },
          keyring,
          allowedHosts,
          invoke: async () => {
            calls++;
            return result('connection');
          },
        }),
      ).rejects.toMatchObject({ code: 'connection_unavailable' });
      const persisted = await service((client) =>
        client.query(
          `SELECT snapshot AS data FROM public.ai_connection_versions WHERE connection_id=$1
      UNION ALL SELECT configuration FROM public.ai_probe_runs WHERE connection_id=$1
      UNION ALL SELECT result FROM public.ai_probe_runs WHERE connection_id=$1`,
          [connection.id],
        ),
      );
      expect(JSON.stringify(persisted.rows)).not.toContain(input.api_key);
      expect(JSON.stringify(persisted.rows)).not.toContain('ciphertext');
      expect(calls).toBe(2);
    }));
  it('serializes real concurrent reservations and makes an in-flight result stale after disabling its connection', async () =>
    withPool(async (pool) => {
      const connection = await createAiConnection({
        pool,
        request: createRequest(),
        keyring,
        allowedHosts,
      });
      const request = {
        id: randomUUID(),
        connection_id: connection.id,
        connection_revision: 1,
        kind: 'connection',
        model_id: 'synthetic-model',
      };
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      let calls = 0;
      const pending = runAiProbe({
        pool,
        request,
        keyring,
        allowedHosts,
        invoke: async () => {
          calls++;
          entered.resolve();
          await release.promise;
          return result('connection');
        },
      });
      try {
        await entered.promise;
        expect(
          (
            await runAiProbe({
              pool,
              request,
              keyring,
              allowedHosts,
              invoke: async () => {
                calls++;
                return result('connection');
              },
            })
          ).status,
        ).toBe('running');
        await expect(
          runAiProbe({
            pool,
            request: { ...request, id: randomUUID() },
            keyring,
            allowedHosts,
            invoke: async () => {
              calls++;
              return result('connection');
            },
          }),
        ).rejects.toMatchObject({ code: 'concurrency_limit' });
        await updateAiConnection({
          pool,
          request: { id: connection.id, expected_revision: 1, enabled: false },
          keyring,
          allowedHosts,
        });
      } finally {
        release.resolve();
      }
      expect(await pending).toMatchObject({
        status: 'stale',
        error_code: 'connection_unavailable',
        result: {},
      });
      expect(calls).toBe(1);
      expect((await getAiProbe({ pool, id: request.id })).status).toBe('stale');
    }));
  it('warns on old matching proofs but rejects different models, missing or future proofs', async () =>
    withPool(async (pool) => {
      const connection = await createAiConnection({
        pool,
        request: createRequest(),
        keyring,
        allowedHosts,
      });
      const stage = {
        connection_id: connection.id,
        connection_revision: 1,
        model_id: 'synthetic-model',
        prompt: 'Synthetic expiry test',
        temperature: 0,
        max_output_tokens: 128,
        require_tools: false,
      };
      const request = {
        name: 'Expiring profile',
        stages: { extract: stage, verify: stage, analyze: stage },
      };
      for (const kind of ['connection', 'structured_output']) {
        const receipt = await runAiProbe({
          pool,
          keyring,
          allowedHosts,
          request: {
            id: randomUUID(),
            connection_id: connection.id,
            connection_revision: 1,
            kind,
            model_id: 'synthetic-model',
          },
          invoke: async () => result(kind),
        });
        expect(receipt.status).toBe('succeeded');
      }
      const profile = await saveAiProfile({ pool, request });
      expect(profile.readiness.ready).toBe(true);
      const otherStage = { ...stage, model_id: 'another-model' };
      await expect(
        saveAiProfile({
          pool,
          request: {
            ...request,
            stages: { extract: otherStage, verify: otherStage, analyze: otherStage },
          },
        }),
      ).rejects.toMatchObject({ code: 'profile_not_ready' });
      await owner((client) =>
        client.query(
          "UPDATE public.ai_probe_runs SET finished_at=clock_timestamp()-interval '25 hours' WHERE connection_id=$1",
          [connection.id],
        ),
      );
      expect(
        (await listAiProfiles({ pool })).find((row) => row.id === profile.id).readiness.ready,
      ).toBe(true);
      const old = await resolveAiProfileForExecution({ pool, id: profile.id });
      expect(old.readiness.warnings).toHaveLength(6);
      expect(old.readiness.reasons).toEqual([]);
      expect((await saveAiProfile({ pool, request })).readiness.ready).toBe(true);
      expect(
        (
          await resolveAiGenerationAccess({
            pool,
            id: profile.id,
            revision: profile.revision,
            allowedHosts,
            keyring,
          })
        ).profile.readiness.ready,
      ).toBe(true);
      await owner((client) =>
        client.query(
          'UPDATE public.ai_probe_runs SET finished_at=clock_timestamp() WHERE connection_id=$1',
          [connection.id],
        ),
      );
      expect(
        (await resolveAiProfileForExecution({ pool, id: profile.id })).readiness.warnings,
      ).toEqual([]);
      // Future timestamps and unfinished tests are not valid capability evidence.
      for (const finish of ["clock_timestamp()+interval '1 hour'", 'NULL']) {
        await owner((client) =>
          client.query(
            `UPDATE public.ai_probe_runs SET finished_at=${finish} WHERE connection_id=$1`,
            [connection.id],
          ),
        );
        await expect(resolveAiProfileForExecution({ pool, id: profile.id })).rejects.toMatchObject({
          code: 'profile_not_ready',
        });
      }
      await owner((client) =>
        client.query(
          "UPDATE public.ai_probe_runs SET finished_at=clock_timestamp(),status='failed' WHERE connection_id=$1",
          [connection.id],
        ),
      );
      await expect(resolveAiProfileForExecution({ pool, id: profile.id })).rejects.toMatchObject({
        code: 'profile_not_ready',
      });
    }));
  it('querying abandoned probes marks them unknown and preserves the reservation without invoking the provider again', async () =>
    withPool(async (pool) => {
      const connection = await createAiConnection({
        pool,
        request: createRequest(),
        keyring,
        allowedHosts,
      });
      const request = {
        id: randomUUID(),
        connection_id: connection.id,
        connection_revision: 1,
        kind: 'connection',
        model_id: 'synthetic-model',
      };
      const receipt = await runAiProbe({
        pool,
        request,
        keyring,
        allowedHosts,
        invoke: async () => result('connection'),
      });
      // Simulate the server disappearing after request dispatch. Only the fixture
      // owner may backdate the immutable request timestamp; the service cannot.
      await owner((client) =>
        client.query(
          "UPDATE public.ai_probe_runs SET status='running',finished_at=NULL,created_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
          [request.id],
        ),
      );
      const unknown = await getAiProbe({ pool, id: request.id });
      expect(unknown).toMatchObject({
        status: 'unknown',
        error_code: 'probe_outcome_unknown',
        reserved_microusd: receipt.reserved_microusd,
      });
      const replay = await runAiProbe({
        pool,
        request,
        keyring,
        allowedHosts,
        invoke: async () => {
          throw new Error('Abandoned probes must not retry paid requests');
        },
      });
      expect(replay).toEqual(unknown);
      await owner((client) =>
        client.query(
          "UPDATE public.ai_probe_runs SET status='pending',finished_at=NULL WHERE id=$1",
          [request.id],
        ),
      );
      expect((await listAiProbes({ pool })).find((row) => row.id === request.id)).toMatchObject({
        status: 'unknown',
        error_code: 'probe_outcome_unknown',
        reserved_microusd: receipt.reserved_microusd,
      });
    }));
});
