import { describe, expect, it, vi } from 'vitest';
import {
  cancelPrivatePublicationRun,
  claimPrivatePublicationRun,
  completePrivatePublicationRun,
  createPrivatePublicationRun,
  lockPrivatePublicationControls,
  renewPrivatePublicationRun,
} from '../src/signal-publication-control-store.mjs';
import { controlMaximumFence } from '../src/signal-publication-control.mjs';

const runId = '00000000-0000-0000-0000-000000000001';
const taskId = '00000000-0000-0000-0000-000000000002';
const principalId = '00000000-0000-0000-0000-000000000003';
const ownerId = '00000000-0000-0000-0000-000000000004';
const otherId = '00000000-0000-0000-0000-000000000005';
const now = new Date('2026-09-13T10:00:00.000Z');
const createRequest = {
  run_id: runId,
  task_id: taskId,
  principal_id: principalId,
  original_intent: 'auto_publish',
};
const claimRequest = { run_id: runId, lease_owner: ownerId, lease_seconds: 60 };
const leaseRequest = { run_id: runId, lease_owner: ownerId, fencing_token: 1 };

function run(overrides = {}) {
  return {
    ...createRequest,
    status: 'running',
    fencing_token: 1,
    lease_owner: ownerId,
    lease_expires_at: new Date(now.getTime() + 30_000),
    created_at: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

function pending(overrides = {}) {
  return run({
    status: 'pending',
    fencing_token: 0,
    lease_owner: null,
    lease_expires_at: null,
    ...overrides,
  });
}

function fakePool(options = {}) {
  const statements = [];
  const failure = options.failure ?? new Error('Injected SQL failure');
  let creating = false;
  let stored = options.run ?? run();
  const client = {
    query: vi.fn(async (statement, values) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      statements.push({ sql, values });
      if (options.fail?.(sql)) throw failure;
      if (sql.includes('pg_advisory_xact_lock')) creating = true;
      if (sql.includes("current_setting('transaction_isolation')")) {
        return { rows: [{ isolation: options.isolation ?? 'read committed' }] };
      }
      if (sql.includes('FROM public.signal_publication_control ')) {
        return {
          rows:
            options.missing === 'control' ? [] : [{ publication_enabled: options.enabled ?? true }],
        };
      }
      if (sql.includes('FROM public.signal_publication_tasks ')) {
        return {
          rows:
            options.missing === 'task'
              ? []
              : [
                  {
                    task_id: taskId,
                    policy: options.policy ?? 'auto_publish',
                    publication_enabled: options.taskEnabled ?? true,
                  },
                ],
        };
      }
      if (sql.includes('FROM public.signal_publication_authorizations ')) {
        return {
          rows:
            options.missing === 'authorization'
              ? []
              : [
                  {
                    task_id: taskId,
                    principal_id: principalId,
                    can_publish: options.canPublish ?? true,
                  },
                ],
        };
      }
      if (sql.startsWith('SELECT task_id, principal_id')) {
        return {
          rows:
            options.missing === 'run'
              ? []
              : [{ task_id: stored.task_id, principal_id: stored.principal_id }],
        };
      }
      if (sql.startsWith('SELECT run_id FROM public.signal_publication_runs')) {
        return { rows: options.otherActive ? [{ run_id: otherId }] : [] };
      }
      if (sql.includes('FROM public.signal_publication_runs')) {
        if (options.missing === 'run') return { rows: [] };
        if (creating && !sql.endsWith('FOR UPDATE'))
          return { rows: options.existing ? [options.existing] : [] };
        return { rows: creating ? [options.existing ?? stored] : [stored] };
      }
      if (sql === 'SELECT pg_catalog.clock_timestamp() AS now')
        return { rows: [{ now: options.now ?? now }] };
      if (sql.startsWith('INSERT INTO public.signal_publication_runs')) {
        if (options.existing) return { rows: [], rowCount: 0 };
        stored = pending({
          run_id: values[0],
          task_id: values[1],
          principal_id: values[2],
          original_intent: values[3],
        });
        return { rows: [stored], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE public.signal_publication_runs')) {
        if (options.updateRows === 0) return { rows: [], rowCount: 0 };
        if (sql.includes("SET status = 'running'")) {
          stored = {
            ...stored,
            status: 'running',
            fencing_token: stored.fencing_token + 1,
            lease_owner: values[1],
            lease_expires_at: values[2],
          };
        } else if (sql.includes('SET lease_expires_at')) {
          stored = { ...stored, lease_expires_at: values[3] };
        } else {
          stored = {
            ...stored,
            status: sql.includes("SET status = 'cancelled'") ? 'cancelled' : 'completed',
            lease_owner: null,
            lease_expires_at: null,
          };
        }
        return { rows: [stored], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, statements, failure };
}

const operations = [
  ['create', createPrivatePublicationRun, createRequest],
  ['claim', claimPrivatePublicationRun, claimRequest],
  ['renew', renewPrivatePublicationRun, { ...leaseRequest, lease_seconds: 60 }],
  ['cancel', cancelPrivatePublicationRun, { run_id: runId }],
  ['complete', completePrivatePublicationRun, leaseRequest],
];

function writes(statements) {
  return statements.filter(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql));
}

describe('private publication control adapter transaction ownership', () => {
  it.each(operations)(
    '%s validates all caller fields before borrowing a connection',
    async (_name, operation, request) => {
      const { pool } = fakePool();
      await expect(
        operation({ pool, request: { ...request, authorized: true } }),
      ).rejects.toMatchObject({ code: 'invalid_control_request' });
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );

  it('locks global, task, authorization and run before reading the database clock', async () => {
    const { pool, statements, client } = fakePool({ run: pending() });
    await claimPrivatePublicationRun({ pool, request: claimRequest });
    const sql = statements.map((row) => row.sql);
    const global = sql.findIndex((value) =>
      value.includes('FROM public.signal_publication_control '),
    );
    const task = sql.findIndex((value) => value.includes('FROM public.signal_publication_tasks '));
    const authorization = sql.findIndex((value) =>
      value.includes('FROM public.signal_publication_authorizations '),
    );
    const lockedRun = sql.findIndex(
      (value) =>
        value.includes('FROM public.signal_publication_runs') && value.endsWith('FOR UPDATE'),
    );
    const clock = sql.indexOf('SELECT pg_catalog.clock_timestamp() AS now');
    expect(global).toBeLessThan(task);
    expect(task).toBeLessThan(authorization);
    expect(authorization).toBeLessThan(lockedRun);
    expect(lockedRun).toBeLessThan(clock);
    expect(sql[global]).toContain('FOR SHARE');
    expect(sql[task]).toContain('FOR UPDATE');
    expect(sql[authorization]).toContain('FOR SHARE');
    expect(sql.join('\n')).not.toContain('KEY SHARE');
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(sql).toContain('SET LOCAL search_path = pg_catalog, pg_temp');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(sql.join('\n')).not.toContain(runId);
    expect(sql.join('\n')).not.toMatch(/signal_publication_(state|outbox)/);
  });

  it.each([
    ['control', 'control_not_found'],
    ['task', 'task_not_found'],
    ['authorization', 'authorization_not_found'],
    ['run', 'run_not_found'],
  ])('rolls back a missing %s row before any mutation', async (missing, code) => {
    const { pool, statements, client } = fakePool({ missing });
    await expect(claimPrivatePublicationRun({ pool, request: claimRequest })).rejects.toMatchObject(
      { code },
    );
    expect(writes(statements)).toEqual([]);
    expect(statements.at(-1).sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it.each([
    ['update', (sql) => sql.startsWith('UPDATE')],
    ['commit', (sql) => sql === 'COMMIT'],
    ['commit and rollback', (sql) => sql === 'COMMIT' || sql === 'ROLLBACK'],
  ])('preserves %s failure and discards the borrowed connection', async (_label, fail) => {
    const { pool, statements, client, failure } = fakePool({ fail });
    await expect(cancelPrivatePublicationRun({ pool, request: { run_id: runId } })).rejects.toBe(
      failure,
    );
    expect(statements.at(-1).sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('discards a failed BEGIN without trying a rollback for an unstarted transaction', async () => {
    const { pool, statements, client, failure } = fakePool({
      fail: (sql) => sql.startsWith('BEGIN'),
    });
    await expect(cancelPrivatePublicationRun({ pool, request: { run_id: runId } })).rejects.toBe(
      failure,
    );
    expect(statements).toHaveLength(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('rolls back a mutation that unexpectedly changed no locked run', async () => {
    const { pool, statements } = fakePool({ updateRows: 0 });
    await expect(
      cancelPrivatePublicationRun({ pool, request: { run_id: runId } }),
    ).rejects.toMatchObject({ code: 'run_changed' });
    expect(statements.at(-1).sql).toBe('ROLLBACK');
  });
});

describe('private durable publication run lifecycle', () => {
  it('creates a pending preview intent even with publication disabled and authorization false', async () => {
    const { pool, statements } = fakePool({
      enabled: false,
      taskEnabled: false,
      canPublish: false,
    });
    const request = { ...createRequest, original_intent: 'preview_only' };
    const result = await createPrivatePublicationRun({ pool, request });
    expect(result).toMatchObject({
      outcome: 'created',
      run: {
        ...request,
        status: 'pending',
        fencing_token: 0,
        lease_owner: null,
        lease_expires_at: null,
      },
    });
    const insert = writes(statements)[0];
    expect(insert.sql).not.toContain('created_at) VALUES');
    expect(insert.values).toEqual([runId, taskId, principalId, 'preview_only']);
  });

  it('replays the existing terminal run without resurrecting its original pending state', async () => {
    const existing = pending({ status: 'cancelled' });
    const { pool, statements } = fakePool({ existing });
    expect(await createPrivatePublicationRun({ pool, request: createRequest })).toEqual({
      outcome: 'replayed',
      run: existing,
    });
    expect(
      writes(statements).every(({ sql }) => sql.startsWith('INSERT') && sql.includes('DO NOTHING')),
    ).toBe(true);
  });

  it.each(['task_id', 'principal_id', 'original_intent'])(
    'rejects immutable %s reuse before locking different parents',
    async (field) => {
      const existing = pending({ [field]: field === 'original_intent' ? 'preview_only' : otherId });
      const { pool, statements } = fakePool({ existing });
      await expect(
        createPrivatePublicationRun({ pool, request: createRequest }),
      ).rejects.toMatchObject({ code: 'run_identity_conflict' });
      expect(writes(statements)).toEqual([]);
      expect(
        statements.some(({ sql }) => sql.includes('FROM public.signal_publication_control ')),
      ).toBe(false);
    },
  );

  it('claims a pending run using the post-lock database clock and first fence', async () => {
    const { pool, statements } = fakePool({ run: pending() });
    const result = await claimPrivatePublicationRun({ pool, request: claimRequest });
    expect(result).toMatchObject({
      outcome: 'claimed',
      run: {
        status: 'running',
        fencing_token: 1,
        lease_owner: ownerId,
        lease_expires_at: new Date(now.getTime() + 60_000),
      },
    });
    expect(writes(statements)[0].values).toEqual([
      runId,
      ownerId,
      new Date(now.getTime() + 60_000),
      0,
    ]);
  });

  it('reclaims an attempt exactly at expiry with a new owner and higher fence', async () => {
    const { pool } = fakePool({ run: run({ lease_expires_at: now }) });
    const result = await claimPrivatePublicationRun({
      pool,
      request: { ...claimRequest, lease_owner: otherId },
    });
    expect(result).toMatchObject({
      outcome: 'claimed',
      run: { fencing_token: 2, lease_owner: otherId },
    });
  });

  it.each([
    [{ enabled: false }, 'publication_disabled'],
    [{ taskEnabled: false }, 'task_disabled'],
    [{ policy: 'review_required' }, 'policy_disallows_publication'],
    [{ canPublish: false }, 'authorization_revoked'],
    [{ run: pending({ original_intent: 'preview_only' }) }, 'intent_disallows_publication'],
    [{ run: pending({ status: 'cancelled' }) }, 'run_terminal'],
    [
      { run: run({ status: 'completed', lease_owner: null, lease_expires_at: null }) },
      'run_terminal',
    ],
    [{ run: run() }, 'lease_active'],
    [
      { run: run({ fencing_token: controlMaximumFence, lease_expires_at: now }) },
      'fencing_exhausted',
    ],
    [{ otherActive: true }, 'task_lease_active'],
  ])('refuses a claim when controls or competing work deny it (%j)', async (options, code) => {
    const { pool, statements } = fakePool({ run: pending(), ...options });
    await expect(claimPrivatePublicationRun({ pool, request: claimRequest })).rejects.toMatchObject(
      { code },
    );
    expect(writes(statements)).toEqual([]);
    expect(statements.at(-1).sql).toBe('ROLLBACK');
  });

  it('renews a live lease without changing its fence', async () => {
    const { pool } = fakePool();
    const result = await renewPrivatePublicationRun({
      pool,
      request: { ...leaseRequest, lease_seconds: 60 },
    });
    expect(result).toMatchObject({
      outcome: 'renewed',
      run: { fencing_token: 1, lease_expires_at: new Date(now.getTime() + 60_000) },
    });
  });

  it.each([
    [{}, { lease_seconds: 30 }, 'lease_not_extended'],
    [{ canPublish: false }, {}, 'authorization_revoked'],
    [{ run: run({ lease_expires_at: now }) }, {}, 'lease_expired'],
    [{}, { lease_owner: otherId }, 'lease_owner_mismatch'],
    [{}, { fencing_token: 2 }, 'stale_fencing_token'],
  ])('denies an invalid renewal (%j, %j)', async (options, changes, code) => {
    const { pool, statements } = fakePool(options);
    await expect(
      renewPrivatePublicationRun({
        pool,
        request: { ...leaseRequest, lease_seconds: 60, ...changes },
      }),
    ).rejects.toMatchObject({ code });
    expect(writes(statements)).toEqual([]);
  });

  it('cancels work after switches or authorization are disabled and clears its lease', async () => {
    const { pool } = fakePool({ enabled: false, taskEnabled: false, canPublish: false });
    expect(await cancelPrivatePublicationRun({ pool, request: { run_id: runId } })).toMatchObject({
      outcome: 'cancelled',
      run: { status: 'cancelled', fencing_token: 1, lease_owner: null, lease_expires_at: null },
    });
  });

  it.each(['control', 'task', 'authorization'])(
    'cancels an existing run even when the %s row is missing',
    async (missing) => {
      const { pool, statements } = fakePool({ missing });
      expect(await cancelPrivatePublicationRun({ pool, request: { run_id: runId } })).toMatchObject(
        {
          outcome: 'cancelled',
          run: { status: 'cancelled', lease_owner: null, lease_expires_at: null },
        },
      );
      const queries = statements.filter(({ sql }) => sql.startsWith('SELECT'));
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('FROM public.signal_publication_runs');
      expect(queries[0].sql).toContain('FOR UPDATE');
      expect(
        statements.some(({ sql }) =>
          /signal_publication_(control|tasks|authorizations)\b|clock_timestamp/.test(sql),
        ),
      ).toBe(false);
      expect(statements.at(-1).sql).toBe('COMMIT');
    },
  );

  it('rolls back cancellation when the run itself is missing', async () => {
    const { pool, statements } = fakePool({ missing: 'run' });
    await expect(
      cancelPrivatePublicationRun({ pool, request: { run_id: runId } }),
    ).rejects.toMatchObject({
      code: 'run_not_found',
    });
    expect(writes(statements)).toEqual([]);
    expect(statements.at(-1).sql).toBe('ROLLBACK');
  });

  it('refuses cancellation of a malformed lifecycle status', async () => {
    const { pool, statements } = fakePool({ run: run({ status: 'unknown' }) });
    await expect(
      cancelPrivatePublicationRun({ pool, request: { run_id: runId } }),
    ).rejects.toMatchObject({
      code: 'invalid_control_state',
    });
    expect(writes(statements)).toEqual([]);
  });

  it('replays cancellation without updating a terminal run', async () => {
    const { pool, statements } = fakePool({ run: pending({ status: 'cancelled' }) });
    expect(await cancelPrivatePublicationRun({ pool, request: { run_id: runId } })).toMatchObject({
      outcome: 'replayed',
    });
    expect(writes(statements)).toEqual([]);
  });

  it('refuses to cancel a completed run', async () => {
    const { pool } = fakePool({
      run: run({ status: 'completed', lease_owner: null, lease_expires_at: null }),
    });
    await expect(
      cancelPrivatePublicationRun({ pool, request: { run_id: runId } }),
    ).rejects.toMatchObject({ code: 'run_terminal' });
  });

  it('completes a live attempt after switches or authorization are disabled', async () => {
    const { pool, statements } = fakePool({
      enabled: false,
      taskEnabled: false,
      canPublish: false,
    });
    expect(await completePrivatePublicationRun({ pool, request: leaseRequest })).toMatchObject({
      outcome: 'completed',
      run: { status: 'completed', fencing_token: 1, lease_owner: null, lease_expires_at: null },
    });
    expect(writes(statements)).toHaveLength(1);
    expect(writes(statements)[0].sql).toContain('UPDATE public.signal_publication_runs');
  });

  it('refuses completion by a stale attempt', async () => {
    const { pool, statements } = fakePool({ run: run({ fencing_token: 2 }) });
    await expect(
      completePrivatePublicationRun({ pool, request: leaseRequest }),
    ).rejects.toMatchObject({ code: 'stale_fencing_token' });
    expect(writes(statements)).toEqual([]);
  });
});

describe('private publication gate in a caller-owned transaction', () => {
  it('requires an explicit transaction and maps PostgreSQL autocommit failure', async () => {
    const failure = Object.assign(new Error('SAVEPOINT can only be used in transaction blocks'), {
      code: '25P01',
    });
    const { client, statements } = fakePool({
      failure,
      fail: (sql) => sql.startsWith('SAVEPOINT'),
    });
    await expect(
      lockPrivatePublicationControls({ client, request: leaseRequest }),
    ).rejects.toMatchObject({ code: 'transaction_required' });
    expect(statements).toHaveLength(1);
    expect(client.release).not.toHaveBeenCalled();
  });

  it.each(['repeatable read', 'serializable'])(
    'rejects unsupported %s isolation',
    async (isolation) => {
      const { client, statements } = fakePool({ isolation });
      await expect(
        lockPrivatePublicationControls({ client, request: leaseRequest }),
      ).rejects.toMatchObject({ code: 'unsupported_isolation' });
      expect(statements.slice(-2).map(({ sql }) => sql)).toEqual([
        'ROLLBACK TO SAVEPOINT hzense_publication_controls',
        'RELEASE SAVEPOINT hzense_publication_controls',
      ]);
      expect(writes(statements)).toEqual([]);
    },
  );

  it('returns a diagnostic projection while leaving the enclosing transaction and locks owned by the caller', async () => {
    const { client, statements } = fakePool();
    const result = await lockPrivatePublicationControls({ client, request: leaseRequest });
    expect(result).toMatchObject({
      scope: 'private_control_only',
      run_id: runId,
      task_id: taskId,
      principal_id: principalId,
      fencing_token: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('authorized');
    expect(result).not.toHaveProperty('eligible');
    const sql = statements.map(({ sql }) => sql);
    expect(sql[0]).toBe('SAVEPOINT hzense_publication_controls');
    expect(sql.at(-1)).toBe('RELEASE SAVEPOINT hzense_publication_controls');
    expect(sql).not.toContain('COMMIT');
    expect(sql).not.toContain('ROLLBACK');
    expect(sql.some((value) => value.startsWith('BEGIN'))).toBe(false);
    expect(writes(statements)).toEqual([]);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('rejects a caller authorization flag before issuing any SQL', async () => {
    const { client } = fakePool();
    await expect(
      lockPrivatePublicationControls({ client, request: { ...leaseRequest, authorized: true } }),
    ).rejects.toMatchObject({ code: 'invalid_control_request' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rolls back its savepoint on a policy failure without committing or releasing the connection', async () => {
    const { client, statements } = fakePool({ enabled: false });
    await expect(
      lockPrivatePublicationControls({ client, request: leaseRequest }),
    ).rejects.toMatchObject({ code: 'publication_disabled' });
    expect(statements.slice(-2).map(({ sql }) => sql)).toEqual([
      'ROLLBACK TO SAVEPOINT hzense_publication_controls',
      'RELEASE SAVEPOINT hzense_publication_controls',
    ]);
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('preserves the original gate failure if savepoint recovery fails', async () => {
    const { client } = fakePool({
      enabled: false,
      fail: (sql) => sql.startsWith('ROLLBACK TO SAVEPOINT'),
    });
    await expect(
      lockPrivatePublicationControls({ client, request: leaseRequest }),
    ).rejects.toMatchObject({ code: 'publication_disabled' });
    expect(client.release).not.toHaveBeenCalled();
  });
});
