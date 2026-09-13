import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fingerprintSignalPublicationRequest } from '../src/signal-publication-transition.mjs';
import { fingerprintQualifiedPublicationRequest } from '../src/signal-publication-qualification.mjs';
import { lockPrivatePublicationControls } from '../src/signal-publication-control-store.mjs';
import { publishPrivateQualifiedSignalVersion as publish } from '../src/signal-qualified-publication-store.mjs';

// Here test only adapter lifecycle/failures; real qualification has its own pure
// tests and the native suite combines both with actual rows, constraints and locks.
vi.mock('../src/signal-publication-control-store.mjs', () => ({
  lockPrivatePublicationControls: vi.fn(async () => ({ scope: 'private_control_only' })),
}));
vi.mock('../src/signal-publication-qualification.mjs', async (original) => ({
  ...(await original()),
  qualifySignalPublicationBundle: vi.fn(() => ({ scope: 'recorded_qualification_only' })),
  cloneSignalSnapshotForPublication: vi.fn((snapshot, version) => ({
    ...snapshot,
    version,
    content_hash: 'b'.repeat(64),
  })),
}));

const command = () => ({
  request_key: 'adapter:qualified',
  signal_id: 'adapter-signal',
  source_version: 1,
  target_version: 2,
  expected_revision: 0,
  reason_code: 'initial_publication',
  run_id: randomUUID(),
  lease_owner: randomUUID(),
  fencing_token: 1,
});
function fake({
  binding,
  outbox,
  head = null,
  maximum = 1,
  missingSignal = false,
  missingSnapshot = false,
  precise = true,
  sealed = true,
  fail,
  rollbackFails = false,
} = {}) {
  const statements = [];
  const failure = new Error('synthetic query failure');
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, values) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: text, values });
      if (fail?.(text)) throw failure;
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('synthetic rollback failure');
      if (text.includes('FROM public.signal_qualified_publication_receipts'))
        return { rows: binding ? [binding] : [] };
      if (
        text.startsWith('SELECT request_key') &&
        text.includes('FROM public.signal_publication_outbox')
      )
        return { rows: outbox ? [outbox] : [] };
      if (text.startsWith('SELECT id FROM public.signals'))
        return { rows: missingSignal ? [] : [{ id: 'adapter-signal' }] };
      if (text.includes('FROM public.signal_publication_state'))
        return { rows: head ? [head] : [] };
      if (text.startsWith('SELECT max(version)')) return { rows: [{ maximum }] };
      if (text.includes(' AS sealed,'))
        return {
          rows: missingSnapshot
            ? []
            : [
                {
                  signal_id: 'adapter-signal',
                  version: 1,
                  precise,
                  sealed,
                  title: 'fixture',
                  occurred_at: new Date('2026-01-01T00:00:00Z'),
                  content_hash: 'a'.repeat(64),
                },
              ],
        };
      if (text.includes('FROM public.signal_event_identities'))
        return {
          rows: [
            {
              signal_id: 'adapter-signal',
              event_key: 'fixture-event',
              basis_version: 1,
              basis_evidence_id: 'fixture-evidence',
              identity_basis: 'fixture',
            },
          ],
        };
      if (text.startsWith('INSERT INTO public.signal_publication_outbox'))
        return {
          rows: [
            {
              event_id: '10000000-0000-4000-8000-000000000001',
              occurred_at: new Date('2026-01-02T00:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      if (text.startsWith('INSERT INTO')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, statements, failure };
}
function historical(request) {
  const binding = Object.fromEntries(
    ['request_key', 'signal_id', 'source_version', 'target_version', 'run_id'].map((key) => [
      key,
      request[key],
    ]),
  );
  binding.request_fingerprint = fingerprintQualifiedPublicationRequest(request);
  const outbox = {
    event_id: '10000000-0000-4000-8000-000000000001',
    request_key: request.request_key,
    request_fingerprint: fingerprintSignalPublicationRequest({
      request_key: request.request_key,
      signal_id: request.signal_id,
      action: 'publish',
      target_version: request.target_version,
      expected_revision: request.expected_revision,
      reason_code: request.reason_code,
    }),
    signal_id: request.signal_id,
    expected_revision: 0,
    publication_revision: 1,
    content_version: 2,
    status: 'published',
    reason_code: 'initial_publication',
  };
  return { binding, outbox };
}
beforeEach(() => {
  vi.clearAllMocks();
  lockPrivatePublicationControls.mockResolvedValue({ scope: 'private_control_only' });
});

describe('private qualified publication adapter lifecycle', () => {
  it('owns one short transaction, uses the shared request lock, checks after writes, and returns only after COMMIT', async () => {
    const request = command();
    const { pool, client, statements } = fake();
    const result = await publish({ pool, request });
    expect(result).toMatchObject({
      scope: 'private_recorded_qualification',
      outcome: 'apply',
      head: { content_version: 2, publication_revision: 1 },
    });
    expect(statements[0].sql).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(statements.some(({ sql }) => sql.includes('hzense:signal-publication:'))).toBe(true);
    expect(statements.at(-2).sql).toBe('SET CONSTRAINTS ALL IMMEDIATE');
    expect(statements.at(-1).sql).toBe('COMMIT');
    expect(statements.filter(({ sql }) => sql.startsWith('BEGIN'))).toHaveLength(1);
    expect(lockPrivatePublicationControls).toHaveBeenCalledTimes(3);
    for (const call of lockPrivatePublicationControls.mock.calls)
      expect(call[0].client).toBe(client);
    const finalGateOrder = lockPrivatePublicationControls.mock.invocationCallOrder.at(-1);
    expect(finalGateOrder).toBeGreaterThan(client.query.mock.invocationCallOrder.at(-2));
    expect(finalGateOrder).toBeLessThan(client.query.mock.invocationCallOrder.at(-1));
    expect(client.release).toHaveBeenCalledWith(undefined);
    const bindingInsert = statements.find(({ sql }) =>
      sql.startsWith('INSERT INTO public.signal_qualified_publication_receipts'),
    );
    expect(bindingInsert.values).toEqual([
      request.request_key,
      fingerprintQualifiedPublicationRequest(request),
      request.signal_id,
      1,
      2,
      request.run_id,
      request.lease_owner,
      1,
    ]);
  });

  it('rejects invented authorization fields before connecting', async () => {
    const { pool } = fake();
    await expect(publish({ pool, request: { ...command(), authorized: true } })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('preserves connection acquisition failures', async () => {
    const failure = new Error('synthetic connection failure');
    await expect(
      publish({
        pool: {
          connect: async () => {
            throw failure;
          },
        },
        request: command(),
      }),
    ).rejects.toBe(failure);
  });
  it.each([
    [{ missingSignal: true }, 'signal_not_found'],
    [{ missingSnapshot: true }, 'snapshot_not_found'],
    [{ precise: false }, 'snapshot_timestamp_precision'],
    [{ sealed: false }, 'snapshot_not_sealed'],
    [{ maximum: 2 }, 'target_version_not_new'],
    [{ maximum: null }, 'snapshot_not_found'],
    [
      {
        head: {
          signal_id: 'adapter-signal',
          publication_revision: 1,
          content_version: 1,
          status: 'published',
        },
      },
      'stale_revision',
    ],
  ])('fails closed before assembly: %s', async (options, code) => {
    const { pool, statements, client } = fake(options);
    await expect(publish({ pool, request: command() })).rejects.toMatchObject({ code });
    expect(statements.at(-1).sql).toBe('ROLLBACK');
    expect(statements.some(({ sql }) => sql.startsWith('INSERT'))).toBe(false);
    expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it.each([
    'BEGIN',
    'INSERT INTO public.signal_versions',
    'INSERT INTO public.signal_publication_outbox',
    'INSERT INTO public.signal_publication_state',
    'INSERT INTO public.signal_qualified_publication_receipts',
    'SET CONSTRAINTS',
    'COMMIT',
  ])('never returns success on failure at %s', async (step) => {
    const { pool, client, statements, failure } = fake({ fail: (sql) => sql.startsWith(step) });
    await expect(publish({ pool, request: command() })).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(failure);
    if (step === 'BEGIN') expect(statements).toHaveLength(1);
    else expect(statements.at(-1).sql).toBe('ROLLBACK');
  });
  it('keeps original failure and discards the connection when rollback also fails', async () => {
    const { pool, client, failure } = fake({
      fail: (sql) => sql === 'COMMIT',
      rollbackFails: true,
    });
    await expect(publish({ pool, request: command() })).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(failure);
  });
  it('rolls back all writes if the last lease check rejects', async () => {
    const failure = new Error('lease expired');
    lockPrivatePublicationControls
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(failure);
    const { pool, statements } = fake();
    await expect(publish({ pool, request: command() })).rejects.toBe(failure);
    expect(
      statements.some(({ sql }) =>
        sql.startsWith('INSERT INTO public.signal_qualified_publication_receipts'),
      ),
    ).toBe(true);
    expect(statements.at(-1).sql).toBe('ROLLBACK');
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(false);
  });
  it('replays a historical receipt without calling current gate or restoring a withdrawn head', async () => {
    const request = command();
    const options = historical(request);
    const head = {
      signal_id: request.signal_id,
      publication_revision: 2,
      content_version: 2,
      status: 'withdrawn',
    };
    const { pool, statements } = fake({ ...options, head });
    const result = await publish({ pool, request });
    expect(result).toMatchObject({
      scope: 'private_historical_receipt',
      outcome: 'replay',
      current_head: head,
      current_head_unchanged: true,
    });
    expect(lockPrivatePublicationControls).not.toHaveBeenCalled();
    expect(statements.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it('rejects changed source/run semantics and an orphan binding', async () => {
    const request = command();
    const options = historical(request);
    await expect(
      publish({ pool: fake(options).pool, request: { ...request, run_id: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'request_key_reused' });
    await expect(
      publish({ pool: fake({ binding: options.binding }).pool, request }),
    ).rejects.toMatchObject({ code: 'invalid_publication_receipt' });
  });
  it('does not adopt a legacy unbound Outbox key', async () => {
    const request = command();
    const { outbox } = historical(request);
    const { pool } = fake({ outbox });
    await expect(publish({ pool, request })).rejects.toMatchObject({
      code: 'unbound_publication_receipt',
    });
    expect(lockPrivatePublicationControls).not.toHaveBeenCalled();
  });
});
