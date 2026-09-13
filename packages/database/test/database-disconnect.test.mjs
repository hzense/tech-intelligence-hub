import { describe, expect, it, vi } from 'vitest';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';

const observation = (disconnected) => ({ rows: [{ disconnected }] });

describe('isolated database disconnect barrier', () => {
  it('returns only after observing no connections to the exact fixture database', async () => {
    const administrator = { query: vi.fn().mockResolvedValue(observation(true)) };
    await waitForDatabaseDisconnects(administrator, 'hzense_fixture_test');
    expect(administrator.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('WHERE datname=$1'),
      ['hzense_fixture_test'],
    );
  });

  it('polls live state instead of assuming pool.end means server disconnect', async () => {
    const administrator = {
      query: vi
        .fn()
        .mockResolvedValueOnce(observation(false))
        .mockResolvedValueOnce(observation(false))
        .mockResolvedValueOnce(observation(true)),
    };
    await waitForDatabaseDisconnects(administrator, 'hzense_fixture_test');
    expect(administrator.query).toHaveBeenCalledTimes(3);
    for (const [sql, values] of administrator.query.mock.calls) {
      expect(sql).toMatch(/^SELECT NOT EXISTS/);
      expect(sql).not.toMatch(/pg_terminate_backend|DROP DATABASE|BEGIN|COMMIT/i);
      expect(values).toEqual(['hzense_fixture_test']);
    }
  });

  it('fails on remaining connections without terminating them or suppressing the failure', async () => {
    const administrator = { query: vi.fn().mockResolvedValue(observation(false)) };
    await expect(
      waitForDatabaseDisconnects(administrator, 'hzense_fixture_test', { timeoutMs: 0 }),
    ).rejects.toThrow('Isolated test database still has open connections');
    expect(administrator.query).toHaveBeenCalledTimes(1);
  });

  it('propagates query errors rather than retrying or treating them as disconnects', async () => {
    const failure = new Error('fixture observation failed');
    const administrator = { query: vi.fn().mockRejectedValue(failure) };
    await expect(waitForDatabaseDisconnects(administrator, 'hzense_fixture_test')).rejects.toBe(
      failure,
    );
    expect(administrator.query).toHaveBeenCalledTimes(1);
  });

  it.each([{ rows: [] }, observation(null), observation('true')])(
    'rejects an invalid observation %#',
    async (result) => {
      const administrator = { query: vi.fn().mockResolvedValue(result) };
      await expect(
        waitForDatabaseDisconnects(administrator, 'hzense_fixture_test'),
      ).rejects.toThrow('Invalid database connection observation');
    },
  );

  it.each([-1, Infinity, NaN])('rejects an invalid timeout %s', async (timeoutMs) => {
    const administrator = { query: vi.fn() };
    await expect(
      waitForDatabaseDisconnects(administrator, 'hzense_fixture_test', { timeoutMs }),
    ).rejects.toThrow('Invalid database disconnect timeout');
    expect(administrator.query).not.toHaveBeenCalled();
  });
});
