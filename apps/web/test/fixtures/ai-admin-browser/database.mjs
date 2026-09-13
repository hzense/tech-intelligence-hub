import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { validateConnectionTarget } from '../../../../../packages/database/src/connection-policy.mjs';
import { runMigrations } from '../../../../../packages/database/src/migrate.mjs';
import { waitForDatabaseDisconnects } from '../../../../../packages/database/test/database-disconnect.mjs';

const { Client, Pool } = pg;
const role = 'hzense_ai_admin';
const quote = (identifier) => {
  if (!/^hzense_ai_[a-z0-9_]+$/.test(identifier)) throw new Error('Unsafe fixture identifier');
  return `"${identifier}"`;
};
export async function createAiBrowserDatabase({ adminUrl, isolatedCluster }) {
  assert.equal(isolatedCluster, '1', 'Disposable PostgreSQL cluster required');
  validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = `hzense_ai_ui_${suffix}`;
  const owner = `hzense_ai_owner_ui_${suffix}`;
  const password = `fixture-only-${suffix}`;
  const administrator = new Client({ connectionString: adminUrl });
  await administrator.connect();
  let databaseCreated = false;
  const createdRoles = [];
  let pool;
  const urlFor = (user) => {
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    if (user) {
      url.username = user;
      url.password = password;
    }
    return url.toString();
  };
  async function connect(user, callback) {
    const client = new Client({ connectionString: urlFor(user) });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }
  async function close() {
    try {
      if (pool) await pool.end();
      if (databaseCreated) {
        await waitForDatabaseDisconnects(administrator, database);
        await administrator.query(`DROP DATABASE ${quote(database)}`);
      }
      for (const name of [...createdRoles].reverse())
        await administrator.query(`DROP ROLE ${quote(name)}`);
    } finally {
      await administrator.end();
    }
  }
  try {
    for (const name of [owner, role]) {
      assert.equal(
        (await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount,
        0,
        `Refuse to modify pre-existing role ${name}; run native role suites serially`,
      );
      await administrator.query(`CREATE ROLE ${quote(name)} LOGIN NOINHERIT CONNECTION LIMIT 2
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      createdRoles.push(name);
    }
    await administrator.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(owner)}`);
    databaseCreated = true;
    await connect(undefined, (client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: urlFor(owner) });
    const sql = await readFile(
      new URL('../../../../../db/roles/configure_ai_admin.sql', import.meta.url),
      'utf8',
    );
    await connect(owner, async (client) => {
      // Fixture-owned database only; do not change cluster-wide/default ACLs.
      await client.query(
        `REVOKE CREATE,TEMPORARY ON DATABASE ${quote(database)} FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      );
      await client.query(sql);
    });
    pool = new Pool({ connectionString: urlFor(role), max: 1, connectionTimeoutMillis: 5000 });
    assert.deepEqual((await pool.query('SELECT session_user,current_user')).rows[0], {
      session_user: role,
      current_user: role,
    });
    return { pool, close, owner: (callback) => connect(owner, callback) };
  } catch (error) {
    await close();
    throw error;
  }
}
