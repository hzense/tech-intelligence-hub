import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { assertImportRole } from '../src/import-role.mjs';
import { createImportBatch } from '../src/import-store.mjs';
import { randomUUID } from 'node:crypto';
const adminURL = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminURL) validateConnectionTarget({ connectionString: adminURL, profile: 'local-test' });
const suite = adminURL ? describe.sequential : describe.skip;
const name = `hzense_import_role_${process.pid}_${Date.now()}`;
const role = 'hzense_import_admin';
const rolePassword = randomUUID();
const roleSql = await readFile(
  new URL('../../../db/roles/configure_import_admin.sql', import.meta.url),
  'utf8',
);
const isolatedDatabases = [];
let admin, owner, reader;
let createdRole = false,
  createdDatabase = false;
suite('dedicated import service role', () => {
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Import role tests require a disposable isolated PostgreSQL cluster');
    admin = new pg.Client({ connectionString: adminURL });
    await admin.connect();
    if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length)
      throw new Error('Role exists; refuse unrelated role mutation');
    await admin.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT CONNECTION LIMIT 2 PASSWORD '${rolePassword}'`,
    );
    createdRole = true;
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    createdDatabase = true;
    const ambient = (
      await admin.query(
        `SELECT d.datname AS name,array_agg(a.privilege_type) AS privileges
      FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname<>$1 AND d.datallowconn AND a.grantee=0 GROUP BY d.datname`,
        [name],
      )
    ).rows;
    if (ambient.some((row) => !['postgres', 'template1'].includes(row.name)))
      throw new Error('Refuse to change unrelated database ACLs');
    for (const database of ambient) {
      isolatedDatabases.push(database);
      await admin.query(
        `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE "${database.name}" FROM PUBLIC`,
      );
    }
    const url = new URL(adminURL);
    url.pathname = `/${name}`;
    owner = new pg.Client({ connectionString: url.href });
    await owner.connect();
    await owner.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await owner.query(
      await readFile(
        new URL('../../../db/migrations/0014_import_tasks.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query('CREATE TABLE public.unrelated_secret(secret text)');
    // The separately verified production schema is represented by its reviewed ledger entry here.
    await owner.query(`CREATE TABLE public.hzense_schema_migrations(name text,checksum text);
      INSERT INTO public.hzense_schema_migrations VALUES('0014_import_tasks.sql','ae84c8eb9c212c48bde256eda199238f8d43579f2caa969b76fcc248709eda8a')`);
    await owner.query(roleSql);
    url.username = role;
    url.password = rolePassword;
    reader = new pg.Pool({ connectionString: url.href, max: 1 });
  });
  afterAll(async () => {
    await reader?.end();
    await owner?.end();
    if (admin) {
      if (createdDatabase) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      if (createdRole) await admin.query(`DROP ROLE ${role}`);
      for (const database of isolatedDatabases) {
        for (const privilege of database.privileges) {
          if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(privilege))
            throw new Error('Unexpected fixture privilege');
          await admin.query(`GRANT ${privilege} ON DATABASE "${database.name}" TO PUBLIC`);
        }
      }
      await admin.end();
    }
  });
  it('accepts exact role and creates private batch without owner credentials', async () => {
    await assertImportRole(reader);
    const batch = await createImportBatch({
      pool: reader,
      owner: 'admin',
      request: {
        id: randomUUID(),
        intent: 'preview',
        manifest: { urlLines: 'https://example.com' },
      },
      capabilities: { urlFetch: true, parsers: ['text'] },
      configuration: { parserVersion: 'v1', batchLimitMicrousd: 1 },
    });
    expect(batch.items).toHaveLength(1);
  });
  async function provision(sql = roleSql) {
    try {
      await owner.query(sql);
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }
  it('refuses repeated provisioning and preserves valid existing rights', async () => {
    await expect(provision()).rejects.toThrow(/existing direct ACLs/);
    await assertImportRole(reader);
  });
  it.each([
    [
      'wrong migration checksum',
      "UPDATE public.hzense_schema_migrations SET checksum='wrong'",
      "UPDATE public.hzense_schema_migrations SET checksum='ae84c8eb9c212c48bde256eda199238f8d43579f2caa969b76fcc248709eda8a'",
    ],
    ['unsafe role', `ALTER ROLE ${role} INHERIT`, `ALTER ROLE ${role} NOINHERIT`],
    [
      'ambient data grant',
      'GRANT SELECT ON public.unrelated_secret TO PUBLIC',
      'REVOKE SELECT ON public.unrelated_secret FROM PUBLIC',
    ],
  ])('provisioning fails closed without partial grants: %s', async (_label, drift, restore) => {
    await owner.query(`DROP OWNED BY ${role}`);
    try {
      await owner.query(drift);
      await expect(provision()).rejects.toThrow();
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS count FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1::regrole AND deptype='a'`,
            [role],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await owner.query(restore);
      await provision();
    }
    await assertImportRole(reader);
  });
  it('post-grant verification rejects and rolls back an injected DELETE grant', async () => {
    await owner.query(`DROP OWNED BY ${role}`);
    try {
      const drift = roleSql.replace(
        'DO $import_admin_verify$',
        `GRANT DELETE ON public.import_documents TO ${role};\nDO $import_admin_verify$`,
      );
      await expect(provision(drift)).rejects.toThrow(/privilege mismatch/);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS count FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1::regrole AND deptype='a'`,
            [role],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await provision();
    }
    await assertImportRole(reader);
  });
  it('cannot overwrite originals, delete outputs or read unrelated tables', async () => {
    for (const sql of [
      "UPDATE public.import_documents SET sha256='x'",
      'DELETE FROM public.import_outputs',
      'SELECT * FROM public.unrelated_secret',
    ])
      await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects inbound SET, INHERIT and unapproved ADMIN-only membership edges', async () => {
    const peer = `${name}_peer`;
    await owner.query(`CREATE ROLE "${peer}" NOLOGIN NOINHERIT`);
    try {
      for (const options of [
        'INHERIT FALSE, SET TRUE',
        'INHERIT TRUE, SET FALSE',
        'ADMIN TRUE, INHERIT FALSE, SET FALSE',
      ]) {
        await owner.query(`GRANT ${role} TO "${peer}" WITH ${options}`);
        await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
        await owner.query(`REVOKE ${role} FROM "${peer}"`);
      }
      await assertImportRole(reader);
    } finally {
      await owner.query(`DROP ROLE "${peer}"`);
    }
  });
  it('rejects ambient column grants and security-invoker function access', async () => {
    await owner.query(`GRANT SELECT(secret) ON public.unrelated_secret TO ${role}`);
    await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
    await owner.query(`REVOKE SELECT(secret) ON public.unrelated_secret FROM ${role}`);
    await owner.query(`GRANT REFERENCES(secret) ON public.unrelated_secret TO ${role}`);
    await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
    await owner.query(`REVOKE REFERENCES(secret) ON public.unrelated_secret FROM ${role}`);
    await owner.query(`GRANT MAINTAIN ON public.unrelated_secret TO ${role}`);
    await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
    await owner.query(`REVOKE MAINTAIN ON public.unrelated_secret FROM ${role}`);
    await owner.query(`ALTER ROLE ${role} IN DATABASE "${name}" SET search_path=public`);
    await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
    await owner.query(`ALTER ROLE ${role} IN DATABASE "${name}" RESET ALL`);
    await owner.query(
      'CREATE FUNCTION public.unrelated_call() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
    );
    await expect(assertImportRole(reader)).rejects.toMatchObject({ code: 'not_configured' });
    await owner.query('REVOKE EXECUTE ON FUNCTION public.unrelated_call() FROM PUBLIC');
    await assertImportRole(reader);
  });
});
