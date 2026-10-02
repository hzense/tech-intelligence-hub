import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { automationRoleColumns, automationUpdateColumns } from '../src/automation-role.mjs';

const statementsFor = async (name) =>
  (await readFile(new URL(`../../../db/roles/${name}.sql`, import.meta.url), 'utf8'))
    .replace(/^--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
const creation = await statementsFor('create_automation_config_admin');
const statements = await statementsFor('configure_automation_config_admin');

describe('admin-only automation configuration provisioning SQL', () => {
  it('creates only the new restricted admin without a password or public reader', () => {
    expect(creation.match(/CREATE ROLE /g)).toHaveLength(1);
    expect(creation).toContain(
      'CREATE ROLE hzense_automation_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;',
    );
    for (const sql of [creation, statements]) {
      expect(sql).not.toMatch(/hzense_insight_reader|published_topic_insights/);
      expect(sql).not.toMatch(/\b(?:ALTER|DROP) ROLE\b|\bREVOKE\b|ALTER DEFAULT PRIVILEGES/);
    }
    expect(creation).not.toMatch(/\bGRANT\b/);
    expect(statements).not.toMatch(/CREATE ROLE|PASSWORD/);
  });

  it('uses a separate authenticated Neon role creator without application table access', () => {
    expect(creation).toContain("current_database() <> 'neondb'");
    expect(creation).toContain("session_user <> 'neondb_owner'");
    expect(creation).toContain('current_user <> session_user');
    expect(creation).toContain('pg_get_userbyid(datdba) = current_user');
    expect(creation).toContain('rolname = current_user AND rolcreaterole AND NOT rolsuper');
    expect(creation).toContain("SET LOCAL createrole_self_grant = '';");
    expect(creation).not.toMatch(/hzense_schema_migrations|public\.automation_|0026/);
    expect(creation.indexOf('Automation admin role already exists')).toBeLessThan(
      creation.indexOf('CREATE ROLE hzense_automation_admin'),
    );
    expect(creation.indexOf('Unexpected automation admin membership')).toBeGreaterThan(
      creation.indexOf('CREATE ROLE hzense_automation_admin'),
    );
    expect(creation).toContain(
      '(SELECT count(*) FROM pg_auth_members WHERE member = target OR roleid = target) <> 1',
    );
    expect(creation).toContain("pg_get_userbyid(m.member) = 'neondb_owner'");
    expect(creation).toContain("pg_get_userbyid(m.grantor) = 'cloud_admin' AND m.admin_option");
    expect(creation).toContain('NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE');
  });

  it('fences each authority in its own transaction and requires the actual hzense owner for grants', () => {
    for (const sql of [creation, statements]) {
      expect(sql.startsWith('BEGIN;')).toBe(true);
      expect(sql.endsWith('COMMIT;')).toBe(true);
      expect(sql).toContain('SET LOCAL search_path = pg_catalog, pg_temp;');
      expect(sql).toContain("SET LOCAL statement_timeout = '20s';");
    }
    expect(statements).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
    expect(statements).toContain("current_database() <> 'hzense'");
    expect(statements).toContain('session_user <> current_user');
    expect(statements).toContain(
      'current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())',
    );
    expect(statements).not.toContain('rolname = current_user AND rolcreaterole');
    expect(statements).toContain("name = '0026_automation_tasks.sql'");
    for (const table of Object.keys(automationRoleColumns))
      expect(statements).toContain(`to_regclass('public.${table}') IS NULL`);
    expect(statements.indexOf('Unsafe ambient privileges')).toBeLessThan(
      statements.indexOf('GRANT CONNECT'),
    );
  });

  it('retains empty-role and inherited authority checks before granting anything', () => {
    expect(statements).toContain('SELECT * INTO STRICT target FROM pg_roles');
    for (const catalog of ['pg_auth_members', 'pg_db_role_setting', 'pg_shdepend'])
      expect(statements).toContain(`FROM ${catalog}`);
    expect(statements).toContain('NOT m.inherit_option AND NOT m.set_option');
    expect(statements).toContain("deptype IN ('o', 'a')");
    expect(statements).toContain(
      "has_database_privilege(target.oid, current_database(), 'CREATE,TEMPORARY')",
    );
    expect(statements).toContain("has_schema_privilege(target.oid, oid, 'CREATE')");
    expect(statements).toContain('has_sequence_privilege(target.oid, c.oid');
    expect(statements).toContain('has_table_privilege(target.oid, c.oid');
    expect(statements).toContain('has_any_column_privilege(target.oid, c.oid');
  });

  it('grants only CONNECT, public USAGE and exact column capabilities of two private tables', () => {
    const grantStatements = statements.slice(0, statements.indexOf('DO $verify_acl$'));
    expect(grantStatements.match(/\bGRANT\b/g)).toHaveLength(4);
    expect(statements).toContain(
      "format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), target.rolname)",
    );
    expect(statements).toContain('GRANT USAGE ON SCHEMA public TO hzense_automation_admin;');
    expect(statements).not.toMatch(/\bGRANT\s+(?:ALL|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i);
    expect(grantStatements).not.toContain('WITH GRANT OPTION');
    for (const [table, columns] of Object.entries(automationRoleColumns)) {
      const grants = statements.match(
        new RegExp(
          `GRANT SELECT \\(([^)]+)\\), INSERT \\(([^)]+)\\), UPDATE \\(([^)]+)\\) ON public\\.${table} TO hzense_automation_admin;`,
        ),
      );
      expect(grants, table).not.toBeNull();
      const list = (value) => value.split(',').map((part) => part.trim());
      expect(list(grants[1]), `${table} SELECT`).toEqual(columns);
      expect(list(grants[2]), `${table} INSERT`).toEqual(columns);
      expect(list(grants[3]), `${table} UPDATE`).toEqual(automationUpdateColumns[table]);
    }
  });

  it('compares every effective and direct privilege before committing any grant', () => {
    const verification = statements.slice(statements.indexOf('DO $verify_acl$'));
    expect(statements.indexOf('DO $verify_acl$')).toBeGreaterThan(
      statements.indexOf('ON public.automation_runs TO hzense_automation_admin;'),
    );
    expect(verification.endsWith('$verify_acl$; COMMIT;')).toBe(true);
    expect(verification).toContain('IS DISTINCT FROM expected');
    expect(verification).toContain("checked_privilege || ' WITH GRANT OPTION'");
    expect(verification).toContain("CASE WHEN relation_info.relkind = 'S' THEN 'S'::\"char\"");
    expect(verification.match(/EXCEPT ALL/g)).toHaveLength(2);
    expect(verification).toContain('FROM actual_acl WHERE NOT is_grantable');
    expect(verification).toContain('Automation admin direct column ACL contract mismatch');
    expect(verification).toContain('Automation admin database privilege contract mismatch');
    expect(verification).toContain('Automation admin schema privilege contract mismatch');
    const dictionaries = [...verification.matchAll(/\$columns\$(.*?)\$columns\$::jsonb/g)].map(
      ([, value]) => JSON.parse(value),
    );
    expect(dictionaries).toEqual([automationRoleColumns, automationUpdateColumns]);
  });

  it('rejects ambient defaults, cross-database access and business functions without repairing ACLs', () => {
    const verification = statements.slice(statements.indexOf('DO $verify_acl$'));
    expect(verification).toContain('FROM pg_default_acl');
    expect(verification).toContain('a.grantee IN (0, target)');
    expect(verification).toContain('d.datname <> current_database() AND d.datallowconn');
    expect(verification).toContain("pg_get_userbyid(d.datdba) = 'cloud_admin'");
    expect(verification).toContain("d.datname = 'postgres'");
    expect(verification).toContain("d.datname = 'template1'");
    expect(verification).toContain("has_function_privilege(target, p.oid, 'EXECUTE')");
    expect(verification).toContain("e.extname = 'vector' AND e.extversion = '0.8.6'");
    expect(verification).toContain('NOT p.prosecdef AND p.proconfig IS NULL');
    expect(verification).not.toMatch(/\bREVOKE\b|ALTER DEFAULT PRIVILEGES|CREATE ROLE|ALTER ROLE/);
  });
});
