import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  materialRoleColumns,
  materialRoleCheckSQL,
  assertMaterialRole,
  materialRoleProvisionSQL,
} from '../src/material-registration-role.mjs';

describe('material registry role separation', () => {
  it('gives registrar insert-only registry and pending evidence access without verification/report authority', () => {
    const registrar = materialRoleColumns.hzense_material_registrar;
    expect(registrar.public_source_evidence.INSERT).not.toContain('verification_status');
    expect(registrar.public_source_evidence.INSERT).not.toContain('created_xid');
    expect(registrar.candidate_material_reports.INSERT).toBeUndefined();
    expect(registrar.entities.INSERT).not.toContain('created_at');
    for (const grants of Object.values(registrar))
      expect(Object.keys(grants).every((key) => ['SELECT', 'INSERT'].includes(key))).toBe(true);
  });
  it('gives verifier status-only evidence update with signed report and receipt insertion', () => {
    const verifier = materialRoleColumns.hzense_material_verifier;
    expect(verifier.public_source_evidence.UPDATE).toEqual(['verification_status']);
    expect(verifier.public_source_evidence.INSERT).toBeUndefined();
    expect(verifier.candidate_material_reports.INSERT).toContain('attestation');
    expect(verifier.candidate_material_requests.INSERT).toBeUndefined();
    for (const name of [
      'entities',
      'sources',
      'topics',
      'person_profiles',
      'organization_profiles',
    ])
      expect(Object.keys(verifier[name])).toEqual(['SELECT']);
  });
  it('checks ambient authority, exact columns, required default, immutable and stage guard seals', () => {
    for (const role of Object.keys(materialRoleColumns)) {
      const sql = materialRoleCheckSQL(role);
      for (const token of [
        'session_user=current_user',
        'pg_auth_members',
        'pg_shdepend',
        'pg_default_acl',
        'has_column_privilege(r.oid',
        'WITH GRANT OPTION',
        'has_function_privilege(r.oid',
        'has_sequence_privilege(r.oid',
        "g.tgenabled='A'",
        'sha256',
        "'''pending''::text",
        'hzense_guard_candidate_material_receipt_insert',
        'public.hzense_lock_material_dependencies(uuid,text)',
        "f.prorettype='pg_catalog.void'::regtype",
      ])
        expect(sql).toContain(token);
      expect(sql).toContain(`current_user='${role}'`);
      expect(sql).toContain(`r.rolname='${role}'`);
      expect(materialRoleCheckSQL(role, { session: false })).not.toContain(
        'session_user=current_user',
      );
      for (const table of [
        'signals',
        'signal_versions',
        'signal_publication_state',
        'candidate_reviews',
      ])
        expect(materialRoleColumns[role][table]).toBeUndefined();
    }
    expect(() => materialRoleCheckSQL('neondb_owner')).toThrow('not_configured');
  });
  it('fails closed for missing, unsafe, or ambiguous catalog results and never grants at runtime', async () => {
    for (const rows of [[], [{ safe: false }], [{ safe: null }], [{ safe: true }, { safe: true }]])
      await expect(
        assertMaterialRole({ query: async () => ({ rows }) }, 'hzense_material_registrar'),
      ).rejects.toThrow('not_configured');
    await assertMaterialRole(
      {
        query: async (sql) => {
          expect(sql).not.toMatch(/(?:GRANT|ALTER)\s+(?:ROLE|TABLE|SELECT|INSERT|UPDATE)/);
          return { rows: [{ safe: true }] };
        },
      },
      'hzense_material_verifier',
    );
  });
  it('keeps manual provisioning exactly aligned with the role matrix without granting existing readers', async () => {
    const sql = await readFile(
      new URL('../../../db/roles/configure_material_registration.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toBe(materialRoleProvisionSQL());
    expect(sql).toContain("name='0023_candidate_materials.sql'");
    expect(sql).toContain('COMMIT;');
    expect(sql).not.toMatch(
      /CREATE ROLE|PASSWORD|TO hzense_(?:candidate_reviewer|runtime_reader|signal_admin_reader)/,
    );
    expect(
      sql.match(
        /GRANT EXECUTE ON FUNCTION public\.hzense_lock_material_dependencies\(uuid,text\)/g,
      ),
    ).toHaveLength(2);
    for (const [role, tables] of Object.entries(materialRoleColumns))
      for (const [table, privileges] of Object.entries(tables))
        for (const [privilege, columns] of Object.entries(privileges))
          expect(sql).toContain(
            `GRANT ${privilege} (${columns.join(',')}) ON public.${table} TO ${role};`,
          );
  });
  it('creates empty restricted roles without generating or printing a credential', async () => {
    const sql = await readFile(
      new URL('../../../db/roles/create_material_registration_roles.sql', import.meta.url),
      'utf8',
    );
    expect(sql.match(/CREATE ROLE hzense_material_/g)).toHaveLength(2);
    expect(sql.match(/CONNECTION LIMIT 2 PASSWORD NULL/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /PASSWORD\s+'|gen_random_uuid|SECRET|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/,
    );
    expect(sql).toContain(
      'NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
  });
});
