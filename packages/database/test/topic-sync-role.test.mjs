import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const roleSqlPath = resolve(process.cwd(), '../../db/roles/configure_topic_sync.sql');

async function roleSql() {
  return readFile(roleSqlPath, 'utf8');
}

describe('Topic sync role configuration contract', () => {
  it('is secret-free, transactional and scoped to the current database', async () => {
    const sql = await roleSql();
    const executableSql = sql.replace(/^--.*$/gm, '');

    expect(sql).toMatch(/^-- HZense Topic projection writer privilege contract\./);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql).toMatch(/\nCOMMIT;\n?$/);
    expect(sql).toContain('target_database name := current_database()');
    expect(sql).toContain(
      "format(\n    'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC'",
    );
    expect(sql).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
    expect(executableSql).not.toMatch(/\bPASSWORD\b/i);
    expect(executableSql).not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  it('requires the pre-provisioned fixed role and migration-owner baseline', async () => {
    const sql = await roleSql();

    expect(sql).not.toMatch(/^\s*CREATE\s+ROLE\b/im);
    expect(sql).not.toMatch(/^\s*ALTER\s+ROLE\b/im);
    expect(sql).toContain("WHERE role_info.rolname = 'hzense_topic_sync'");
    expect(sql).toContain('sync_role.rolconnlimit <> 2');
    for (const attribute of [
      'rolcanlogin',
      'rolinherit',
      'rolsuper',
      'rolcreatedb',
      'rolcreaterole',
      'rolreplication',
      'rolbypassrls',
    ]) {
      expect(sql).toContain(`sync_role.${attribute}`);
    }
    expect(sql).toContain('database_owner IS DISTINCT FROM current_user');
    expect(sql).toContain("name = '0002_topic_projection.sql'");
    expect(sql).toContain("column_info.attname = 'runtime_enabled'");
  });

  it('clears ambient ACLs before granting only the reviewed writer privileges', async () => {
    const sql = await roleSql();
    const publicSchemaRevoke = sql.indexOf('REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;');
    const tableRevoke = sql.indexOf(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM hzense_topic_sync;',
    );
    const firstGrant = sql.indexOf('GRANT USAGE ON SCHEMA public TO hzense_topic_sync;');

    expect(publicSchemaRevoke).toBeGreaterThan(0);
    expect(tableRevoke).toBeGreaterThan(publicSchemaRevoke);
    expect(firstGrant).toBeGreaterThan(publicSchemaRevoke);
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TYPE public.topic_status FROM PUBLIC;');
    expect(sql).toContain('GRANT USAGE ON TYPE public.topic_status TO hzense_topic_sync;');
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.hzense_schema_migrations TO hzense_topic_sync;',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.topics TO hzense_topic_sync;',
    );
    expect(sql).not.toMatch(/GRANT\s+(?:DELETE|TRUNCATE|CREATE|TEMPORARY|MAINTAIN)/i);
    expect(sql).not.toMatch(/^\s*GRANT[^;\n]*WITH\s+GRANT\s+OPTION/im);
  });

  it('locks down migration-owner defaults and verifies destructive privileges remain absent', async () => {
    const sql = await roleSql();

    for (const objectType of ['TABLES', 'SEQUENCES']) {
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON ${objectType} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON ${objectType} FROM hzense_topic_sync;`);
    }
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;');
    expect(sql).toContain('REVOKE USAGE ON TYPES FROM PUBLIC;');
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES\n\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES\n\s+REVOKE USAGE ON TYPES FROM PUBLIC;/);
    for (const privilege of [
      'CREATE',
      'TEMPORARY',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
      'MAINTAIN',
    ]) {
      expect(sql).toContain(`'${privilege}'`);
    }
    expect(sql).toContain("default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')");
    expect(sql).toContain('PUBLIC or hzense_topic_sync column privileges remain');
  });
});
