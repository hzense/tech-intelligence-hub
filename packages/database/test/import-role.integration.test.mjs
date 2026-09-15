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
let admin, owner, reader;
let createdRole = false,
  createdDatabase = false;
suite('dedicated import service role', () => {
  beforeAll(async () => {
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
    const url = new URL(adminURL);
    url.pathname = `/${name}`;
    owner = new pg.Client({ connectionString: url.href });
    await owner.connect();
    await owner.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await owner.query(`GRANT CONNECT ON DATABASE "${name}" TO ${role}`);
    await owner.query(
      await readFile(
        new URL('../../../db/migrations/0014_import_tasks.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query('CREATE TABLE public.unrelated_secret(secret text)');
    await owner.query(
      `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT ON public.import_batches,public.import_items,public.import_documents,public.import_attempts,public.import_outputs,public.import_audit,public.import_daily_usage TO ${role}; GRANT UPDATE ON public.import_batches,public.import_items,public.import_attempts,public.import_daily_usage TO ${role}`,
    );
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
