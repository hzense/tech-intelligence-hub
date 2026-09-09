import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { runtimeReaderSearchColumns } from '../src/runtime-reader-preflight.mjs';

const sql = await readFile(
  resolve(process.cwd(), '../../db/roles/restore_fts_reader_acl.sql'),
  'utf8',
);
const capture = await readFile(
  resolve(process.cwd(), '../../db/roles/fts_acl_recovery_state.sql'),
  'utf8',
);
const executable = sql.replace(/^\s*--.*$/gm, '');
const shared = (text) =>
  text
    .split('-- BEGIN SHARED ACL STATE QUERY')[1]
    .split('-- END SHARED ACL STATE QUERY')[0]
    .trim()
    .replace(' INTO actual_fingerprint, category_summary', '');

describe('restricted FTS ACL recovery SQL contract (static, not a rehearsal)', () => {
  it('parenthesizes CASE inside the PL/pgSQL IF condition', () => {
    expect(sql).toMatch(
      /IF actual_fingerprint IS DISTINCT FROM\s+\(CASE WHEN pass = 1 THEN before_fingerprint ELSE after_fingerprint END\) THEN/,
    );
    expect(sql).not.toMatch(/IF actual_fingerprint IS DISTINCT FROM\s+CASE\b/);
  });

  it('uses exactly the forward reader allowlist for its only mutation', () => {
    const revokes = [
      ...executable.matchAll(/REVOKE SELECT \(([\s\S]*?)\) ON TABLE ([\w.]+) FROM (\w+) (\w+);/g),
    ];
    expect(revokes).toHaveLength(1);
    expect(
      revokes[0][1]
        .split(',')
        .map((s) => s.trim())
        .sort(),
    ).toEqual([...runtimeReaderSearchColumns].sort());
    expect(revokes[0].slice(2)).toEqual(['public.search_documents', 'hzense_runtime', 'RESTRICT']);
    expect(executable).not.toMatch(
      /\b(?:GRANT|CASCADE|TRUNCATE|DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)\s+(?:TABLE|ROLE|SCHEMA|DATABASE|FUNCTION|TYPE|ALL|DEFAULT|ON|FROM|INTO)\b/i,
    );
    expect(executable).not.toMatch(/\bEXECUTE\b/i);
    expect(executable).not.toMatch(/postgres(?:ql)?:\/\/|\bPASSWORD\b/i);
  });

  it('keeps capture and both in-transaction snapshot passes identical', () => {
    expect(shared(sql)).toEqual(shared(capture));
    expect(sql).toContain('FOR pass IN 1..2 LOOP');
    expect(sql.indexOf('catalog fingerprint mismatch')).toBeLessThan(
      sql.indexOf('REVOKE SELECT ('),
    );
    expect(sql).toContain('CASE WHEN pass = 1 THEN before_fingerprint ELSE after_fingerprint END');
    expect(shared(sql)).toContain("'format', 'hzense-fts-acl-state/v1'");
    for (const category of [
      'roles',
      'memberships',
      'role_settings',
      'databases',
      'schemas',
      'relations',
      'columns',
      'types',
      'routines',
      'default_privileges',
      'policies',
      'inheritance',
    ])
      expect(shared(sql)).toContain("'" + category + "'");
    expect(shared(sql)).toContain("to_jsonb(r) - 'rolpassword'");
    expect(shared(sql)).toContain('a.attacl::text');
    expect(shared(sql)).not.toMatch(/coalesce\([^)]*acl/i);
  });

  it('requires five non-placeholder digests, distinct targets and a bounded window', () => {
    for (const name of [
      'before_fingerprint',
      'after_fingerprint',
      'target_fingerprint',
      'production_fingerprint',
      'source_fingerprint',
      'expires_at',
    ]) {
      expect(sql).toContain("current_setting('hzense.acl_recovery." + name + "', true)");
    }
    expect(sql).toContain("digest !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain(
      'target_fingerprint IN (production_fingerprint, recovery_source_fingerprint)',
    );
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain('clock_timestamp() >= approval_expires_at');
  });

  it('refuses unregistered or user-spoofable Neon identity settings', () => {
    expect(sql).toContain("count(*) = 3 AND bool_and(context = 'postmaster' AND setting <> '')");
    for (const name of ['neon.project_id', 'neon.branch_id', 'neon.timeline_id']) {
      expect(sql).toContain("'" + name + "'");
      expect(capture).toContain("'" + name + "'");
      expect(sql).not.toContain("current_setting('" + name);
    }
    expect(sql).toContain(
      'actual_target IS NULL OR actual_target IS DISTINCT FROM target_fingerprint',
    );
    expect(sql.indexOf('-- END NEON TARGET GUARD')).toBeLessThan(sql.indexOf('LOCK TABLE'));
  });

  it('uses one transaction with no exception swallowing or external mutation hook', () => {
    expect(sql).toContain('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;');
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).toContain('SET LOCAL search_path = pg_catalog, pg_temp;');
    for (const timeout of [
      'statement_timeout',
      'lock_timeout',
      'idle_in_transaction_session_timeout',
    ])
      expect(sql).toContain('SET LOCAL ' + timeout);
    expect(sql).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
    expect(sql).toContain('IN ACCESS EXCLUSIVE MODE');
    expect(sql).toContain("pg_event_trigger WHERE evtenabled <> 'D'");
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(capture).toContain('REPEATABLE READ READ ONLY');
    expect(capture).toMatch(/ROLLBACK;\s*$/);
    expect(capture).not.toMatch(/\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|CREATE)\s/i);
  });

  it('checks authenticated ownership and effective permissions before and after revoke', () => {
    expect(sql).toContain("current_database() <> 'hzense'");
    expect(sql).toContain("current_user <> 'hzense_migrator' OR session_user <> current_user");
    expect(sql).toContain('relowner = owner_oid');
    expect(sql).toContain('m.member = runtime_role.oid');
    expect(sql).toContain('NOT m.inherit_option AND NOT m.set_option');
    expect(sql).toContain('has_table_privilege(runtime_role.oid, target_relation');
    expect(sql).toContain('has_column_privilege(runtime_role.oid, target_relation');
    expect(sql).toContain("p.privilege || ' WITH GRANT OPTION'");
    expect(sql).toContain('x.grantee = runtime_role.oid AND x.grantor = owner_oid');
    expect(sql).toContain('five-column Topic contract');
  });
});
