import { describe, expect, it, vi } from 'vitest';
import { verifyOptionalSignalAdminReaderContract } from '../src/signal-admin-reader-catalog.mjs';

describe('optional Signal reader schema contract', () => {
  it('does not require an absent reader role', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ present: false }] }) };
    await verifyOptionalSignalAdminReaderContract(client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain('pg_catalog.pg_roles');
    expect(client.query.mock.calls[0][0]).not.toContain('pg_proc');
  });
  it('executes only the reviewed post-grant assertions without the granting transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ present: true }] }) };
    await verifyOptionalSignalAdminReaderContract(client);
    expect(client.query).toHaveBeenCalledTimes(2);
    const sql = client.query.mock.calls[1][0];
    expect(sql).toMatch(/^DO \$signal_admin_reader_verify\$/);
    expect(sql).toMatch(/\$signal_admin_reader_verify\$;$/);
    expect(sql).not.toMatch(/^\s*(?:GRANT|REVOKE|ALTER|CREATE|COMMIT|ROLLBACK)\b/m);
    for (const check of [
      'pg_auth_members',
      'rolconnlimit',
      'pg_db_role_setting',
      'pg_shdepend',
      'direct column ACL',
      'another connectable database',
    ])
      expect(sql).toContain(check);
  });
  it('fails closed when optional grant detection is unavailable', async () => {
    await expect(
      verifyOptionalSignalAdminReaderContract({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
    ).rejects.toThrow('Cannot inspect');
  });
});
