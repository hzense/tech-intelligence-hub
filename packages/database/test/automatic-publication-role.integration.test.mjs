import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import {
  assertEditorialRole,
  editorialRoleColumns,
  editorialResourceRoleColumns,
  editorialArchiveReaderColumns,
} from '../src/editorial-signal-role.mjs';

const url = process.env.MIGRATION_TEST_ADMIN_URL;
if (url) validateConnectionTarget({ connectionString: url, profile: 'local-test' });
const suite = url ? describe.sequential : describe.skip;
suite('automatic publication role upgrade', () => {
  const name = `hzense_automatic_acl_${process.pid}_${Date.now()}`;
  const roles = ['hzense_editorial_writer', 'hzense_editorial_reader'];
  let admin,
    owner,
    writer,
    reader,
    databaseCreated = false;
  const createdRoles = [],
    ambient = [];
  const upgrade = () =>
    readFile(
      new URL('../../../db/roles/upgrade_automatic_publication.sql', import.meta.url),
      'utf8',
    );
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    if (
      (await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [roles]))
        .rows.length
    )
      throw new Error('Refuse pre-existing application roles');
    if (
      (
        await admin.query(
          "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
        )
      ).rows.length
    )
      throw new Error('Refuse cluster containing unrelated databases');
    for (const database of ['postgres', 'template1']) {
      const privileges = (
        await admin.query(
          "SELECT a.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0",
          [database],
        )
      ).rows.map((r) => r.privilege_type);
      ambient.push({ database, privileges });
      await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    }
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    databaseCreated = true;
    const target = new URL(url);
    target.pathname = `/${name}`;
    await runMigrations({ connectionString: target.toString() });
    owner = new pg.Client({ connectionString: target.toString() });
    await owner.connect();
    await owner.query(
      `REVOKE ALL ON DATABASE "${name}" FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`,
    );
    for (const [index, role] of roles.entries()) {
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD 'automatic-acl-local-test-only'`,
      );
      createdRoles.push(role);
      await owner.query(
        `GRANT CONNECT ON DATABASE "${name}" TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}`,
      );
      for (const [table, columns] of Object.entries(
        editorialRoleColumns[index === 0 ? 'writer' : 'reader'],
      ))
        await owner.query(
          `GRANT SELECT(${columns.join(',')})${index === 0 && table === 'editorial_signal_revisions' ? ', INSERT(' + columns.join(',') + ')' : ''} ON public.${table} TO ${role}`,
        );
    }
    for (const [table, columns] of Object.entries(editorialResourceRoleColumns))
      await owner.query(
        `GRANT SELECT(${columns.join(',')}), INSERT(${columns.join(',')}) ON public.${table} TO hzense_editorial_writer`,
      );
    await owner.query(`GRANT INSERT(unified_content) ON public.editorial_signal_revisions TO hzense_editorial_writer;
      GRANT SELECT(${editorialArchiveReaderColumns.join(',')}) ON public.legacy_public_signals TO hzense_editorial_reader;
      GRANT SELECT(signal_id,version,origin,publication_basis,content,recorded_at) ON public.unified_public_signals TO hzense_editorial_reader;
      GRANT SELECT(ready) ON public.unified_public_status TO hzense_editorial_reader;`);
    target.username = roles[0];
    target.password = 'automatic-acl-local-test-only';
    writer = new pg.Client({ connectionString: target.toString() });
    await writer.connect();
    target.username = roles[1];
    reader = new pg.Client({ connectionString: target.toString() });
    await reader.connect();
  }, 60000);
  afterAll(async () => {
    await writer?.end();
    await reader?.end();
    await owner?.end();
    if (databaseCreated) await admin.query(`DROP DATABASE "${name}"`);
    for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
    for (const { database, privileges } of ambient)
      if (privileges.length)
        await admin.query(`GRANT ${privileges.join(',')} ON DATABASE "${database}" TO PUBLIC`);
    await admin?.end();
  });
  it('accepts original ACL, applies exactly the automatic capabilities and is idempotent', async () => {
    await assertEditorialRole(writer, 'writer');
    await assertEditorialRole(reader, 'reader');
    await expect(
      writer.query('SELECT snapshot FROM public.signal_generation_runs LIMIT 0'),
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query(await upgrade());
    await assertEditorialRole(writer, 'writer');
    await assertEditorialRole(reader, 'reader');
    await writer.query('SELECT snapshot FROM public.signal_generation_runs LIMIT 0');
    await reader.query('SELECT publication_basis FROM public.editorial_public_signals LIMIT 0');
    await owner.query(await upgrade());
    await expect(
      writer.query(
        "UPDATE public.editorial_signal_revisions SET publication_basis='automatic_checks'",
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      reader.query('SELECT snapshot FROM public.signal_generation_runs LIMIT 0'),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects unrelated ambient grants instead of silently repairing or accepting them', async () => {
    await owner.query(
      'GRANT SELECT(result) ON public.signal_generation_runs TO hzense_editorial_writer',
    );
    try {
      await expect(owner.query(await upgrade())).rejects.toThrow('column ACL mismatch');
      await owner.query('ROLLBACK');
      await expect(assertEditorialRole(writer, 'writer')).rejects.toThrow('editorial_role_invalid');
    } finally {
      await owner.query(
        'REVOKE SELECT(result) ON public.signal_generation_runs FROM hzense_editorial_writer',
      );
    }
  });
});
