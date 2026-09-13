import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';

const { Client, Pool } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `hzense_disconnect_test_${suffix}`;
const ownerRole = `hzense_disconnect_owner_${suffix}`;
const ownerPassword = 'test-only-disconnect-regression';

function identifier(value) {
  if (!/^hzense_disconnect_(?:test|owner)_[0-9]+_[0-9]+$/.test(value))
    throw new Error('Unsafe disconnect regression fixture identifier');
  return `"${value}"`;
}
function databaseUrl() {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  url.username = ownerRole;
  url.password = ownerPassword;
  return url.toString();
}

// Test-only delay at Client.end: pg-pool removes a client from its count before
// this asynchronous close completes. Keep the real PostgreSQL socket open until
// the test explicitly releases it; no production Client or timers are patched.
class DelayedEndClient extends Client {
  holdEnd = true;
  endCallbacks = [];

  end(callback) {
    if (!this.holdEnd) return super.end(callback);
    if (typeof callback !== 'function')
      throw new Error('This fixture delays only callback-based pg-pool shutdown');
    this.endCallbacks.push(callback);
  }

  releaseEnd() {
    this.holdEnd = false;
    const callbacks = this.endCallbacks.splice(0);
    return new Promise((resolve) => {
      super.end(() => {
        for (const callback of callbacks) callback();
        resolve();
      });
    });
  }
}

const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

suite('PostgreSQL pooled connection shutdown before isolated database cleanup', () => {
  let administrator;
  let roleCreated = false;
  let databaseCreated = false;

  beforeAll(async () => {
    administrator = new Client({ connectionString: adminUrl });
    await administrator.connect();
    await administrator.query(`CREATE ROLE ${identifier(ownerRole)} LOGIN PASSWORD '${ownerPassword}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    roleCreated = true;
    await administrator.query(
      `CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier(ownerRole)}`,
    );
    databaseCreated = true;
  }, 30_000);

  afterAll(async () => {
    if (!administrator) return;
    try {
      if (databaseCreated) {
        await waitForDatabaseDisconnects(administrator, databaseName, { timeoutMs: 5000 });
        await administrator.query(`DROP DATABASE ${identifier(databaseName)}`);
      }
      if (roleCreated) await administrator.query(`DROP ROLE ${identifier(ownerRole)}`);
    } finally {
      await administrator.end();
    }
  }, 30_000);

  async function backendExists(pid) {
    const result = await administrator.query(
      'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND pid=$2) AS connected',
      [databaseName, pid],
    );
    return result.rows[0].connected;
  }

  async function delayedPool() {
    const pool = new Pool({ connectionString: databaseUrl(), Client: DelayedEndClient, max: 1 });
    const client = await pool.connect();
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    client.release();
    await pool.end();
    expect(pool.ended).toBe(true);
    expect(pool.totalCount).toBe(0);
    expect(client.endCallbacks.length).toBeGreaterThan(0);
    expect(await backendExists(pid)).toBe(true);
    return { pool, client, pid };
  }

  it('waits for the real backend after pool.end has resolved and its client count is already zero', async () => {
    const fixture = await delayedPool();
    let completion;
    let finished = false;
    const secondPoll = Promise.withResolvers();
    let polls = 0;
    const observer = {
      query: async (...args) => {
        const result = await administrator.query(...args);
        if (String(args[0]).includes('pg_stat_activity')) {
          polls += 1;
          if (polls === 2) secondPoll.resolve();
        }
        return result;
      },
    };
    try {
      completion = settle(
        waitForDatabaseDisconnects(observer, databaseName, { timeoutMs: 5000 }).then(() => {
          finished = true;
        }),
      );
      // Observing a second database poll proves the barrier did not treat
      // pool.end/count=0 as actual disconnect. No sleep assumes scheduling order.
      await Promise.race([
        secondPoll.promise,
        completion.then(() => {
          throw new Error('Disconnect barrier finished before observing the closing backend');
        }),
      ]);
      expect(finished).toBe(false);
      expect(await backendExists(fixture.pid)).toBe(true);
      await fixture.client.releaseEnd();
      expect((await completion).error).toBeUndefined();
      expect(finished).toBe(true);
      expect(await backendExists(fixture.pid)).toBe(false);
    } finally {
      if (fixture.client.holdEnd) await fixture.client.releaseEnd();
      if (completion) await completion;
    }
  });

  it('fails on a live leaked connection without terminating it or swallowing the timeout', async () => {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await expect(
        waitForDatabaseDisconnects(administrator, databaseName, { timeoutMs: 40 }),
      ).rejects.toThrow('Isolated test database still has open connections');
      expect(await backendExists(pid)).toBe(true);
      expect((await client.query('SELECT 42 AS still_alive')).rows).toEqual([{ still_alive: 42 }]);
    } finally {
      await client.end();
    }
    await waitForDatabaseDisconnects(administrator, databaseName, { timeoutMs: 5000 });
  });

  it('reproduces the former forced-cleanup race as one explicitly observed 57P01 pool error', async () => {
    const fixture = await delayedPool();
    const reported = Promise.withResolvers();
    const errors = [];
    const onError = (error, client) => {
      errors.push({ code: error.code, pid: client?.processID });
      reported.resolve();
    };
    fixture.pool.on('error', onError);
    try {
      // Reproduce only the former test cleanup, scoped to this suite's exact
      // synthetic database AND the known backend. Never used by the new helper.
      const result = await administrator.query(
        'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE datname=$1 AND pid=$2',
        [databaseName, fixture.pid],
      );
      expect(result.rows).toEqual([{ terminated: true }]);
      await reported.promise;
      await fixture.client.releaseEnd();
      await waitForDatabaseDisconnects(administrator, databaseName, { timeoutMs: 5000 });
      expect(errors).toEqual([{ code: '57P01', pid: fixture.pid }]);
    } finally {
      if (fixture.client.holdEnd) await fixture.client.releaseEnd();
      fixture.pool.removeListener('error', onError);
    }
  });
});
