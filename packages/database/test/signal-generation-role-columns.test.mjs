import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { signalGenerationRoleColumns } from '../src/signal-generation-role-columns.mjs';
import {
  assertGenerationRole,
  assertGenerationRoleProvisioned,
} from '../src/signal-generation-role.mjs';

const configure = await readFile(
  new URL('../../../db/roles/configure_generation_admin.sql', import.meta.url),
  'utf8',
);
const create = await readFile(
  new URL('../../../db/roles/create_generation_admin.sql', import.meta.url),
  'utf8',
);
it('pins provisioning and verifier to the shared exact column contract', () => {
  const pinned = JSON.parse(configure.match(/allowed_columns jsonb := '([^']+)'::jsonb/)[1]);
  expect(pinned).toEqual({ signal_generation_runs: signalGenerationRoleColumns });
  const grants = [
    ...configure.matchAll(/^GRANT (.+) ON public\.(\w+) TO hzense_generation_admin;$/gm),
  ];
  expect(grants).toHaveLength(1);
  expect(grants[0].slice(1)).toEqual([
    Object.entries(signalGenerationRoleColumns)
      .map(([p, cols]) => `${p}(${cols.join(',')})`)
      .join(','),
    'signal_generation_runs',
  ]);
  expect(configure).toContain(
    `a.grantee=target)<>${Object.values(signalGenerationRoleColumns).flat().length}`,
  );
});
it('pins the reviewed 0015 checksum and separates credential creation from grants', async () => {
  const migration = await readFile(
    new URL('../../../db/migrations/0015_signal_generation.sql', import.meta.url),
  );
  expect(configure).toContain(
    `name='0015_signal_generation.sql' AND checksum='${createHash('sha256').update(migration).digest('hex')}'`,
  );
  expect(configure).not.toMatch(/(?:CREATE|ALTER) ROLE|PASSWORD %L/);
  expect(create).not.toMatch(/^GRANT |^ALTER ROLE /m);
  expect(create).toContain("current_database()<>'neondb'");
  expect(create).toContain("session_user<>'neondb_owner'");
  expect(create).toContain("pg_get_userbyid(m.grantor)='cloud_admin'");
  expect(create).toContain('already exists; stop without rotating or overwriting its password');
});
it.each([assertGenerationRole, assertGenerationRoleProvisioned])(
  'fails closed before reading the shared contract for a mismatched identity',
  async (check) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ safe: false }] });
    await expect(check({ query })).rejects.toThrow('generation_role_invalid');
    expect(query).toHaveBeenCalledTimes(1);
  },
);
it.each([false, null, undefined])(
  'fails closed on a missing or unsafe catalog result: %s',
  async (safe) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ safe: true }] })
      .mockResolvedValueOnce({ rows: safe === undefined ? [] : [{ safe }] });
    await expect(assertGenerationRoleProvisioned({ query })).rejects.toThrow(
      'generation_role_invalid',
    );
  },
);
