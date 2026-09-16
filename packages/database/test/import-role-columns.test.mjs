import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
import { importRoleColumns } from '../src/import-role-columns.mjs';

it('pins provisioning grants and verifier to the runtime column contract', async () => {
  const sql = await readFile(
    new URL('../../../db/roles/configure_import_admin.sql', import.meta.url),
    'utf8',
  );
  const pinned = JSON.parse(sql.match(/allowed_columns jsonb := '([^']+)'::jsonb/)[1]);
  expect(pinned).toEqual(importRoleColumns);
  const grants = [
    ...sql.matchAll(/^GRANT (.+) ON public\.(import_\w+) TO hzense_import_admin;$/gm),
  ];
  expect(grants).toHaveLength(7);
  for (const [, privileges, table] of grants) {
    expect(privileges).toBe(
      Object.entries(importRoleColumns[table])
        .map(([p, cols]) => `${p}(${cols.join(',')})`)
        .join(','),
    );
  }
});
