import console from 'node:console';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { migrationLockKeys, runMigrations } from '../src/migrate.mjs';
import { publicMaintenanceFailure } from '../../../.github/scripts/production-maintenance.mjs';

const mocks = vi.hoisted(() => ({ client: undefined }));
vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function () {
      return mocks.client;
    }),
  },
}));

const directory = new URL('../../../db/migrations/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('checksums.json', directory), 'utf8'));
const names = Object.keys(manifest).sort();
const pendingName = names.at(-1);
const pendingSql = readFileSync(new URL(pendingName, directory), 'utf8');
const appliedRows = names.slice(0, -1).map((name) => ({ name, checksum: manifest[name] }));
const connectionString = 'postgresql://fixture:synthetic-private-password@fixture.invalid/fixture';
const privateError = () =>
  Object.assign(new Error(`synthetic-private-idle-error ${connectionString}`), {
    code: '08006',
    detail: 'synthetic-private-provider-detail',
  });
const settle = (promise) =>
  promise.then(
    () => ({ success: true }),
    (error) => ({ error }),
  );

describe('migration connection errors during asynchronous approval hooks', () => {
  let client;
  let logged;
  const queries = () => client.query.mock.calls.map(([query]) => query);
  const ledgerWrites = () =>
    queries().filter((query) => query.includes('INSERT INTO hzense_schema_migrations'));
  const emitIdleError = () => {
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => client.emit('error', privateError())).not.toThrow();
  };
  const expectBoundedFailure = (error) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Migration connection became unavailable');
    expect(error.cause).toBeUndefined();
    expect(error.code).toBeUndefined();
    const receipt = publicMaintenanceFailure(error);
    expect(receipt).toEqual({ status: 'failed', category: 'database-or-contract-check-failed' });
    for (const secret of ['fixture.invalid', 'synthetic-private', connectionString]) {
      expect(JSON.stringify([error, receipt, logged.mock.calls])).not.toContain(secret);
      expect(error.stack).not.toContain(secret);
    }
    expect(pg.Client).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    client = Object.assign(new EventEmitter(), {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (query) => {
        if (query.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (query === 'SELECT name, checksum FROM hzense_schema_migrations ORDER BY name') {
          return { rows: appliedRows };
        }
        return { rows: [] };
      }),
    });
    mocks.client = client;
  });

  afterEach(() => logged.mockRestore());

  it('installs its nonthrowing error listener before connect and closes a failed connection', async () => {
    client.connect.mockImplementation(async () => emitIdleError());
    const { error } = await settle(runMigrations({ connectionString }));
    expectBoundedFailure(error);
    expect(queries()).toEqual([]);
  });

  it('closes a rejected connect without creating another connection', async () => {
    const error = new Error('connection rejected');
    client.connect.mockRejectedValue(error);
    expect(await settle(runMigrations({ connectionString }))).toEqual({ error });
    expect(client.end).toHaveBeenCalledOnce();
    expect(pg.Client).toHaveBeenCalledOnce();
    expect(queries()).toEqual([]);
  });

  it.each(['beforeMigrate', 'beforeApply'])(
    'handles an externally emitted idle error while %s is suspended without migration writes',
    async (hookName) => {
      let enter;
      let release;
      const entered = new Promise((resolve) => {
        enter = resolve;
      });
      const suspended = new Promise((resolve) => {
        release = resolve;
      });
      const hook = vi.fn(async (...args) => {
        enter(args);
        await suspended;
      });
      const completion = settle(runMigrations({ connectionString, [hookName]: hook }));
      const args = await entered;
      try {
        if (hookName === 'beforeMigrate') expect(args[0]).toBe(client);
        else {
          expect(args[0]).toEqual([pendingName]);
          expect(Object.isFrozen(args[1].migrations)).toBe(true);
          expect(queries()).toContain('SELECT pg_try_advisory_lock($1, $2) AS locked');
        }
        // This is emitted by the test outside the awaited hook, like a socket
        // error while GitHub freshness checks are in flight. A listener must
        // consume it synchronously; no async rejection can hide an uncaught emit.
        emitIdleError();
      } finally {
        release();
      }
      const { error } = await completion;
      expectBoundedFailure(error);
      expect(hook).toHaveBeenCalledOnce();
      expect(queries()).not.toContain('BEGIN');
      expect(queries()).not.toContain(pendingSql);
      expect(ledgerWrites()).toEqual([]);
      if (hookName === 'beforeApply') {
        expect(client.query).toHaveBeenLastCalledWith(
          'SELECT pg_advisory_unlock($1, $2)',
          migrationLockKeys,
        );
      } else expect(queries()).toEqual([]);
    },
  );

  it('does not leak a rejected approval hook when an idle error occurred simultaneously', async () => {
    const { error } = await settle(
      runMigrations({
        connectionString,
        beforeApply: async () => {
          emitIdleError();
          throw privateError();
        },
      }),
    );
    expectBoundedFailure(error);
    expect(queries()).not.toContain('BEGIN');
    expect(queries()).not.toContain(pendingSql);
    expect(ledgerWrites()).toEqual([]);
  });

  it.each(['BEGIN', 'migration', 'ledger', 'COMMIT'])(
    'stops after a transaction %s idle failure and never retries the transaction',
    async (stage) => {
      const original = client.query.getMockImplementation();
      const matches = (query) =>
        stage === 'migration'
          ? query === pendingSql
          : stage === 'ledger'
            ? query.includes('INSERT INTO hzense_schema_migrations')
            : query === stage;
      client.query.mockImplementation(async (query, params) => {
        const value = await original(query, params);
        if (matches(query)) emitIdleError();
        return value;
      });
      const { error } = await settle(runMigrations({ connectionString }));
      expectBoundedFailure(error);
      expect(queries().filter((query) => query === 'BEGIN')).toHaveLength(1);
      expect(queries().filter((query) => query === 'ROLLBACK')).toHaveLength(1);
      expect(queries().filter(matches)).toHaveLength(1);
      if (stage === 'BEGIN') expect(queries()).not.toContain(pendingSql);
      if (['BEGIN', 'migration'].includes(stage)) expect(ledgerWrites()).toEqual([]);
      if (stage !== 'COMMIT') expect(queries()).not.toContain('COMMIT');
      expect(client.query).toHaveBeenLastCalledWith(
        'SELECT pg_advisory_unlock($1, $2)',
        migrationLockKeys,
      );
    },
  );

  it('keeps idle failure bounded if both the query and rollback reject with sensitive errors', async () => {
    const original = client.query.getMockImplementation();
    client.query.mockImplementation(async (query, params) => {
      if (query === pendingSql) {
        emitIdleError();
        throw privateError();
      }
      if (query === 'ROLLBACK') throw privateError();
      return original(query, params);
    });
    const { error } = await settle(runMigrations({ connectionString }));
    expectBoundedFailure(error);
    expect(ledgerWrites()).toEqual([]);
    expect(queries().filter((query) => query === pendingSql)).toHaveLength(1);
    expect(queries().filter((query) => query === 'ROLLBACK')).toHaveLength(1);
    expect(queries()).not.toContain('COMMIT');
  });

  it('preserves ordinary SQL failure semantics when no idle error happened', async () => {
    const original = client.query.getMockImplementation();
    const sqlError = Object.assign(new Error('fixture constraint rejected'), { code: '23514' });
    client.query.mockImplementation(async (query, params) => {
      if (query === pendingSql) throw sqlError;
      return original(query, params);
    });
    const { error } = await settle(runMigrations({ connectionString }));
    expect(error.message).toBe(`Migration ${pendingName} failed: fixture constraint rejected`);
    expect(error.cause).toBe(sqlError);
    expect(queries()).toContain('ROLLBACK');
    expect(ledgerWrites()).toEqual([]);
    expect(queries()).not.toContain('COMMIT');
    expect(client.end).toHaveBeenCalledOnce();
    expect(pg.Client).toHaveBeenCalledOnce();
  });

  it('retains the listener throughout end and reports a late failure instead of success', async () => {
    client.end.mockImplementation(async () => {
      emitIdleError();
      throw privateError();
    });
    const { error } = await settle(runMigrations({ connectionString }));
    expectBoundedFailure(error);
    expect(queries()).toContain('COMMIT');
    expect(queries().filter((query) => query === pendingSql)).toHaveLength(1);
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => client.emit('error', privateError())).not.toThrow();
  });
});
