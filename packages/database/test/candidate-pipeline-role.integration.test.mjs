import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { verifyDatabaseContract } from '../src/verify.mjs';
import {
  assertCandidatePipelineRole,
  candidatePipelineProvisionSQL,
} from '../src/candidate-pipeline-role.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('candidate pipeline exact effective grants in isolated PostgreSQL', () => {
  const db = `hzense_pipeline_acl_${randomUUID().replaceAll('-', '')}`;
  const roles = [
    'hzense_candidate_assembler',
    'hzense_candidate_verifier',
    'hzense_publication_controller',
  ];
  const createdRoles = [];
  let admin,
    owner,
    created = false;
  function url(role) {
    const value = new URL(adminUrl);
    value.pathname = `/${db}`;
    if (role) {
      value.username = role;
      value.password = 'fixture-pipeline-only';
    }
    return value.toString();
  }
  async function asRole(role, operation) {
    const client = new pg.Client({ connectionString: url(role) });
    await client.connect();
    try {
      return await operation(client);
    } finally {
      await client.end();
    }
  }
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    owner = new pg.Client({ connectionString: url() });
    await owner.connect();
    await owner.query('CREATE EXTENSION vector');
    await runMigrations({ connectionString: url() });
    await owner.query(
      `REVOKE TEMPORARY ON DATABASE "${db}" FROM PUBLIC; REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`,
    );
    for (const role of roles) {
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOINHERIT CONNECTION LIMIT 2 PASSWORD 'fixture-pipeline-only'`,
      );
      createdRoles.push(role);
    }
    await admin.query(
      'CREATE ROLE cloud_admin SUPERUSER NOLOGIN; CREATE ROLE neondb_owner NOLOGIN',
    );
    createdRoles.push('neondb_owner', 'cloud_admin');
    for (const role of roles)
      await admin.query(`GRANT ${role} TO neondb_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    // Disposable superuser fixture only: emulate Neon's bootstrap grantor identity.
    // A local cluster's bootstrap role is not named cloud_admin; ordinary GRANT
    // cannot impersonate that provider bootstrap edge without adding unsafe ACLs.
    await admin.query(
      "UPDATE pg_catalog.pg_auth_members SET grantor='cloud_admin'::regrole WHERE member='neondb_owner'::regrole",
    );
    await admin.query(
      "UPDATE pg_catalog.pg_auth_members SET set_option=true WHERE roleid='hzense_candidate_assembler'::regrole AND member='neondb_owner'::regrole",
    );
    await expect(owner.query(candidatePipelineProvisionSQL())).rejects.toThrow(
      'Pre-create an empty restricted',
    );
    await owner.query('ROLLBACK');
    await admin.query(
      "UPDATE pg_catalog.pg_auth_members SET set_option=false WHERE roleid='hzense_candidate_assembler'::regrole AND member='neondb_owner'::regrole",
    );
    await owner.query(candidatePipelineProvisionSQL());
  }, 30000);
  afterAll(async () => {
    await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
    await admin?.end();
  }, 30000);
  it('accepts exactly configured direct login roles and rejects owner fallback', async () => {
    for (const role of roles) await asRole(role, (c) => assertCandidatePipelineRole(c, role));
    await expect(assertCandidatePipelineRole(owner, roles[0])).rejects.toThrow(
      'candidate_pipeline_role_invalid',
    );
  });
  it('passes full schema verification after applying the actual pipeline role grants', async () => {
    await expect(
      verifyDatabaseContract({
        connectionString: url(),
        profile: 'local-test',
        expectedDatabase: db,
        expectedUser: new URL(adminUrl).username,
      }),
    ).resolves.toMatchObject({ migrationCount: 26, tableCount: 58 });
  });
  it('accepts only the exact Neon ADMIN-only incoming membership, never SET or outbound memberships', async () => {
    await admin.query(
      "UPDATE pg_catalog.pg_auth_members SET inherit_option=true WHERE roleid='hzense_candidate_assembler'::regrole AND member='neondb_owner'::regrole",
    );
    await asRole(roles[0], (c) =>
      expect(assertCandidatePipelineRole(c, roles[0])).rejects.toThrow(
        'candidate_pipeline_role_invalid',
      ),
    );
    await admin.query(
      "UPDATE pg_catalog.pg_auth_members SET inherit_option=false WHERE roleid='hzense_candidate_assembler'::regrole AND member='neondb_owner'::regrole",
    );
    await admin.query('CREATE ROLE hzense_pipeline_unsafe_membership NOLOGIN');
    createdRoles.push('hzense_pipeline_unsafe_membership');
    await admin.query(
      'GRANT hzense_pipeline_unsafe_membership TO hzense_candidate_assembler WITH INHERIT FALSE, SET FALSE',
    );
    await asRole(roles[0], (c) =>
      expect(assertCandidatePipelineRole(c, roles[0])).rejects.toThrow(
        'candidate_pipeline_role_invalid',
      ),
    );
    await admin.query('REVOKE hzense_pipeline_unsafe_membership FROM hzense_candidate_assembler');
    await asRole(roles[0], (c) => assertCandidatePipelineRole(c, roles[0]));
  });
  it('rejects newly added table, column and PUBLIC privileges', async () => {
    await owner.query('GRANT UPDATE(title) ON public.signals TO hzense_candidate_assembler');
    await asRole(roles[0], (c) =>
      expect(assertCandidatePipelineRole(c, roles[0])).rejects.toThrow(),
    );
    await owner.query('REVOKE UPDATE(title) ON public.signals FROM hzense_candidate_assembler');
    await owner.query('GRANT SELECT ON public.import_outputs TO PUBLIC');
    await asRole(roles[0], (c) =>
      expect(assertCandidatePipelineRole(c, roles[0])).rejects.toThrow(),
    );
    await owner.query('REVOKE SELECT ON public.import_outputs FROM PUBLIC');
    await asRole(roles[0], (c) => assertCandidatePipelineRole(c, roles[0]));
  });
  it('rejects guard drift, extra functions, and control-plane writes', async () => {
    await owner.query(
      'ALTER TABLE public.signal_candidate_verifications DISABLE TRIGGER signal_candidate_verifications_guard_trg',
    );
    await asRole(roles[1], (c) =>
      expect(assertCandidatePipelineRole(c, roles[1])).rejects.toThrow(),
    );
    await owner.query(
      'ALTER TABLE public.signal_candidate_verifications ENABLE ALWAYS TRIGGER signal_candidate_verifications_guard_trg',
    );
    await owner.query(
      'GRANT EXECUTE ON FUNCTION public.hzense_guard_candidate_verification() TO hzense_candidate_verifier',
    );
    await asRole(roles[1], (c) =>
      expect(assertCandidatePipelineRole(c, roles[1])).rejects.toThrow(),
    );
    await owner.query(
      'REVOKE EXECUTE ON FUNCTION public.hzense_guard_candidate_verification() FROM hzense_candidate_verifier',
    );
    await asRole(roles[2], (c) =>
      expect(
        c.query('UPDATE public.signal_publication_control SET publication_enabled=true'),
      ).rejects.toMatchObject({ code: '42501' }),
    );
  });
});
