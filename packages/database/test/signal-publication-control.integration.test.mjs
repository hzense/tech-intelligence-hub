import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';

const { Client, Pool } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `hzense_control_test_${suffix}`;
const ownerRole = `hzense_control_owner_${suffix}`;
const ownerPassword = 'test-only-private-controls';

function identifier(value) {
  if (!/^hzense_control_(?:test|owner)_[0-9]+_[0-9]+$/.test(value))
    throw new Error('Unsafe publication-control fixture identifier');
  return `"${value}"`;
}

function databaseUrl(asAdmin = false) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  if (!asAdmin) {
    url.username = ownerRole;
    url.password = ownerPassword;
  }
  return url.toString();
}

async function withClient(callback) {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function inTransaction(callback) {
  return withClient(async (client) => {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
      return await callback(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

// Poll observed database state: no race depends on assuming a fixed sleep is
// long enough for another real backend to acquire a lock or for a lease to end.
async function observeBlocked(observer, pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 AS blocked
       FROM pg_stat_activity WHERE pid=$1`,
      [pid],
    );
    if (result.rows[0]?.blocked) return;
    await delay(10);
  }
  throw new Error('Expected an observed PostgreSQL backend lock wait');
}

async function observeExpired(client, runId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT lease_expires_at <= clock_timestamp() AS expired
       FROM public.signal_publication_runs WHERE run_id=$1`,
      [runId],
    );
    if (result.rows[0]?.expired) return;
    await delay(10);
  }
  throw new Error('Expected the database clock to pass the fixture lease expiry');
}

async function rejectedSql(client, statement, values = []) {
  await client.query('SAVEPOINT invalid_control_change');
  try {
    await expect(client.query(statement, values)).rejects.toMatchObject({
      code: expect.stringMatching(/^(23514|23503|55000)$/),
    });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT invalid_control_change');
    await client.query('RELEASE SAVEPOINT invalid_control_change');
  }
}

suite('PostgreSQL private persisted publication controls and run leases', () => {
  let administrator;
  let pool;
  let create;
  let claim;
  let renew;
  let cancel;
  let complete;
  let lock;
  let roleCreated = false;
  let databaseCreated = false;

  beforeAll(async () => {
    ({
      createPrivatePublicationRun: create,
      claimPrivatePublicationRun: claim,
      renewPrivatePublicationRun: renew,
      cancelPrivatePublicationRun: cancel,
      completePrivatePublicationRun: complete,
      lockPrivatePublicationControls: lock,
    } = await import('../src/signal-publication-control-store.mjs'));
    administrator = new Client({ connectionString: adminUrl });
    await administrator.connect();
    await administrator.query(`CREATE ROLE ${identifier(ownerRole)} LOGIN PASSWORD '${ownerPassword}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    roleCreated = true;
    await administrator.query(
      `CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier(ownerRole)}`,
    );
    databaseCreated = true;
    const target = new Client({ connectionString: databaseUrl(true) });
    await target.connect();
    try {
      await target.query('CREATE EXTENSION vector; REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    } finally {
      await target.end();
    }
    await runMigrations({ connectionString: databaseUrl() });
    pool = new Pool({ connectionString: databaseUrl(), max: 4 });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (!administrator) return;
    try {
      if (databaseCreated) {
        await administrator.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [databaseName],
        );
        await administrator.query(`DROP DATABASE ${identifier(databaseName)}`);
      }
      if (roleCreated) await administrator.query(`DROP ROLE ${identifier(ownerRole)}`);
    } finally {
      await administrator.end();
    }
  }, 30_000);

  // Only synthetic principals and fixture-owner SQL establish these controls.
  // This suite provides no operator configuration API or Publisher identity.
  async function fixture({
    globalEnabled = true,
    taskEnabled = true,
    policy = 'auto_publish',
    originalIntent = 'auto_publish',
    canPublish = true,
    claimed = false,
    leaseSeconds = 60,
  } = {}) {
    const request = {
      run_id: randomUUID(),
      task_id: randomUUID(),
      principal_id: randomUUID(),
      original_intent: originalIntent,
    };
    await pool.query(
      'UPDATE public.signal_publication_control SET publication_enabled=$1 WHERE singleton',
      [globalEnabled],
    );
    await pool.query(
      `INSERT INTO public.signal_publication_tasks(task_id,policy,publication_enabled)
      VALUES ($1,$2,$3)`,
      [request.task_id, policy, taskEnabled],
    );
    await pool.query(
      `INSERT INTO public.signal_publication_authorizations(task_id,principal_id,can_publish)
      VALUES ($1,$2,$3)`,
      [request.task_id, request.principal_id, canPublish],
    );
    await create({ pool, request });
    const worker = { run_id: request.run_id, lease_owner: randomUUID(), fencing_token: 1 };
    if (claimed)
      await claim({
        pool,
        request: {
          run_id: worker.run_id,
          lease_owner: worker.lease_owner,
          lease_seconds: leaseSeconds,
        },
      });
    return { request, worker };
  }

  async function readRun(runId) {
    return (
      await pool.query('SELECT * FROM public.signal_publication_runs WHERE run_id=$1', [runId])
    ).rows[0];
  }

  const gate = (worker) => inTransaction((client) => lock({ client, request: worker }));
  const claimRequest = (worker, leaseSeconds = 60) => ({
    run_id: worker.run_id,
    lease_owner: worker.lease_owner,
    lease_seconds: leaseSeconds,
  });

  it('seeds disabled controls and defaults new tasks, grants and runs to a non-publishing state', async () => {
    expect((await pool.query('SELECT * FROM public.signal_publication_control')).rows).toEqual([
      { singleton: true, publication_enabled: false },
    ]);
    const taskId = randomUUID();
    const principalId = randomUUID();
    const task = (
      await pool.query(
        'INSERT INTO public.signal_publication_tasks(task_id) VALUES($1) RETURNING *',
        [taskId],
      )
    ).rows[0];
    expect(task).toMatchObject({ policy: 'preview_only', publication_enabled: false });
    const grant = (
      await pool.query(
        `INSERT INTO public.signal_publication_authorizations(task_id,principal_id)
      VALUES($1,$2) RETURNING *`,
        [taskId, principalId],
      )
    ).rows[0];
    expect(grant.can_publish).toBe(false);
    const result = await create({
      pool,
      request: {
        run_id: randomUUID(),
        task_id: taskId,
        principal_id: principalId,
        original_intent: 'preview_only',
      },
    });
    expect(result).toMatchObject({
      outcome: 'created',
      run: {
        status: 'pending',
        fencing_token: 0,
        lease_owner: null,
        lease_expires_at: null,
        original_intent: 'preview_only',
      },
    });
  });

  it('replays only the same persisted run identity without granting or claiming anything', async () => {
    const { request } = await fixture();
    const before = await readRun(request.run_id);
    expect(await create({ pool, request })).toMatchObject({ outcome: 'replayed', run: before });
    for (const change of [
      { task_id: randomUUID() },
      { principal_id: randomUUID() },
      { original_intent: 'preview_only' },
    ]) {
      await expect(create({ pool, request: { ...request, ...change } })).rejects.toMatchObject({
        code: 'run_identity_conflict',
      });
    }
    expect(await readRun(request.run_id)).toEqual(before);
  });

  it.each([
    [{ globalEnabled: false }, 'publication_disabled'],
    [{ taskEnabled: false }, 'task_disabled'],
    [{ policy: 'review_required' }, 'policy_disallows_publication'],
    [{ policy: 'preview_only' }, 'policy_disallows_publication'],
    [{ originalIntent: 'review_required' }, 'intent_disallows_publication'],
    [{ originalIntent: 'preview_only' }, 'intent_disallows_publication'],
    [{ canPublish: false }, 'authorization_revoked'],
  ])('refuses a claim from persisted controls %j', async (options, code) => {
    const { request, worker } = await fixture(options);
    await expect(claim({ pool, request: claimRequest(worker) })).rejects.toMatchObject({ code });
    expect(await readRun(request.run_id)).toMatchObject({
      status: 'pending',
      fencing_token: 0,
      lease_owner: null,
    });
    // Caller claims must never convert a stored deny into a lease or gate pass.
    await expect(
      claim({
        pool,
        request: {
          ...claimRequest(worker),
          authorized: true,
          can_publish: true,
          publication_enabled: true,
          policy: 'auto_publish',
        },
      }),
    ).rejects.toThrow();
    await expect(gate({ ...worker, authorized: true, can_publish: true })).rejects.toThrow();
  });

  it('claims, renews and completes a bounded lease while keeping publication tables empty', async () => {
    const { request, worker } = await fixture();
    expect(await claim({ pool, request: claimRequest(worker, 30) })).toMatchObject({
      outcome: 'claimed',
      run: { status: 'running', fencing_token: 1, lease_owner: worker.lease_owner },
    });
    const initial = await readRun(request.run_id);
    const controls = await gate(worker);
    expect(controls).toMatchObject({
      scope: 'private_control_only',
      run_id: request.run_id,
      task_id: request.task_id,
      principal_id: request.principal_id,
      fencing_token: 1,
    });
    for (const key of ['authorized', 'ready', 'public_ready', 'eligible'])
      expect(controls).not.toHaveProperty(key);
    expect(await renew({ pool, request: { ...worker, lease_seconds: 120 } })).toMatchObject({
      outcome: 'renewed',
    });
    expect((await readRun(request.run_id)).lease_expires_at.getTime()).toBeGreaterThan(
      initial.lease_expires_at.getTime(),
    );
    await pool.query(
      'UPDATE public.signal_publication_control SET publication_enabled=false WHERE singleton',
    );
    expect(await complete({ pool, request: worker })).toMatchObject({
      outcome: 'completed',
      run: { status: 'completed', fencing_token: 1, lease_owner: null, lease_expires_at: null },
    });
    for (const table of [
      'signals',
      'signal_versions',
      'signal_publication_state',
      'signal_publication_outbox',
      'search_documents',
    ]) {
      expect(
        (await pool.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count,
      ).toBe(0);
    }
  });

  it('rejects absent transactions and stale repeatable-read snapshots', async () => {
    const { worker } = await fixture({ claimed: true });
    await withClient(async (client) => {
      await expect(lock({ client, request: worker })).rejects.toMatchObject({
        code: 'transaction_required',
      });
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        await expect(lock({ client, request: worker })).rejects.toMatchObject({
          code: 'unsupported_isolation',
        });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('fails closed without the singleton and preserves the task/principal referenced by a run', async () => {
    const { request, worker } = await fixture({ claimed: true });
    await inTransaction(async (client) => {
      await rejectedSql(
        client,
        'DELETE FROM public.signal_publication_authorizations WHERE task_id=$1 AND principal_id=$2',
        [request.task_id, request.principal_id],
      );
      await rejectedSql(client, 'DELETE FROM public.signal_publication_tasks WHERE task_id=$1', [
        request.task_id,
      ]);
      await client.query('DELETE FROM public.signal_publication_control WHERE singleton');
      await expect(lock({ client, request: worker })).rejects.toMatchObject({
        code: 'control_not_found',
      });
    });
    expect(await gate(worker)).toMatchObject({ scope: 'private_control_only' });
  });

  it('can cancel an existing run after committed singleton loss while its publication gate fails closed', async () => {
    const { request, worker } = await fixture({ claimed: true });
    try {
      // Commit the fixture configuration loss before calling primitives that
      // each obtain a separate connection and own their own transaction.
      await pool.query('DELETE FROM public.signal_publication_control WHERE singleton');
      await expect(gate(worker)).rejects.toMatchObject({ code: 'control_not_found' });
      expect(await cancel({ pool, request: { run_id: request.run_id } })).toMatchObject({
        outcome: 'cancelled',
        run: { status: 'cancelled', fencing_token: 1, lease_owner: null, lease_expires_at: null },
      });
      expect(await readRun(request.run_id)).toMatchObject({ status: 'cancelled' });
      await expect(gate(worker)).rejects.toMatchObject({ code: 'control_not_found' });
    } finally {
      await pool.query(`INSERT INTO public.signal_publication_control(singleton,publication_enabled)
        VALUES(true,true) ON CONFLICT(singleton) DO UPDATE SET publication_enabled=EXCLUDED.publication_enabled`);
    }
    await expect(gate(worker)).rejects.toMatchObject({ code: 'run_not_running' });
  });

  it('rejects out-of-range or non-integer lease durations without changing a pending run', async () => {
    const { request, worker } = await fixture();
    const before = await readRun(request.run_id);
    for (const duration of [0, -1, 901, 1.5, '60', null]) {
      await expect(claim({ pool, request: claimRequest(worker, duration) })).rejects.toMatchObject({
        code: 'invalid_control_request',
      });
    }
    expect(await readRun(request.run_id)).toEqual(before);
  });

  it('rejects active reclaims, wrong owners, stale fencing tokens and shortening renewals', async () => {
    const { request, worker } = await fixture({ claimed: true, leaseSeconds: 120 });
    const before = await readRun(request.run_id);
    await expect(claim({ pool, request: claimRequest(worker) })).rejects.toMatchObject({
      code: 'lease_active',
    });
    for (const [change, code] of [
      [{ lease_owner: randomUUID() }, 'lease_owner_mismatch'],
      [{ fencing_token: 2 }, 'stale_fencing_token'],
    ]) {
      await expect(gate({ ...worker, ...change })).rejects.toMatchObject({ code });
      await expect(
        renew({ pool, request: { ...worker, ...change, lease_seconds: 180 } }),
      ).rejects.toMatchObject({ code });
      await expect(complete({ pool, request: { ...worker, ...change } })).rejects.toMatchObject({
        code,
      });
    }
    await expect(renew({ pool, request: { ...worker, lease_seconds: 1 } })).rejects.toMatchObject({
      code: 'lease_not_extended',
    });
    expect(await readRun(request.run_id)).toEqual(before);
  });

  it('expires by the database clock, denies renewal and completion, then fences out the old owner', async () => {
    const { request, worker } = await fixture({ claimed: true, leaseSeconds: 1 });
    await withClient((client) => observeExpired(client, request.run_id));
    await expect(gate(worker)).rejects.toMatchObject({ code: 'lease_expired' });
    await expect(renew({ pool, request: { ...worker, lease_seconds: 60 } })).rejects.toMatchObject({
      code: 'lease_expired',
    });
    await expect(complete({ pool, request: worker })).rejects.toMatchObject({
      code: 'lease_expired',
    });
    const successor = { ...worker, lease_owner: randomUUID(), fencing_token: 2 };
    expect(await claim({ pool, request: claimRequest(successor) })).toMatchObject({
      outcome: 'claimed',
      run: { fencing_token: 2, lease_owner: successor.lease_owner },
    });
    await expect(gate(worker)).rejects.toThrow();
    await expect(gate({ ...successor, fencing_token: 1 })).rejects.toMatchObject({
      code: 'stale_fencing_token',
    });
    expect(await gate(successor)).toMatchObject({
      scope: 'private_control_only',
      fencing_token: 2,
    });
  }, 10_000);

  it.each([false, true])(
    'cancels a pending/running run with switches disabled (claimed=%s) and forbids resurrection',
    async (claimed) => {
      const { request, worker } = await fixture({ claimed });
      await pool.query(
        'UPDATE public.signal_publication_control SET publication_enabled=false WHERE singleton',
      );
      expect(await cancel({ pool, request: { run_id: request.run_id } })).toMatchObject({
        outcome: 'cancelled',
        run: {
          status: 'cancelled',
          lease_owner: null,
          lease_expires_at: null,
          fencing_token: claimed ? 1 : 0,
        },
      });
      expect(await cancel({ pool, request: { run_id: request.run_id } })).toMatchObject({
        outcome: 'replayed',
      });
      await pool.query(
        'UPDATE public.signal_publication_control SET publication_enabled=true WHERE singleton',
      );
      await expect(claim({ pool, request: claimRequest(worker) })).rejects.toMatchObject({
        code: 'run_terminal',
      });
      await expect(gate(worker)).rejects.toMatchObject({ code: 'run_not_running' });
    },
  );

  it('enforces immutable identity, lifecycle and lease shape against direct SQL, including replica mode', async () => {
    const { request, worker } = await fixture({ claimed: true });
    await inTransaction(async (client) => {
      for (const [statement, values] of [
        [
          'UPDATE public.signal_publication_runs SET run_id=$2 WHERE run_id=$1',
          [request.run_id, randomUUID()],
        ],
        [
          'UPDATE public.signal_publication_runs SET task_id=$2 WHERE run_id=$1',
          [request.run_id, randomUUID()],
        ],
        [
          'UPDATE public.signal_publication_runs SET principal_id=$2 WHERE run_id=$1',
          [request.run_id, randomUUID()],
        ],
        [
          "UPDATE public.signal_publication_runs SET original_intent='preview_only' WHERE run_id=$1",
          [request.run_id],
        ],
        [
          "UPDATE public.signal_publication_runs SET created_at=created_at+interval '1 second' WHERE run_id=$1",
          [request.run_id],
        ],
        [
          'UPDATE public.signal_publication_runs SET fencing_token=fencing_token+1 WHERE run_id=$1',
          [request.run_id],
        ],
        [
          'UPDATE public.signal_publication_runs SET fencing_token=fencing_token+2 WHERE run_id=$1',
          [request.run_id],
        ],
        [
          'UPDATE public.signal_publication_runs SET lease_owner=$2 WHERE run_id=$1',
          [request.run_id, randomUUID()],
        ],
        [
          "UPDATE public.signal_publication_runs SET lease_expires_at=date_trunc('milliseconds',clock_timestamp())+interval '16 minutes' WHERE run_id=$1",
          [request.run_id],
        ],
        [
          "UPDATE public.signal_publication_runs SET lease_expires_at=lease_expires_at-interval '1 second' WHERE run_id=$1",
          [request.run_id],
        ],
        [
          'UPDATE public.signal_publication_runs SET lease_owner=NULL WHERE run_id=$1',
          [request.run_id],
        ],
        [
          "UPDATE public.signal_publication_runs SET status='pending',fencing_token=0,lease_owner=NULL,lease_expires_at=NULL WHERE run_id=$1",
          [request.run_id],
        ],
        ['DELETE FROM public.signal_publication_runs WHERE run_id=$1', [request.run_id]],
        ['TRUNCATE public.signal_publication_runs', []],
        [
          "INSERT INTO public.signal_publication_runs(run_id,task_id,principal_id,original_intent,status,fencing_token,lease_owner,lease_expires_at) VALUES($1,$2,$3,'auto_publish','running',1,$4,date_trunc('milliseconds',clock_timestamp())+interval '1 minute')",
          [randomUUID(), request.task_id, request.principal_id, worker.lease_owner],
        ],
      ])
        await rejectedSql(client, statement, values);
    });
    const replica = new Client({ connectionString: databaseUrl(true) });
    await replica.connect();
    try {
      await replica.query('BEGIN; SET LOCAL session_replication_role=replica');
      await rejectedSql(replica, 'DELETE FROM public.signal_publication_runs WHERE run_id=$1', [
        request.run_id,
      ]);
      await rejectedSql(replica, 'TRUNCATE public.signal_publication_runs');
      await rejectedSql(
        replica,
        "UPDATE public.signal_publication_runs SET original_intent='preview_only' WHERE run_id=$1",
        [request.run_id],
      );
    } finally {
      await replica.query('ROLLBACK');
      await replica.end();
    }
    expect(await gate(worker)).toMatchObject({ scope: 'private_control_only' });
  });

  it('rejects direct expired renewal and terminal resurrection while preserving the permanent run', async () => {
    const { request } = await fixture({ claimed: true, leaseSeconds: 1 });
    await withClient((client) => observeExpired(client, request.run_id));
    await inTransaction(async (client) => {
      await rejectedSql(
        client,
        "UPDATE public.signal_publication_runs SET lease_expires_at=date_trunc('milliseconds',clock_timestamp())+interval '1 minute' WHERE run_id=$1",
        [request.run_id],
      );
      await rejectedSql(
        client,
        "UPDATE public.signal_publication_runs SET status='completed',lease_owner=NULL,lease_expires_at=NULL WHERE run_id=$1",
        [request.run_id],
      );
    });
    await cancel({ pool, request: { run_id: request.run_id } });
    await inTransaction(async (client) => {
      await rejectedSql(
        client,
        "UPDATE public.signal_publication_runs SET status='running',fencing_token=fencing_token+1,lease_owner=$2,lease_expires_at=date_trunc('milliseconds',clock_timestamp())+interval '1 minute' WHERE run_id=$1",
        [request.run_id, randomUUID()],
      );
      await rejectedSql(client, 'DELETE FROM public.signal_publication_runs WHERE run_id=$1', [
        request.run_id,
      ]);
    });
  }, 10_000);

  const mutations = [
    [
      'global disable',
      'UPDATE public.signal_publication_control SET publication_enabled=false WHERE singleton',
      () => [],
      'publication_disabled',
    ],
    [
      'task disable',
      'UPDATE public.signal_publication_tasks SET publication_enabled=false WHERE task_id=$1',
      (request) => [request.task_id],
      'task_disabled',
    ],
    [
      'policy downgrade',
      "UPDATE public.signal_publication_tasks SET policy='preview_only' WHERE task_id=$1",
      (request) => [request.task_id],
      'policy_disallows_publication',
    ],
    [
      'authorization revoke',
      'UPDATE public.signal_publication_authorizations SET can_publish=false WHERE task_id=$1 AND principal_id=$2',
      (request) => [request.task_id, request.principal_id],
      'authorization_revoked',
    ],
    [
      'cancellation',
      "UPDATE public.signal_publication_runs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL WHERE run_id=$1",
      (request) => [request.run_id],
      'run_not_running',
    ],
  ];

  it.each(mutations)(
    'observes a committed %s after waiting for its real row lock',
    async (_label, sql, values, code) => {
      const { request, worker } = await fixture({ claimed: true });
      const changer = await pool.connect();
      const checker = await pool.connect();
      let pending;
      try {
        const changerPid = (await changer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const checkerPid = (await checker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        expect(checkerPid).not.toBe(changerPid);
        await changer.query('BEGIN');
        await changer.query(sql, values(request));
        await checker.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        pending = settle(lock({ client: checker, request: worker }));
        await observeBlocked(changer, checkerPid);
        await changer.query('COMMIT');
        expect((await pending).error).toMatchObject({ code });
        await expect(
          renew({ pool, request: { ...worker, lease_seconds: 120 } }),
        ).rejects.toMatchObject({ code });
      } finally {
        await changer.query('ROLLBACK');
        await pending;
        await checker.query('ROLLBACK');
        changer.release();
        checker.release();
      }
    },
    10_000,
  );

  it.each(mutations)(
    'keeps %s blocked until the gate transaction releases its locks',
    async (_label, sql, values, code) => {
      const { request, worker } = await fixture({ claimed: true });
      const checker = await pool.connect();
      const changer = await pool.connect();
      let pending;
      try {
        const changerPid = (await changer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await checker.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        expect(await lock({ client: checker, request: worker })).toMatchObject({
          scope: 'private_control_only',
        });
        pending = settle(changer.query(sql, values(request)));
        await observeBlocked(checker, changerPid);
        await checker.query('COMMIT');
        expect((await pending).error).toBeUndefined();
        await expect(gate(worker)).rejects.toMatchObject({ code });
      } finally {
        await checker.query('ROLLBACK');
        await pending;
        checker.release();
        changer.release();
      }
    },
    10_000,
  );

  it('uses the database clock after lock waits rather than the transaction start time', async () => {
    const { request, worker } = await fixture();
    const blocker = await pool.connect();
    const checker = await pool.connect();
    let pending;
    try {
      const checkerPid = (await checker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await claim({ pool, request: claimRequest(worker, 2) });
      await blocker.query('BEGIN');
      await blocker.query('SELECT singleton FROM public.signal_publication_control FOR UPDATE');
      await checker.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      expect(
        (
          await checker.query(
            'SELECT transaction_timestamp()<lease_expires_at AS live FROM public.signal_publication_runs WHERE run_id=$1',
            [request.run_id],
          )
        ).rows[0].live,
      ).toBe(true);
      pending = settle(lock({ client: checker, request: worker }));
      await observeBlocked(blocker, checkerPid);
      await observeExpired(blocker, request.run_id);
      await blocker.query('COMMIT');
      expect((await pending).error).toMatchObject({ code: 'lease_expired' });
    } finally {
      await blocker.query('ROLLBACK');
      await pending;
      await checker.query('ROLLBACK');
      blocker.release();
      checker.release();
    }
  }, 10_000);

  it('serializes two actual claimers to one winner and one active-lease rejection', async () => {
    const { request, worker } = await fixture();
    const firstPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const secondPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const blocker = await pool.connect();
    const pending = [];
    try {
      const firstPid = (await firstPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const secondPid = (await secondPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect(firstPid).not.toBe(secondPid);
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT run_id FROM public.signal_publication_runs WHERE run_id=$1 FOR UPDATE',
        [request.run_id],
      );
      pending.push(settle(claim({ pool: firstPool, request: claimRequest(worker) })));
      await observeBlocked(blocker, firstPid);
      pending.push(
        settle(
          claim({
            pool: secondPool,
            request: claimRequest({ ...worker, lease_owner: randomUUID() }),
          }),
        ),
      );
      await observeBlocked(blocker, secondPid);
      await blocker.query('COMMIT');
      const results = await Promise.all(pending);
      expect(results[0].value).toMatchObject({
        outcome: 'claimed',
        run: { fencing_token: 1, lease_owner: worker.lease_owner },
      });
      expect(results[1].error).toMatchObject({ code: 'lease_active' });
      expect(await readRun(request.run_id)).toMatchObject({
        fencing_token: 1,
        lease_owner: worker.lease_owner,
      });
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.all(pending);
      blocker.release();
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  }, 15_000);

  it('serializes claims for two runs of one task to one active lease', async () => {
    const { request, worker } = await fixture();
    const otherRequest = { ...request, run_id: randomUUID() };
    const otherWorker = { ...worker, run_id: otherRequest.run_id, lease_owner: randomUUID() };
    await create({ pool, request: otherRequest });
    const firstPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const secondPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const blocker = await pool.connect();
    const pending = [];
    try {
      const firstPid = (await firstPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const secondPid = (await secondPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect(firstPid).not.toBe(secondPid);
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT run_id FROM public.signal_publication_runs WHERE run_id=$1 FOR UPDATE',
        [request.run_id],
      );
      pending.push(settle(claim({ pool: firstPool, request: claimRequest(worker) })));
      await observeBlocked(blocker, firstPid);
      pending.push(settle(claim({ pool: secondPool, request: claimRequest(otherWorker) })));
      await observeBlocked(blocker, secondPid);
      await blocker.query('COMMIT');
      const results = await Promise.all(pending);
      expect(results[0].value).toMatchObject({ outcome: 'claimed' });
      expect(results[1].error).toMatchObject({ code: 'task_lease_active' });
      expect(await readRun(otherRequest.run_id)).toMatchObject({
        status: 'pending',
        fencing_token: 0,
      });
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.all(pending);
      blocker.release();
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  }, 15_000);

  it('allows another run of the same task after the active run is cancelled', async () => {
    const { request, worker } = await fixture({ claimed: true });
    const otherRequest = { ...request, run_id: randomUUID() };
    const otherWorker = { ...worker, run_id: otherRequest.run_id, lease_owner: randomUUID() };
    await create({ pool, request: otherRequest });
    await expect(claim({ pool, request: claimRequest(otherWorker) })).rejects.toMatchObject({
      code: 'task_lease_active',
    });
    await cancel({ pool, request: { run_id: request.run_id } });
    expect(await claim({ pool, request: claimRequest(otherWorker) })).toMatchObject({
      outcome: 'claimed',
      run: { run_id: otherRequest.run_id, fencing_token: 1, lease_owner: otherWorker.lease_owner },
    });
  });
});
