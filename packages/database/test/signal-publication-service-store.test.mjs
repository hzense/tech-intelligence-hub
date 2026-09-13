import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintVerificationReport } from '../src/candidate-verification.mjs';
import { readLockedPublicCandidateMaterial } from '../src/signal-candidate-verification-store.mjs';
import { lockPublicPublicationControls } from '../src/signal-publication-control-store.mjs';
import { PublicationControlError } from '../src/signal-publication-control.mjs';
import { assembleVersion } from '../src/signal-qualified-publication-store.mjs';
import { fingerprintQualifiedPublicationRequest } from '../src/signal-publication-qualification.mjs';
import { fingerprintSignalPublicationRequest } from '../src/signal-publication-transition.mjs';
import {
  publishVerifiedSignal,
  withdrawPublicSignal,
  PublicPublicationError,
} from '../src/signal-publication-service-store.mjs';

// Transaction lifecycle tests mock material qualification only. Native tests in
// signal-qualified-publication.integration independently run complete materials,
// both SQL lock helpers, clone guards, permits and the dynamic public view.
vi.mock('../src/signal-candidate-verification-store.mjs', () => ({
  readLockedPublicCandidateMaterial: vi.fn(),
}));
vi.mock('../src/signal-publication-control-store.mjs', () => ({
  lockPublicPublicationControls: vi.fn(),
}));
vi.mock('../src/signal-qualified-publication-store.mjs', () => ({ assembleVersion: vi.fn() }));
vi.mock('../src/candidate-verification.mjs', async (original) => ({
  ...(await original()),
  fingerprintCandidateVerificationMaterial: vi.fn(() => 'b'.repeat(64)),
  prepareVerifiedCandidateBundle: vi.fn((input) => globalThis.structuredClone(input)),
}));
vi.mock('../src/signal-publication-qualification.mjs', async (original) => ({
  ...(await original()),
  qualifySignalPublicationBundle: vi.fn(),
  cloneSignalSnapshotForPublication: vi.fn((snapshot, version) => ({
    ...snapshot,
    version,
    content_hash: (version === 2 ? 'c' : 'd').repeat(64),
  })),
}));
const id = '00000000-0000-0000-0000-000000000001';
const eventId = '00000000-0000-0000-0000-000000000002';
const publishRequest = () => ({
  request_key: 'public:one',
  signal_id: 'signal-one',
  source_version: 2,
  target_version: 3,
  expected_revision: 0,
  reason_code: 'initial_publication',
  run_id: id,
  lease_owner: id,
  fencing_token: 1,
});
const withdrawRequest = () => ({
  request_key: 'withdraw:one',
  signal_id: 'signal-one',
  target_version: 3,
  expected_revision: 1,
  reason_code: 'operator_request',
});
const publicationHead = {
  signal_id: 'signal-one',
  publication_revision: 1,
  content_version: 3,
  status: 'published',
};
function verification() {
  const request = {
    verification_id: id,
    signal_id: 'signal-one',
    source_version: 1,
    source_content_hash: 'a'.repeat(64),
    bundle_fingerprint: 'a'.repeat(64),
    verifier_id: id,
    policy_version: 'candidate-verification-v1',
    decision: 'approved',
    checks: {
      claims_supported: true,
      people_disambiguated: true,
      people_are_participants: true,
      organizations_supported: true,
      public_sources_cleared: true,
      contradictions_resolved: true,
    },
    valid_for_seconds: 60,
  };
  const { valid_for_seconds, ...row } = request;
  return {
    ...row,
    report_hash: fingerprintVerificationReport(request),
    verified_at: new Date('2026-01-01T00:00:00Z'),
    expires_at: new Date(Date.parse('2026-01-01T00:00:00Z') + valid_for_seconds * 1000),
    sealed: true,
    current: true,
  };
}
function material(version) {
  return {
    bundle: {
      snapshot: {
        signal_id: 'signal-one',
        version,
        content_hash: (version === 1 ? 'a' : 'c').repeat(64),
      },
      evidence_links: [],
      people: [],
      organizations: [],
      topic_links: [],
    },
    evidence_details: [],
    entity_details: [],
    source_details: [],
    bundle_fingerprint: (version === 1 ? 'a' : 'b').repeat(64),
  };
}
function historical(request = publishRequest()) {
  const action = request.source_version ? 'publish' : 'withdraw';
  const command = {
    request_key: request.request_key,
    signal_id: request.signal_id,
    action,
    target_version: request.target_version,
    expected_revision: request.expected_revision,
    reason_code: request.reason_code,
  };
  return {
    event_id: eventId,
    request_key: command.request_key,
    request_fingerprint: fingerprintSignalPublicationRequest(command),
    signal_id: command.signal_id,
    expected_revision: command.expected_revision,
    publication_revision: command.expected_revision + 1,
    content_version: command.target_version,
    status: action === 'publish' ? 'published' : 'withdrawn',
    reason_code: command.reason_code,
  };
}
function fake(options = {}) {
  const statements = [];
  let activeCount = 0;
  const failure = new Error('SECRET raw database exception must not escape');
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, values) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: text, values });
      if (options.fail?.(text)) throw failure;
      if (text === 'ROLLBACK' && options.rollbackFails) throw failure;
      if (text.startsWith('SELECT event_id,request_key'))
        return { rows: options.previous ? [options.previous] : [] };
      if (text.includes('FROM public.signal_qualified_publication_receipts'))
        return { rows: options.binding ? [options.binding] : [] };
      if (text.startsWith('SELECT event_id FROM public.signal_publication_permits'))
        return { rows: options.noPermit ? [] : [{ event_id: eventId }] };
      if (text.includes('FROM public.signal_publication_state'))
        return { rows: options.head ? [options.head] : [] };
      if (text.includes('FROM public.signal_candidate_assembly_receipts'))
        return {
          rows: options.noAssembly
            ? []
            : [
                {
                  verification_id: id,
                  signal_id: 'signal-one',
                  source_version: 1,
                  target_version: 2,
                  content_hash: 'c'.repeat(64),
                  sealed: !options.unsealedAssembly,
                },
              ],
        };
      if (text.includes('FROM public.signal_candidate_verifications')) {
        const rows = options.verifications ?? [verification()];
        const row = rows[Math.min(activeCount++, rows.length - 1)];
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith('SELECT max(version)')) return { rows: [{ maximum: 2 }] };
      if (text.startsWith('SELECT verification_id,invalidated'))
        return { rows: [{ verification_id: id, invalidated: !!options.invalidated }] };
      if (text.startsWith('INSERT INTO public.signal_publication_outbox'))
        return { rows: [{ event_id: eventId, occurred_at: new Date() }], rowCount: 1 };
      if (text.startsWith('INSERT INTO')) return { rows: [], rowCount: options.noWrite ? 0 : 1 };
      if (text.includes('FROM public.current_public_signals'))
        return { rows: options.hidden ? [] : [{ signal_id: 'signal-one' }] };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, statements, failure };
}
beforeEach(() => {
  vi.clearAllMocks();
  readLockedPublicCandidateMaterial.mockImplementation(async (_client, request) =>
    material(request.source_version),
  );
  lockPublicPublicationControls.mockResolvedValue({ scope: 'private_control_only' });
  assembleVersion.mockResolvedValue(undefined);
});
describe('restricted public publication service adapter', () => {
  it.each([
    'publication_disabled',
    'task_disabled',
    'authorization_revoked',
    'run_not_running',
    'lease_owner_mismatch',
    'stale_fencing_token',
    'lease_expired',
    'control_not_found',
    'task_not_found',
  ])('preserves safe control phase code %s', async (code) => {
    lockPublicPublicationControls.mockRejectedValueOnce(new PublicationControlError(code));
    const f = fake();
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).rejects.toMatchObject({ code });
    expect(assembleVersion).not.toHaveBeenCalled();
  });
  it('checks immutable assembly, current material, TTL and controls around one atomic permit commit', async () => {
    const f = fake();
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).resolves.toEqual({
      scope: 'public_publication_receipt',
      outcome: 'apply',
      signal_id: 'signal-one',
      publication_revision: 1,
      content_version: 3,
      status: 'published',
      event_id: eventId,
      current_public: true,
    });
    expect(readLockedPublicCandidateMaterial.mock.calls.map((c) => c[1].source_version)).toEqual([
      1, 2,
    ]);
    expect(lockPublicPublicationControls).toHaveBeenCalledTimes(3);
    expect(assembleVersion).toHaveBeenCalledTimes(1);
    const sql = f.statements.map((s) => s.sql);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(
      sql.findIndex((s) => s.startsWith('INSERT INTO public.signal_publication_permits')),
    ).toBeLessThan(sql.indexOf('COMMIT'));
    expect(sql.at(-1)).toContain('FROM public.current_public_signals');
    expect(sql.at(-1)).toContain('version=$2 AND publication_revision=$3');
    expect(f.statements.at(-1).values).toEqual(['signal-one', 3, 1]);
    expect(sql.at(-2)).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledWith(undefined);
  });
  it('reports an unknown outcome after a committed write when its current-visibility read fails', async () => {
    const f = fake({ fail: (sql) => sql.includes('FROM public.current_public_signals') });
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).rejects.toEqual(new PublicPublicationError('database_unavailable'));
    expect(f.statements.some((statement) => statement.sql === 'COMMIT')).toBe(true);
    expect(f.statements.some((statement) => statement.sql === 'ROLLBACK')).toBe(false);
    expect(f.client.release).toHaveBeenCalledWith(f.failure);
  });
  it.each([
    [{ noAssembly: true }, 'assembly_not_found'],
    [{ unsealedAssembly: true }, 'assembly_not_sealed'],
    [{ invalidated: true }, 'dependency_invalidated'],
    [{ verifications: [null] }, 'verification_not_found'],
    [{ verifications: [{ ...verification(), sealed: false }] }, 'verification_not_sealed'],
    [{ verifications: [{ ...verification(), current: false }] }, 'verification_expired'],
    [
      { verifications: [{ ...verification(), report_hash: 'f'.repeat(64) }] },
      'invalid_stored_verification',
    ],
  ])('rejects unavailable/untrusted evidence %s', async (options, code) => {
    const f = fake(options);
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).rejects.toMatchObject({ code });
    expect(f.statements.some((s) => s.sql === 'ROLLBACK')).toBe(true);
    expect(f.statements.some((s) => s.sql === 'COMMIT')).toBe(false);
    expect(assembleVersion).not.toHaveBeenCalled();
  });
  it('rolls back when TTL expires after permit writing and deferred constraints', async () => {
    const f = fake({
      verifications: [verification(), verification(), { ...verification(), current: false }],
    });
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).rejects.toMatchObject({ code: 'verification_expired' });
    expect(
      f.statements.some((s) => s.sql.startsWith('INSERT INTO public.signal_publication_permits')),
    ).toBe(true);
    expect(f.statements.at(-1).sql).toBe('ROLLBACK');
  });
  it('requires a public permit even when a historical private qualified receipt exists', async () => {
    const request = publishRequest();
    const f = fake({
      previous: historical(request),
      binding: { ...request, request_fingerprint: fingerprintQualifiedPublicationRequest(request) },
      noPermit: true,
    });
    await expect(publishVerifiedSignal({ pool: f.pool, request })).rejects.toMatchObject({
      code: 'unbound_publication_receipt',
    });
  });
  it('replays a public receipt without reauthorizing or re-publishing its historical content', async () => {
    const request = publishRequest();
    const f = fake({
      previous: historical(request),
      binding: { ...request, request_fingerprint: fingerprintQualifiedPublicationRequest(request) },
      head: { ...publicationHead, status: 'withdrawn', publication_revision: 2 },
      hidden: true,
    });
    await expect(publishVerifiedSignal({ pool: f.pool, request })).resolves.toMatchObject({
      outcome: 'replay',
      status: 'published',
      current_public: false,
    });
    expect(lockPublicPublicationControls).not.toHaveBeenCalled();
    expect(assembleVersion).not.toHaveBeenCalled();
    expect(f.statements.some((s) => s.sql.startsWith('INSERT'))).toBe(false);
  });
  it('withdraws with CAS without reading global switches, tasks, leases or qualification', async () => {
    const f = fake({ head: publicationHead, hidden: true });
    await expect(
      withdrawPublicSignal({ pool: f.pool, request: withdrawRequest() }),
    ).resolves.toMatchObject({
      scope: 'public_withdrawal_receipt',
      outcome: 'apply',
      status: 'withdrawn',
      publication_revision: 2,
      current_public: false,
    });
    expect(lockPublicPublicationControls).not.toHaveBeenCalled();
    expect(readLockedPublicCandidateMaterial).not.toHaveBeenCalled();
    expect(assembleVersion).not.toHaveBeenCalled();
  });
  it('rejects stale withdrawal without writes', async () => {
    const f = fake({ head: publicationHead });
    await expect(
      withdrawPublicSignal({
        pool: f.pool,
        request: { ...withdrawRequest(), expected_revision: 0 },
      }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    expect(f.statements.some((s) => s.sql.startsWith('INSERT'))).toBe(false);
  });
  it.each([
    'COMMIT',
    'SET CONSTRAINTS ALL IMMEDIATE',
    'INSERT INTO public.signal_publication_permits',
  ])('sanitizes failure at %s, destroys connection and never reports success', async (prefix) => {
    const f = fake({ fail: (sql) => sql.startsWith(prefix), rollbackFails: true });
    await expect(
      publishVerifiedSignal({ pool: f.pool, request: publishRequest() }),
    ).rejects.toEqual(new PublicPublicationError('database_unavailable'));
    expect(f.client.release).toHaveBeenCalledWith(f.failure);
  });
  it.each(['body', 'verified', 'verification_id', 'actor', 'authorized', 'action'])(
    'rejects caller field %s before connection',
    async (key) => {
      const f = fake();
      await expect(
        publishVerifiedSignal({ pool: f.pool, request: { ...publishRequest(), [key]: true } }),
      ).rejects.toMatchObject({ code: 'invalid_publication_request' });
      await expect(
        withdrawPublicSignal({ pool: f.pool, request: { ...withdrawRequest(), [key]: true } }),
      ).rejects.toMatchObject({ code: 'invalid_publication_request' });
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );
  it('rejects accessors without executing them', async () => {
    const request = withdrawRequest();
    const getter = vi.fn();
    Object.defineProperty(request, 'reason_code', { get: getter, enumerable: true });
    const f = fake();
    await expect(withdrawPublicSignal({ pool: f.pool, request })).rejects.toMatchObject({
      code: 'invalid_publication_request',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
});
