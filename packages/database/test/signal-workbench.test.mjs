import { describe, expect, it, vi } from 'vitest';
import {
  parseSignalWorkbenchListRequest,
  parseSignalWorkbenchDetailRequest,
  safeWorkbenchSourceUrl,
  signalWorkbenchReadColumns,
} from '../src/signal-workbench-contract.mjs';
import { listSignalWorkbench, getSignalWorkbenchDetail } from '../src/signal-workbench-store.mjs';

describe('private Signal workbench contract', () => {
  it('normalizes bounded list requests without accepting caller-supplied SQL controls', () => {
    expect(parseSignalWorkbenchListRequest({})).toEqual({ q: '', after: '', limit: 25 });
    expect(
      parseSignalWorkbenchListRequest({
        q: '  literal %_ quotation  ',
        after: 'signal-one',
        limit: 50,
      }),
    ).toEqual({ q: 'literal %_ quotation', after: 'signal-one', limit: 50 });
    expect(
      parseSignalWorkbenchDetailRequest({ signal_id: 'signal-one', version: 2147483647 }),
    ).toEqual({ signal_id: 'signal-one', version: 2147483647 });
    expect(parseSignalWorkbenchDetailRequest({ signal_id: 'signal-one' })).toEqual({
      signal_id: 'signal-one',
    });
  });

  it.each([
    null,
    [],
    'query',
    { limit: 0 },
    { limit: -1 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: Number.NaN },
    { limit: Number.POSITIVE_INFINITY },
    { limit: '25' },
    { q: 'x'.repeat(101) },
    { q: 'secret\u0000marker' },
    { q: 'line\nfeed' },
    { q: {} },
    { after: '../signal' },
    { after: 'Signal-One' },
    { after: 'signal-one\n' },
    { after: 'x'.repeat(201) },
    { order: 'DROP TABLE signals' },
    { limit: 25, api_key: 'private-marker' },
  ])('rejects malformed list request %#', (value) => {
    expect(() => parseSignalWorkbenchListRequest(value)).toThrowError(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });

  it.each([
    {},
    null,
    [],
    { signal_id: '' },
    { signal_id: 'signal/one' },
    { signal_id: 'signal-one\n' },
    { signal_id: 'x'.repeat(201) },
    { signal_id: 'signal-one', version: 0 },
    { signal_id: 'signal-one', version: 2147483648 },
    { signal_id: 'signal-one', version: 1.5 },
    { signal_id: 'signal-one', version: '1' },
    { signal_id: 'signal-one', evidence: true },
  ])('rejects malformed detail request %#', (value) => {
    expect(() => parseSignalWorkbenchDetailRequest(value)).toThrowError(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });

  it('rejects accessors without evaluating request code', () => {
    const getter = vi.fn(() => 'secret-marker');
    const value = Object.defineProperty({}, 'q', { enumerable: true, get: getter });
    expect(() => parseSignalWorkbenchListRequest(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'http://example.com/source',
    'javascript:alert(1)',
    'data:text/html,private',
    'https://user:private@example.com/source',
    'https://example.com/source?token=private',
    'https://example.com/source#private',
    'https://example.com/source\n',
    'https:example.com/path',
    'https://example.com\\@other.test/a',
    'https://example.com/%0Asecret',
    'https://example.com/%7f',
    'https://example.com/%C2%80',
    'https://example.com/%ZZ',
    null,
    {},
  ])('does not expose an unsafe source URL %#', (value) => {
    expect(safeWorkbenchSourceUrl(value)).toBeNull();
  });

  it('retains a safe source link without resolving or fetching it', () => {
    expect(safeWorkbenchSourceUrl('https://example.com/source')).toBe('https://example.com/source');
    expect(safeWorkbenchSourceUrl('https://example.com/%E4%B8%AD%E6%96%87')).toBe(
      'https://example.com/%E4%B8%AD%E6%96%87',
    );
  });

  it('read allowlist excludes raw evidence, arbitrary metadata, dependency seals and AI tables', () => {
    expect(signalWorkbenchReadColumns.public_source_evidence).not.toContain('excerpt');
    expect(signalWorkbenchReadColumns.public_source_evidence).not.toContain('locator');
    expect(Object.keys(signalWorkbenchReadColumns).some((table) => table.startsWith('ai_'))).toBe(
      false,
    );
    expect(Object.values(signalWorkbenchReadColumns).flat()).not.toContain('metadata');
    expect(Object.values(signalWorkbenchReadColumns).flat()).not.toContain('dependency_seal');
  });

  it('invalid requests cannot borrow a database connection', async () => {
    const pool = { connect: vi.fn() };
    await expect(listSignalWorkbench({ pool, request: { limit: 0 } })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      getSignalWorkbenchDetail({ pool, request: { signal_id: '../private' } }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

const clock = '2026-09-15T00:00:00.000Z';
const overview = {
  signal_id: 'signal-one',
  latest_snapshot_version: 3,
  head_content_version: 2,
  head_publication_revision: 1,
  head_status: 'published',
  head_occurred_at: clock,
  current_public_version: 1,
};
const snapshot = {
  version: 1,
  title: 'Historical one',
  type: 'research',
  occurred_at: clock,
  date_precision: 'day',
  date_basis: 'Event date',
  captured_at: clock,
  summary: 'Summary',
  analysis: null,
  importance: 3,
  strength: 3,
  confidence: 0.8,
  novelty: 0.5,
  revision_reason: 'Synthetic',
  origin: 'manual',
  created_at: clock,
};
function fixture(overrides = {}) {
  const calls = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      const key = /workbench:(\w+)/.exec(sql)?.[1] ?? sql;
      if (overrides.fail === key) throw new Error('PRIVATE_QUERY_DIAGNOSTIC');
      return {
        rows:
          overrides[key] ??
          {
            identity: [{ ok: true }],
            access: [{ ok: true }],
            clock: [{ observed_at: clock }],
            list: [],
            overview: [overview],
            snapshot: [snapshot],
          }[key] ??
          [],
      };
    }),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, calls };
}

describe('private Signal workbench read transactions', () => {
  it.each(['Bad ID', '../private', 'signal-one\n'])(
    'rejects incompatible database identifiers without dropping the row: %s',
    async (signal_id) => {
      const row = {
        ...overview,
        signal_id,
        title: 'Synthetic',
        type: 'research',
        occurred_at: clock,
      };
      await expect(
        listSignalWorkbench({ pool: fixture({ list: [row] }).pool }),
      ).rejects.toMatchObject({ code: 'incompatible_data' });
      await expect(
        getSignalWorkbenchDetail({
          pool: fixture({ overview: [{ ...overview, signal_id }] }).pool,
          request: { signal_id: 'signal-one', version: 1 },
        }),
      ).rejects.toMatchObject({ code: 'incompatible_data' });
    },
  );
  it('uses one repeatable-read read-only snapshot, bounded timeouts and a safe empty result', async () => {
    const f = fixture();
    expect(await listSignalWorkbench({ pool: f.pool })).toEqual({
      items: [],
      next_after: null,
      observed_at: clock,
    });
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.calls[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.calls.map((row) => row.sql).join('\n')).toContain("statement_timeout='5s'");
    expect(f.calls.at(-1).sql).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(
      f.calls.some(
        ({ sql }) =>
          /\b(?:INSERT|UPDATE|DELETE|FOR SHARE|FOR UPDATE|pg_advisory)\b/i.test(
            sql.replace(/\/\*[\s\S]*?\*\//g, ''),
          ) && !sql.includes('workbench:access'),
      ),
    ).toBe(false);
  });
  it('binds literal filtering/cursor/page size and strips unlisted fields', async () => {
    const row = {
      ...overview,
      title: 'Snapshot three',
      type: 'research',
      occurred_at: clock,
      private_extra: 'PRIVATE_MARKER',
    };
    const f = fixture({ list: [row, { ...row, signal_id: 'signal-two' }] });
    const result = await listSignalWorkbench({
      pool: f.pool,
      request: { q: "%_'", after: 'signal-before', limit: 1 },
    });
    expect(f.calls.find((row) => row.sql.includes('workbench:list')).parameters).toEqual([
      "%_'",
      'signal-before',
      2,
    ]);
    expect(result).toMatchObject({
      items: [
        {
          latest_snapshot_version: 3,
          recorded_head: { content_version: 2 },
          current_public_version: 1,
        },
      ],
      next_after: 'signal-one',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
  });
  it('binds one historical version to every detail edge and exposes no opaque verification JSON', async () => {
    const f = fixture({
      verifications: [
        {
          verification_id: '00000000-0000-4000-8000-000000000001',
          source_version: 1,
          decision: 'approved',
          verified_at: clock,
          expires_at: clock,
          expired: true,
          dependency_invalidated: true,
          claims_supported: true,
          people_disambiguated: 'bad',
          checks: { private: 'PRIVATE_CHECKS' },
          report_hash: 'PRIVATE_REPORT',
        },
      ],
    });
    const result = await getSignalWorkbenchDetail({
      pool: f.pool,
      request: { signal_id: 'signal-one', version: 1 },
    });
    expect(result).toMatchObject({
      latest_snapshot_version: 3,
      selected_version: 1,
      snapshot: { version: 1 },
      recorded_head: { content_version: 2 },
      current_public_version: 1,
    });
    for (const kind of [
      'snapshot',
      'evidence',
      'people',
      'organizations',
      'topics',
      'verifications',
    ])
      expect(f.calls.find((row) => row.sql.includes(`workbench:${kind}`)).parameters).toEqual([
        'signal-one',
        1,
      ]);
    expect(result.verifications[0].checks).toMatchObject({
      claims_supported: true,
      people_disambiguated: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CHECKS|PRIVATE_REPORT/);
    expect(f.calls.at(-1).sql).toBe('COMMIT');
  });
  it('caps nested rows and text with explicit truncation rather than pretending totals', async () => {
    const f = fixture({
      snapshot: [{ ...snapshot, summary: 'x'.repeat(5000) }],
      topics: Array.from({ length: 51 }, (_, i) => ({ id: `topic-${i}`, title: 'Topic' })),
    });
    const result = await getSignalWorkbenchDetail({
      pool: f.pool,
      request: { signal_id: 'signal-one', version: 1 },
    });
    expect(result.topics).toHaveLength(50);
    expect(result.snapshot.summary).toHaveLength(4000);
    expect(result.truncated).toMatchObject({ topics: true, text: true });
    expect(result).not.toHaveProperty('total');
  });
  it.each(['identity', 'access'])(
    'fails closed before material SELECT when %s is denied',
    async (kind) => {
      const f = fixture({ [kind]: [{ ok: false }] });
      await expect(listSignalWorkbench({ pool: f.pool })).rejects.toMatchObject({
        code: 'access_denied',
      });
      expect(f.calls.some((row) => row.sql.includes('workbench:list'))).toBe(false);
      expect(f.calls.at(-1).sql).toBe('ROLLBACK');
      expect(f.client.release).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['workbench-missing', 'snapshot-missing'])(
    'missing detail fails without cached/Seed fallback: %s',
    async (kind) => {
      const f = fixture(kind === 'workbench-missing' ? { overview: [] } : { snapshot: [] });
      await expect(
        getSignalWorkbenchDetail({ pool: f.pool, request: { signal_id: 'signal-one' } }),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(f.calls.at(-1).sql).toBe('ROLLBACK');
    },
  );
  it.each(['list', 'COMMIT'])(
    'sanitizes %s failure, rolls back and discards its checked-out connection',
    async (fail) => {
      const f = fixture({ fail });
      await expect(listSignalWorkbench({ pool: f.pool })).rejects.toMatchObject({
        code: 'database_unavailable',
        message: 'database_unavailable',
      });
      expect(f.calls.at(-1).sql).toBe('ROLLBACK');
      expect(f.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    },
  );
});
