import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expectedSignalWriterGrants,
  inspectSignalWriterGrants,
  signalWriterInsertColumns,
  signalWriterRequiredMigration,
  signalWriterRoleName,
  signalWriterSelectTables,
} from '../src/signal-writer-contract.mjs';

const sql = await readFile(
  new URL('../../../db/roles/configure_signal_writer.sql', import.meta.url),
  'utf8',
);
const executable = sql.replace(/^--.*$/gm, '');

describe('private Signal writer privilege contract', () => {
  it('keeps the offline allowlist synchronized with the reviewed SQL', () => {
    const columns = /\$writer_columns\$([\s\S]*?)\$writer_columns\$::jsonb/.exec(sql);
    const tables = /select_tables text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
    expect(JSON.parse(columns[1])).toEqual(signalWriterInsertColumns);
    expect([...tables[1].matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(
      signalWriterSelectTables,
    );
    expect(sql).toContain(signalWriterRoleName);
    expect(sql).toContain(signalWriterRequiredMigration);
  });

  it('has no role creation, password, owner default ACL rewrite or broad revocation', () => {
    expect(executable).toMatch(/\nBEGIN;/);
    expect(executable).toMatch(/\nCOMMIT;\s*$/);
    expect(executable).not.toMatch(
      /\b(?:CREATE|ALTER)\s+ROLE\b|\bPASSWORD\b|postgres(?:ql)?:\/\//i,
    );
    expect(executable).not.toMatch(/\bREVOKE\b|ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(executable).not.toMatch(
      /\bGRANT\s+(?:UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES|CREATE|TEMPORARY|EXECUTE)\b/i,
    );
    expect(executable).not.toMatch(/WITH\s+GRANT\s+OPTION/i);
    expect(executable).toContain('session_user <> current_user');
    expect(executable).toContain('SET LOCAL search_path = pg_catalog, pg_temp');
    expect(executable).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
  });

  it('fails closed for ambient, indirect, default, cross-database and role-setting privileges', () => {
    for (const marker of [
      'pg_auth_members',
      'roleid = writer.oid',
      'pg_db_role_setting',
      'pg_shdepend',
      "deptype = 'o'",
      'pg_default_acl',
      "'TEMPORARY'",
      "'CREATE'",
      'aclexplode(col.attacl)',
      'a.is_grantable',
      "c.relkind = 'S'",
      "dep.deptype = 'e'",
      "'xid8'::regtype",
    ]) {
      expect(executable).toContain(marker);
    }
    for (const flag of [
      'rolsuper',
      'rolcreatedb',
      'rolcreaterole',
      'rolreplication',
      'rolbypassrls',
      'rolinherit',
      'rolcanlogin',
      'rolconnlimit',
    ])
      expect(executable).toContain(`writer.${flag}`);
  });

  it('excludes approval, created stamps, generated timestamps and base-entity writes', () => {
    expect(signalWriterInsertColumns.signals).not.toContain('status');
    expect(signalWriterInsertColumns.signals).toContain('source_url');
    expect(signalWriterInsertColumns.public_source_evidence).not.toContain('verification_status');
    expect(signalWriterInsertColumns.signal_version_people).not.toContain('verification_status');
    expect(signalWriterInsertColumns.signal_version_organizations).not.toContain(
      'verification_status',
    );
    expect(signalWriterInsertColumns.signal_versions).not.toContain('created_at');
    for (const columns of Object.values(signalWriterInsertColumns))
      expect(columns).not.toContain('created_xid');
    for (const table of [
      'entities',
      'sources',
      'topics',
      'relations',
      'person_profiles',
      'organization_profiles',
      'person_organization_affiliations',
      'affiliation_evidence',
      'search_documents',
      'radar_snapshots',
      'content_registry',
    ])
      expect(signalWriterInsertColumns).not.toHaveProperty(table);
    for (const table of ['search_documents', 'radar_snapshots', 'content_registry', 'relations'])
      expect(signalWriterSelectTables).not.toContain(table);
  });

  it('accepts only an exact independent copy of the direct-grant contract', () => {
    const grants = expectedSignalWriterGrants();
    expect(grants).toHaveLength(79);
    expect(inspectSignalWriterGrants(grants)).toEqual({ ok: true, problems: [] });
    grants[0].grant_option = true;
    expect(inspectSignalWriterGrants(grants).ok).toBe(false);
    expect(inspectSignalWriterGrants(expectedSignalWriterGrants()).ok).toBe(true);
  });

  it('keeps publication storage and guards outside the unchanged 79-grant writer contract', () => {
    const grants = expectedSignalWriterGrants();
    expect(grants).toHaveLength(79);
    for (const table of [
      'signal_publication_state',
      'signal_publication_outbox',
      'signal_publication_control',
      'signal_publication_tasks',
      'signal_publication_authorizations',
      'signal_publication_runs',
    ]) {
      expect(signalWriterSelectTables).not.toContain(table);
      expect(signalWriterInsertColumns).not.toHaveProperty(table);
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(
          inspectSignalWriterGrants([
            ...grants,
            { kind: 'table', object: `public.${table}`, privilege, grant_option: false },
          ]).ok,
        ).toBe(false);
      }
    }
    for (const name of [
      'hzense_guard_publication_receipt',
      'hzense_check_publication_pair',
      'hzense_guard_publication_run',
    ]) {
      expect(
        inspectSignalWriterGrants([
          ...grants,
          {
            kind: 'function',
            object: `public.${name}()`,
            privilege: 'EXECUTE',
            grant_option: false,
          },
        ]).ok,
      ).toBe(false);
    }
  });

  it.each(['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN', 'INSERT'])(
    'rejects unapproved table-level %s',
    (privilege) => {
      const grants = expectedSignalWriterGrants();
      grants.push({
        kind: 'table',
        object: 'public.signal_versions',
        privilege,
        grant_option: false,
      });
      expect(inspectSignalWriterGrants(grants).ok).toBe(false);
    },
  );

  it.each(['created_xid', 'status', 'verification_status'])(
    'rejects protected column INSERT %s',
    (column) => {
      const grants = expectedSignalWriterGrants();
      grants.push({
        kind: 'column',
        object: 'public.signal_versions',
        column,
        privilege: 'INSERT',
        grant_option: false,
      });
      expect(inspectSignalWriterGrants(grants).ok).toBe(false);
    },
  );

  it('rejects incomplete, duplicate and malformed evidence rather than treating it as verified', () => {
    const grants = expectedSignalWriterGrants();
    expect(inspectSignalWriterGrants(grants.slice(1)).ok).toBe(false);
    expect(inspectSignalWriterGrants([...grants, grants[0]]).ok).toBe(false);
    for (const invalid of [
      null,
      {},
      [null],
      [{ ...grants[0], hidden: true }],
      [{ ...grants[0], grant_option: undefined }],
    ])
      expect(inspectSignalWriterGrants(invalid).ok).toBe(false);
  });
});
