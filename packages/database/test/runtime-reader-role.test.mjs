import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const roleSqlPath = resolve(process.cwd(), '../../db/roles/configure_runtime_reader.sql');

async function roleSql() {
  return readFile(roleSqlPath, 'utf8');
}

describe('Runtime reader role configuration contract', () => {
  it('is secret-free, transactional and does not attempt cluster role administration', async () => {
    const sql = await roleSql();
    const executableSql = sql.replace(/^--.*$/gm, '');

    expect(sql).toMatch(/^-- HZense Runtime Topic projection reader privilege contract\./);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql).toMatch(/\nCOMMIT;\n?$/);
    expect(sql.indexOf('SET LOCAL search_path = pg_catalog, pg_temp;')).toBeLessThan(
      sql.indexOf('pg_try_advisory_xact_lock'),
    );
    expect(
      sql.indexOf("current_setting('hzense.runtime_acl_backup_reference', true)"),
    ).toBeLessThan(sql.indexOf("'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC'"));
    expect(sql.indexOf("'hzense.runtime_acl_reviewed_fingerprint'")).toBeLessThan(
      sql.indexOf("'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC'"),
    );
    expect(sql).toContain("backup_reference !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("reviewed_fingerprint !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('backup_reference = repeat(substr(backup_reference, 1, 1), 64)');
    expect(sql).toContain('reviewed_fingerprint = repeat(substr(reviewed_fingerprint, 1, 1), 64)');
    expect(sql).toContain('target_database name := current_database()');
    expect(sql).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
    expect(executableSql).not.toMatch(/^\s*CREATE\s+ROLE\b/im);
    expect(executableSql).not.toMatch(/^\s*ALTER\s+ROLE\b/im);
    expect(executableSql).not.toMatch(/\bPASSWORD\b/i);
    expect(executableSql).not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  it('requires the fixed provider-provisioned role, read-only default and owner baseline', async () => {
    const sql = await roleSql();

    expect(sql).toContain("WHERE role_info.rolname = 'hzense_runtime'");
    expect(sql).toContain('runtime_role.rolconnlimit <> 20');
    for (const attribute of [
      'rolcanlogin',
      'rolinherit',
      'rolsuper',
      'rolcreatedb',
      'rolcreaterole',
      'rolreplication',
      'rolbypassrls',
    ]) {
      expect(sql).toContain(`runtime_role.${attribute}`);
    }
    expect(sql).toContain('membership_info.member = runtime_role.oid');
    expect(sql).toContain('membership_info.roleid = runtime_role.oid');
    expect(sql.match(/pg_get_userbyid\(membership_info\.member\) = 'neondb_owner'/g)).toHaveLength(
      2,
    );
    expect(sql.match(/pg_get_userbyid\(membership_info\.grantor\) = 'cloud_admin'/g)).toHaveLength(
      2,
    );
    expect(sql.match(/membership_info\.admin_option/g)).toHaveLength(2);
    expect(sql.match(/NOT membership_info\.inherit_option/g)).toHaveLength(2);
    expect(sql.match(/NOT membership_info\.set_option/g)).toHaveLength(2);
    expect(sql.match(/NOT membership_info\.set_option\n\s+\) IS NOT TRUE/g)).toHaveLength(2);
    expect(sql).toContain('hzense_runtime has an unsafe incoming or outgoing role membership');
    expect(sql).toContain("ARRAY['default_transaction_read_only=on']::text[]");
    expect(sql).toContain("configured_value.value LIKE 'default_transaction_read_only=%'");
    expect(sql).toContain('database_owner IS DISTINCT FROM current_user');
    expect(sql.match(/database_info\.oid <> target_database_oid/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datallowconn/g)).toHaveLength(2);
    expect(sql).toContain(
      'Provider/cluster administrator must remove unsafe hzense_runtime privileges from every other connectable database',
    );
    expect(sql).toContain("name = '0002_topic_projection.sql'");
    expect(sql.match(/FROM pg_inherits AS inheritance_info/g)).toHaveLength(2);
    expect(sql).toContain(
      'Runtime reader forbids PostgreSQL table inheritance in application schemas',
    );
  });

  it('allows only the exact Neon postgres and template1 provider-reserved database contracts', async () => {
    const sql = await roleSql();

    expect(sql.match(/pg_get_userbyid\(database_info\.datdba\) = 'cloud_admin'/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datconnlimit = -1/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datname = 'postgres'/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datname = 'template1'/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datacl IS NULL/g)).toHaveLength(2);
    expect(sql.match(/database_info\.datacl IS NOT NULL/g)).toHaveLength(2);
    expect(sql.match(/ARRAY\['CONNECT', 'TEMPORARY'\]::text\[\]/g)).toHaveLength(2);
    expect(sql.match(/ARRAY\['CONNECT'\]::text\[\]/g)).toHaveLength(2);
    expect(sql).toContain('hzense_runtime has unsafe privileges on another connectable database');
    expect(sql).not.toContain("database_info.datname = 'neondb'");
  });

  it('grants only the five reviewed Topic columns and no migration-history access', async () => {
    const sql = await roleSql();
    const executableSql = sql.replace(/^--.*$/gm, '');

    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;');
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM hzense_runtime;',
    );
    expect(sql).toContain('REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM PUBLIC');
    expect(sql).toMatch(
      /GRANT SELECT \(id, title, parent_id, status, runtime_enabled\)\n\s+ON TABLE public\.topics TO hzense_runtime;/,
    );
    expect(executableSql).not.toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.topics/i);
    expect(executableSql).not.toMatch(/GRANT[^;]*hzense_schema_migrations/i);
    expect(executableSql).not.toMatch(/GRANT[^;]*metadata/i);
    expect(executableSql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)/i,
    );
    expect(executableSql).not.toMatch(/^\s*GRANT[^;\n]*WITH\s+GRANT\s+OPTION/im);
  });

  it('installs only CONNECT, schema USAGE and topic_status USAGE around the column grant', async () => {
    const sql = await roleSql();

    expect(sql).toContain(
      "format(\n    'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC'",
    );
    expect(sql).toContain("'GRANT CONNECT ON DATABASE %I TO %I'");
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;');
    expect(sql).toContain('GRANT USAGE ON SCHEMA public TO hzense_runtime;');
    expect(sql).toContain('DO $hzense_runtime_enum_types$');
    expect(sql).toContain("'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM PUBLIC'");
    expect(sql).toContain("enum_info.typtype = 'e'");
    expect(sql).toContain('GRANT USAGE ON TYPE public.topic_status TO hzense_runtime;');
    expect(sql).toContain('hzense_runtime must not have USAGE on other application enum Types');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;');
    expect(sql).toContain('hzense_runtime must not receive table-level privileges');
    expect(sql).toMatch(
      /AND \(\n\s+has_table_privilege\('hzense_runtime', table_info\.oid, privilege_info\.privilege\)\n\s+OR has_table_privilege\(/,
    );
    expect(sql).toContain(
      'hzense_runtime has column privileges outside the five non-grantable Topic SELECT grants',
    );
  });

  it('closes application routines and future grants while documenting the extension exception', async () => {
    const sql = await roleSql();

    expect(sql).toContain('Provider-owned SECURITY INVOKER extension routines');
    expect(sql).toContain("extension_dependency.deptype = 'e'");
    expect(sql).toContain("extension_info.extname <> 'vector'");
    expect(sql.match(/routine_info\.proowner = extension_info\.extowner/g)).toHaveLength(2);
    expect(sql.match(/extension_info\.extversion = '0\.8\.6'/g)).toHaveLength(2);
    expect(sql.match(/pg_get_userbyid\(routine_info\.proowner\) = 'cloud_admin'/g)).toHaveLength(2);
    expect(sql.match(/pg_get_userbyid\(extension_info\.extowner\) = 'neondb_owner'/g)).toHaveLength(
      2,
    );
    expect(sql).toContain(
      "namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    );
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON ROUTINE %I.%I(%s) FROM PUBLIC');
    expect(sql).toContain('routine_info.prosecdef');
    expect(sql).toContain("'EXECUTE WITH GRANT OPTION'");
    expect(sql).toContain('hzense_runtime must not receive direct routine grants');
    for (const objectType of ['TABLES', 'SEQUENCES']) {
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON ${objectType} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON ${objectType} FROM hzense_runtime;`);
    }
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES\n\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/);
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES\n\s+REVOKE EXECUTE ON FUNCTIONS FROM hzense_runtime;/,
    );
    expect(sql).toContain("default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')");
  });
});
