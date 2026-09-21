import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';

const adminURL = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminURL) validateConnectionTarget({ connectionString: adminURL, profile: 'local-test' });
const suite = adminURL ? describe.sequential : describe.skip;
const load = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const upgrade = await load('db/roles/upgrade_task_management_visibility.sql');
const manifest = JSON.parse(await load('db/migrations/checksums.json'));
const roles = ['hzense_import_admin', 'hzense_generation_admin'];
let admin, owner;
let created = false;
const ambient = [];
async function apply(sql = upgrade) {
  try {
    return await owner.query(sql);
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
}
async function addedPermissions() {
  return (
    await owner.query(`SELECT count(*)::int AS n FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) p
    WHERE a.attname='deleted_at' AND p.grantee IN ('hzense_import_admin'::regrole,'hzense_generation_admin'::regrole)`)
  ).rows[0].n;
}
suite('one-time task visibility role upgrade', () => {
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminURL });
    await admin.connect();
    if (
      (
        await admin.query(
          "SELECT 1 FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
        )
      ).rowCount ||
      (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)', [roles])).rowCount
    )
      throw new Error('Refuse existing application database or roles');
    for (const name of ['postgres', 'template1']) {
      const privileges = (
        await admin.query(
          "SELECT p.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) p WHERE d.datname=$1 AND p.grantee=0",
          [name],
        )
      ).rows.map((r) => r.privilege_type);
      ambient.push({ name, privileges });
      await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    }
    await admin.query('CREATE DATABASE hzense TEMPLATE template0');
    created = true;
    const url = new URL(adminURL);
    url.pathname = '/hzense';
    owner = new pg.Client({ connectionString: url.href });
    await owner.connect();
    await owner.query(
      'REVOKE ALL ON DATABASE hzense FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC; CREATE TABLE public.hzense_schema_migrations(name text, checksum text)',
    );
    // This historical visibility upgrade fixture has no Signal foundation tables.
    // Later candidate review migrations are verified by their independent suites.
    for (const [name, checksum] of Object.entries(manifest).filter(
      ([name]) => name >= '0014_' && name < '0020_',
    )) {
      await owner.query(await load(`db/migrations/${name}`));
      await owner.query('INSERT INTO public.hzense_schema_migrations VALUES($1,$2)', [
        name,
        checksum,
      ]);
    }
    for (const role of roles)
      await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT CONNECTION LIMIT 2`);
    for (const kind of ['import', 'generation']) {
      // Provision the exact prior column contract against the new nullable columns.
      let sql = (await load(`db/roles/configure_${kind}_admin.sql`))
        .replaceAll(',deleted_at', '')
        .replaceAll(',"deleted_at"', '');
      // This suite verifies the historical 0017/0018 ACL transition, not 0019.
      if (kind === 'generation')
        sql = sql
          .replaceAll(',progress_phase,progress_at,started_at', '')
          .replaceAll(',"progress_phase","progress_at","started_at"', '')
          .replace('a.grantee=target)<>51', 'a.grantee=target)<>45');
      sql = sql.replace(
        /(WHERE a.grantee=target\)<>)(\d+)/g,
        (_, prefix, count) => prefix + (Number(count) > 10 ? Number(count) - 2 : count),
      );
      await apply(sql);
    }
  });
  afterAll(async () => {
    await owner?.end();
    if (created) {
      await admin.query('DROP DATABASE hzense WITH (FORCE)');
      for (const role of roles) await admin.query(`DROP ROLE ${role}`);
    }
    for (const { name, privileges } of ambient)
      for (const p of privileges) {
        if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(p))
          throw new Error('Unexpected fixture privilege');
        await admin.query(`GRANT ${p} ON DATABASE "${name}" TO PUBLIC`);
      }
    await admin?.end();
  });
  it('requires all migration checksums before changing any ACL', async () => {
    await owner.query(
      "UPDATE public.hzense_schema_migrations SET checksum='invalid' WHERE name='0018_generation_task_visibility.sql'",
    );
    await expect(apply()).rejects.toThrow('Verify task management migration ledger');
    expect(await addedPermissions()).toBe(0);
    await owner.query('UPDATE public.hzense_schema_migrations SET checksum=$1 WHERE name=$2', [
      manifest['0018_generation_task_visibility.sql'],
      '0018_generation_task_visibility.sql',
    ]);
  });
  it('refuses PUBLIC exposure before grants', async () => {
    await owner.query('GRANT SELECT(id) ON public.import_batches TO PUBLIC');
    await expect(apply()).rejects.toThrow();
    expect(await addedPermissions()).toBe(0);
    await owner.query('REVOKE SELECT(id) ON public.import_batches FROM PUBLIC');
  });
  it('refuses an extra privilege instead of normalizing it', async () => {
    await owner.query('GRANT DELETE ON public.import_batches TO hzense_import_admin');
    await expect(apply()).rejects.toThrow();
    expect(await addedPermissions()).toBe(0);
    await owner.query('REVOKE DELETE ON public.import_batches FROM hzense_import_admin');
  });
  it('rolls back both grants if the post-upgrade contract fails', async () => {
    const broken = upgrade.replace(
      'GRANT SELECT(deleted_at),UPDATE(deleted_at) ON public.signal_generation_runs TO hzense_generation_admin;',
      'GRANT SELECT(deleted_at) ON public.signal_generation_runs TO hzense_generation_admin;',
    );
    await expect(apply(broken)).rejects.toThrow();
    expect(await addedPermissions()).toBe(0);
  });
  it('adds exactly four column privileges and refuses replay', async () => {
    await apply();
    expect(await addedPermissions()).toBe(4);
    await expect(apply()).rejects.toThrow();
    expect(await addedPermissions()).toBe(4);
  });
});
