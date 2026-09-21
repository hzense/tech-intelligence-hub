import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { loadMigrations } from '../src/migrate.mjs';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { assertCandidateReviewRole } from '../src/candidate-review-role.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('candidate reviewer exact PostgreSQL privileges', () => {
  let admin,
    pool,
    rolePool,
    created = false,
    roleCreated = false;
  const name = `hzense_review_role_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    if (
      (await admin.query("SELECT 1 FROM pg_roles WHERE rolname='hzense_candidate_reviewer'"))
        .rowCount
    )
      throw new Error('Refusing to modify existing reviewer');
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const migration of await loadMigrations(
      new URL('../../../db/migrations/', import.meta.url).pathname,
    ))
      await pool.query(migration.sql);
    await pool.query('CREATE TABLE public.hzense_schema_migrations(name text primary key)');
    await pool.query(
      "INSERT INTO public.hzense_schema_migrations VALUES('0020_candidate_reviews.sql'),('0021_candidate_review_attestations.sql')",
    );
    await pool.query(`REVOKE TEMPORARY ON DATABASE "${name}" FROM PUBLIC`);
    await admin.query('CREATE ROLE hzense_candidate_reviewer LOGIN NOINHERIT CONNECTION LIMIT 2');
    roleCreated = true;
    await pool.query(
      await readFile(
        new URL('../../../db/roles/configure_candidate_reviewer.sql', import.meta.url),
        'utf8',
      ),
    );
    url.username = 'hzense_candidate_reviewer';
    url.password = '';
    rolePool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  });
  afterAll(async () => {
    await rolePool?.end();
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    if (roleCreated) await admin.query('DROP ROLE hzense_candidate_reviewer');
    await admin?.end();
  });
  it('accepts the explicit role and rejects extra metadata access or mutation', async () => {
    await expect(assertCandidateReviewRole(rolePool)).resolves.toBeUndefined();
    for (const [grant, revoke] of [
      [
        'GRANT SELECT(configuration) ON signal_generation_runs TO hzense_candidate_reviewer',
        'REVOKE SELECT(configuration) ON signal_generation_runs FROM hzense_candidate_reviewer',
      ],
      [
        'GRANT UPDATE(note) ON candidate_reviews TO hzense_candidate_reviewer',
        'REVOKE UPDATE(note) ON candidate_reviews FROM hzense_candidate_reviewer',
      ],
      [
        'GRANT SELECT(payload) ON candidate_review_attestations TO hzense_candidate_reviewer',
        'REVOKE SELECT(payload) ON candidate_review_attestations FROM hzense_candidate_reviewer',
      ],
      [
        'GRANT EXECUTE ON FUNCTION hzense_lock_candidate_publication_task(uuid,uuid) TO hzense_candidate_reviewer',
        'REVOKE EXECUTE ON FUNCTION hzense_lock_candidate_publication_task(uuid,uuid) FROM hzense_candidate_reviewer',
      ],
    ]) {
      await pool.query(grant);
      await expect(assertCandidateReviewRole(rolePool)).rejects.toThrow('review_role_invalid');
      await pool.query(revoke);
      await expect(assertCandidateReviewRole(rolePool)).resolves.toBeUndefined();
    }
  });
});
