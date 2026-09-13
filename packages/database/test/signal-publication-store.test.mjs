import { describe, expect, it, vi } from 'vitest';
import { recordPrivateSignalPublicationTransition } from '../src/signal-publication-store.mjs';

const request = {
  request_key: 'publication-test-1',
  signal_id: 'signal-test-1',
  action: 'publish',
  target_version: 1,
  expected_revision: 0,
  reason_code: 'initial_publication',
};

function fakePool({ head = null, receipt = null, fail = () => false, rowCount = 1 } = {}) {
  const statements = [];
  const failure = new Error('Injected SQL failure');
  const client = {
    query: vi.fn(async (sql, values) => {
      statements.push({ sql, values });
      if (fail(sql)) throw failure;
      if (sql.startsWith('SELECT id FROM public.signals')) {
        return { rows: [{ id: request.signal_id }] };
      }
      if (sql.includes('FROM public.signal_publication_state')) {
        return { rows: head ? [head] : [] };
      }
      if (sql.includes('FROM public.signal_publication_outbox')) {
        return { rows: receipt ? [receipt] : [] };
      }
      if (sql.startsWith('INSERT INTO public.signal_publication_outbox')) {
        return {
          rows: [{ event_id: values[0], occurred_at: new Date('2026-09-13T12:00:00.123Z') }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { pool, client, statements, failure };
}

describe('private Signal publication store transaction ownership', () => {
  it('validates before borrowing a connection and does not accept authorization flags', async () => {
    const { pool } = fakePool();
    await expect(
      recordPrivateSignalPublicationTransition({ pool, request: { ...request, authorized: true } }),
    ).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('serializes request then Signal before reads, atomically records event and head, then commits', async () => {
    const { pool, client, statements } = fakePool();
    const result = await recordPrivateSignalPublicationTransition({ pool, request });
    expect(result.outcome).toBe('apply');
    const sql = statements.map((entry) => entry.sql);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    const lockKey = sql.findIndex((value) => value.includes('pg_advisory_xact_lock'));
    const lockSignal = sql.findIndex((value) => value.startsWith('SELECT id'));
    const readHead = sql.findIndex((value) =>
      value.includes('FROM public.signal_publication_state'),
    );
    const writeEvent = sql.findIndex((value) =>
      value.startsWith('INSERT INTO public.signal_publication_outbox'),
    );
    const writeHead = sql.findIndex((value) =>
      value.startsWith('INSERT INTO public.signal_publication_state'),
    );
    expect(lockKey).toBeLessThan(lockSignal);
    expect(lockSignal).toBeLessThan(readHead);
    expect(readHead).toBeLessThan(writeEvent);
    expect(writeEvent).toBeLessThan(writeHead);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(statements[writeEvent].values[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(statements[writeHead].values[4]).toBe(statements[writeEvent].values[0]);
    expect(sql[writeEvent]).toContain("date_trunc('milliseconds', pg_catalog.clock_timestamp())");
    expect(sql.join('\n')).not.toContain(request.request_key);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('a stale command has no writes and preserves the current head', async () => {
    const { pool, statements } = fakePool({
      head: {
        signal_id: request.signal_id,
        publication_revision: 1,
        content_version: 1,
        status: 'published',
      },
    });
    const result = await recordPrivateSignalPublicationTransition({ pool, request });
    expect(result.outcome).toBe('conflict');
    expect(statements.some(({ sql }) => sql.startsWith('INSERT'))).toBe(false);
    expect(statements.at(-1).sql).toBe('COMMIT');
  });

  it.each([
    ['event insert', (sql) => sql.startsWith('INSERT INTO public.signal_publication_outbox')],
    ['head insert', (sql) => sql.startsWith('INSERT INTO public.signal_publication_state')],
    ['deferred constraint/commit', (sql) => sql === 'COMMIT'],
  ])(
    'rolls back on %s failure, preserves the error and destroys the borrowed connection',
    async (_label, fail) => {
      const { pool, client, statements, failure } = fakePool({ fail });
      await expect(recordPrivateSignalPublicationTransition({ pool, request })).rejects.toBe(
        failure,
      );
      expect(statements.at(-1).sql).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
    },
  );

  it('rejects a lost CAS rather than committing an orphan event', async () => {
    const { pool, statements, client } = fakePool({ rowCount: 0 });
    await expect(recordPrivateSignalPublicationTransition({ pool, request })).rejects.toThrow(
      'head changed',
    );
    expect(statements.at(-1).sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('a failed rollback cannot mask a failed commit or return an open connection to the pool', async () => {
    const { pool, client, failure } = fakePool({
      fail: (sql) => sql === 'COMMIT' || sql === 'ROLLBACK',
    });
    await expect(recordPrivateSignalPublicationTransition({ pool, request })).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('destroys a connection when BEGIN fails without attempting nested recovery', async () => {
    const { pool, client, statements, failure } = fakePool({
      fail: (sql) => sql.startsWith('BEGIN'),
    });
    await expect(recordPrivateSignalPublicationTransition({ pool, request })).rejects.toBe(failure);
    expect(statements).toHaveLength(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
