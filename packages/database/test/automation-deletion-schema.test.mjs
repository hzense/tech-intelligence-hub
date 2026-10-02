import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertAutomationRole,
  automationConfigDeletionAvailable,
  automationDeletionCapabilities,
  automationRoleColumns,
  automationUpdateColumns,
} from '../src/automation-role.mjs';
import { automationChecks, automationColumns } from '../src/automation-catalog.mjs';

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const oldCapabilities = Object.entries(automationRoleColumns).flatMap(([table, columns]) =>
  columns.flatMap((column) => [
    `${table}|${column}|SELECT`,
    `${table}|${column}|INSERT`,
    ...(automationUpdateColumns[table].includes(column) ? [`${table}|${column}|UPDATE`] : []),
  ]),
);

function roleClient({ column = false, extra = [], missing = [], unsafe = false } = {}) {
  const capabilities = [...oldCapabilities, ...extra].filter((value) => !missing.includes(value));
  return {
    async query(sql) {
      if (sql.includes("a.attname='deleted_at'"))
        return { rows: column === false ? [] : [{ safe: column === true }] };
      if (sql.includes('current_user AS name'))
        return { rows: [{ name: 'hzense_automation_admin', safe: true }] };
      if (sql.includes('AS unsafe')) return { rows: [{ unsafe }] };
      if (sql.includes('AS grantable'))
        return {
          rows: capabilities.map((value) => {
            const [table_name, column_name, privilege] = value.split('|');
            return { schema: 'public', table_name, column_name, privilege, grantable: false };
          }),
        };
      return { rows: [] };
    },
  };
}

describe('automation configuration deletion schema and least privilege transition', () => {
  it('pins 0027 without changing the frozen 0026 capabilities', async () => {
    const migration = await read('db/migrations/0027_automation_config_deletion.sql');
    const checksums = JSON.parse(await read('db/migrations/checksums.json'));
    expect(checksums['0027_automation_config_deletion.sql']).toBe(
      createHash('sha256').update(migration).digest('hex'),
    );
    expect(oldCapabilities).toHaveLength(82);
    expect(automationDeletionCapabilities).toEqual([
      'automation_configs|deleted_at|SELECT',
      'automation_configs|deleted_at|UPDATE',
    ]);
    expect(automationColumns.automation_configs.deleted_at).toEqual([
      'timestamp with time zone',
      false,
    ]);
    expect(automationChecks.automation_configs).toHaveLength(4);
    expect(migration).toContain("(config -> 'enabled') IS NOT DISTINCT FROM 'false'::jsonb");
    expect(migration).toContain('NOT enabled AND next_run_at IS NULL');
    expect(migration).not.toMatch(/\b(?:DROP|DELETE|GRANT|INSERT|UPDATE)\b/);
  });

  it('keeps 0026 storage available and refuses wrong column shape', async () => {
    await expect(automationConfigDeletionAvailable(roleClient())).resolves.toBe(false);
    await expect(assertAutomationRole(roleClient())).resolves.toEqual({ canDelete: false });
    await expect(
      automationConfigDeletionAvailable(roleClient({ column: 'wrong-type' })),
    ).rejects.toThrow('automation_role_invalid');
    await expect(
      assertAutomationRole(roleClient({ extra: automationDeletionCapabilities })),
    ).rejects.toThrow('automation_role_invalid');
  });

  it('requires both new column grants once 0027 exists and never falls back to 82', async () => {
    await expect(automationConfigDeletionAvailable(roleClient({ column: true }))).resolves.toBe(
      true,
    );
    await expect(assertAutomationRole(roleClient({ column: true }))).rejects.toThrow(
      'automation_role_invalid',
    );
    await expect(
      assertAutomationRole(roleClient({ column: true, extra: automationDeletionCapabilities })),
    ).resolves.toEqual({ canDelete: true });
    for (const capability of automationDeletionCapabilities) {
      await expect(
        assertAutomationRole(roleClient({ column: true, extra: [capability] })),
      ).rejects.toThrow('automation_role_invalid');
    }
  });

  it('rejects INSERT deleted_at, mutable tables and unrelated privileges', async () => {
    for (const additional of [
      'automation_configs|deleted_at|INSERT',
      'automation_configs|deleted_at|REFERENCES',
      'other_private_table|id|SELECT',
    ]) {
      await expect(
        assertAutomationRole(
          roleClient({ column: true, extra: [...automationDeletionCapabilities, additional] }),
        ),
      ).rejects.toThrow('automation_role_invalid');
    }
    await expect(
      assertAutomationRole(
        roleClient({ column: true, extra: automationDeletionCapabilities, unsafe: true }),
      ),
    ).rejects.toThrow('automation_role_invalid');
    await expect(
      assertAutomationRole(
        roleClient({
          column: true,
          extra: automationDeletionCapabilities,
          missing: ['automation_runs|id|SELECT'],
        }),
      ),
    ).rejects.toThrow('automation_role_invalid');
  });

  it('grants only the two added rights in an independently guarded upgrade', async () => {
    const sql = (await read('db/roles/upgrade_automation_config_deletion.sql'))
      .replace(/^--.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    const manifest = JSON.parse(await read('db/migrations/checksums.json'));
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain('pg_try_advisory_xact_lock(1215921955, 1298498925)');
    expect(sql).toContain('session_user <> current_user');
    expect(sql).toContain("name='0027_automation_config_deletion.sql'");
    expect(sql).toContain(`checksum='${manifest['0027_automation_config_deletion.sql']}'`);
    expect(sql.match(/\bGRANT SELECT/g)).toHaveLength(1);
    expect(sql).toContain(
      'GRANT SELECT (deleted_at), UPDATE (deleted_at) ON public.automation_configs TO hzense_automation_admin;',
    );
    expect(sql).not.toMatch(/\b(?:REVOKE|CREATE ROLE|ALTER ROLE|PASSWORD|DROP|DELETE FROM)\b/);
    expect(sql).toContain('FOR pass IN 0..1 LOOP');
    expect(sql).toContain('actual_capabilities IS DISTINCT FROM expected_capabilities');
    expect(sql).toContain("p.privilege||' WITH GRANT OPTION'");
    expect(sql).toContain('NOT p.is_grantable');
  });
});
