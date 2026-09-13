import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CandidateVerificationError,
  fingerprintAssemblyRequest,
  fingerprintCandidateVerificationMaterial,
  fingerprintVerificationReport,
  prepareVerifiedCandidateBundle,
} from '../src/candidate-verification.mjs';
import { cloneSignalSnapshotForPublication } from '../src/signal-publication-qualification.mjs';
import { assembleVersion, lockBundle } from '../src/signal-qualified-publication-store.mjs';
import {
  assemblePrivateVerifiedSignalCandidate as assemble,
  readPrivateCandidateVerificationMaterial as read,
  recordPrivateCandidateVerification as record,
} from '../src/signal-candidate-verification-store.mjs';

// Adapter-only lifecycle tests. Real parsers/report hashes remain in use; pure
// rules and native PostgreSQL tests independently exercise complete materials.
vi.mock('../src/signal-qualified-publication-store.mjs', () => ({
  lockBundle: vi.fn(),
  lockPublicPublicationBundle: vi.fn(),
  assembleVersion: vi.fn(),
}));
vi.mock('../src/candidate-verification.mjs', async (original) => ({
  ...(await original()),
  fingerprintCandidateVerificationMaterial: vi.fn(),
  prepareVerifiedCandidateBundle: vi.fn(),
}));
vi.mock('../src/signal-publication-qualification.mjs', async (original) => ({
  ...(await original()),
  cloneSignalSnapshotForPublication: vi.fn(),
}));

const verificationId = '00000000-0000-0000-0000-000000000001';
const verifierId = '00000000-0000-0000-0000-000000000002';
const otherId = '00000000-0000-0000-0000-000000000003';
const reader = () => ({ signal_id: 'adapter-signal', source_version: 1 });
function recordCommand(overrides = {}) {
  return {
    verification_id: verificationId,
    signal_id: 'adapter-signal',
    source_version: 1,
    source_content_hash: 'a'.repeat(64),
    bundle_fingerprint: 'b'.repeat(64),
    verifier_id: verifierId,
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
    valid_for_seconds: 3600,
    ...overrides,
  };
}
const assemblyCommand = (overrides = {}) => ({
  request_key: 'adapter-assembly',
  verification_id: verificationId,
  signal_id: 'adapter-signal',
  source_version: 1,
  target_version: 2,
  ...overrides,
});
function storedRecord(command = recordCommand(), overrides = {}) {
  const { valid_for_seconds: seconds, ...fields } = command;
  const verifiedAt = new Date('2026-09-13T10:00:00.000Z');
  return {
    ...fields,
    report_hash: fingerprintVerificationReport(command),
    verified_at: verifiedAt,
    expires_at: new Date(verifiedAt.getTime() + seconds * 1000),
    ...overrides,
  };
}
function receipt(command = assemblyCommand(), overrides = {}) {
  return {
    ...command,
    request_fingerprint: fingerprintAssemblyRequest(command),
    content_hash: 'd'.repeat(64),
    ...overrides,
  };
}

function fake(options = {}) {
  const statements = [];
  const failure = new Error('synthetic query failure');
  let activeCount = 0;
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, values) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: text, values });
      if (options.fail?.(text)) throw failure;
      if (text === 'ROLLBACK' && options.rollbackFails)
        throw new Error('synthetic rollback failure');
      if (text.includes('FROM public.signal_candidate_assembly_receipts')) {
        if (text.includes('WHERE request_key=$1'))
          return { rows: options.receipt ? [options.receipt] : [] };
        return { rows: options.consumed ? [{ request_key: 'old-key' }] : [] };
      }
      if (text.includes('FROM public.signal_candidate_verifications')) {
        if (text.endsWith('FOR SHARE')) {
          const active = options.activeRecords ?? [
            { ...storedRecord(), sealed: true, current: true },
          ];
          const row = active[Math.min(activeCount, active.length - 1)];
          activeCount += 1;
          return { rows: row ? [row] : [] };
        }
        return { rows: options.existing ? [options.existing] : [] };
      }
      if (text.startsWith('SELECT id FROM public.signals')) {
        return { rows: options.missingSignal ? [] : [{ id: 'adapter-signal' }] };
      }
      if (text.startsWith('SELECT max(version)')) {
        return { rows: [{ maximum: options.maximum === undefined ? 1 : options.maximum }] };
      }
      if (text.includes('FROM public.public_source_evidence')) {
        return {
          rows: [
            {
              id: 'evidence-one',
              locator: 'Section 1',
              excerpt: 'public excerpt',
              content_hash: 'c'.repeat(64),
              captured_at: new Date('2026-09-13T00:00:00.000Z'),
              source_published_at: null,
              precise: options.precise !== false,
            },
          ],
        };
      }
      if (text.startsWith('SELECT id,name,aliases,metadata'))
        return {
          rows: [
            { id: 'person-one', name: 'Person', aliases: [], metadata: {}, metadata_text: '{}' },
          ],
        };
      if (text.startsWith('SELECT id,name,type,url,trust_score'))
        return {
          rows: [{ id: 'source-one', name: 'Source', type: 'website', url: null, trust_score: 80 }],
        };
      if (text.startsWith('INSERT INTO public.signal_candidate_verifications')) {
        return { rows: options.emptyRecordInsert ? [] : [storedRecord()] };
      }
      if (text.startsWith('INSERT INTO public.signal_candidate_assembly_receipts')) {
        return { rows: options.emptyReceiptInsert ? [] : [receipt()] };
      }
      if (/^(BEGIN |SET |COMMIT$|ROLLBACK$|SELECT pg_catalog\.pg_advisory_xact_lock)/.test(text)) {
        return { rows: [] };
      }
      throw new Error(`Unexpected test query: ${text}`);
    }),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { pool, client, statements, failure, activeCount: () => activeCount };
}

beforeEach(() => {
  vi.mocked(lockBundle)
    .mockReset()
    .mockResolvedValue({
      snapshot: { signal_id: 'adapter-signal', version: 1, content_hash: 'a'.repeat(64) },
      evidence: [{ id: 'evidence-one' }],
      entities: [{ id: 'person-one' }],
      sources: [{ id: 'source-one' }],
    });
  vi.mocked(assembleVersion).mockReset().mockResolvedValue(undefined);
  vi.mocked(fingerprintCandidateVerificationMaterial).mockReset().mockReturnValue('b'.repeat(64));
  vi.mocked(prepareVerifiedCandidateBundle)
    .mockReset()
    .mockImplementation((bundle) => ({ ...bundle, prepared: true }));
  vi.mocked(cloneSignalSnapshotForPublication)
    .mockReset()
    .mockImplementation((snapshot, version) => ({
      ...snapshot,
      version,
      content_hash: 'd'.repeat(64),
    }));
});

const operations = [
  ['read', read, reader],
  ['record', record, recordCommand],
  ['assemble', assemble, assemblyCommand],
];
function assertNoWrites(harness) {
  expect(harness.statements.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  expect(assembleVersion).not.toHaveBeenCalled();
}

describe('candidate store connection and transaction ownership', () => {
  it.each(operations)(
    '%s rejects malformed input before connecting',
    async (_name, operation, command) => {
      const harness = fake();
      await expect(
        operation({ pool: harness.pool, request: { ...command(), authorized: true } }),
      ).rejects.toBeInstanceOf(CandidateVerificationError);
      expect(harness.pool.connect).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    '%s requires a dedicated connection pool',
    async (_name, operation, command) => {
      for (const pool of [null, undefined, {}, { query: vi.fn() }, { connect: true }]) {
        await expect(operation({ pool, request: command() })).rejects.toThrow(
          'A dedicated connection pool is required',
        );
      }
    },
  );

  it.each(operations)(
    '%s returns successful connections without a discard reason',
    async (_name, operation, command) => {
      const harness = fake();
      await operation({ pool: harness.pool, request: command() });
      expect(harness.statements[0].sql).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
      expect(harness.statements.at(-1).sql).toBe('COMMIT');
      expect(harness.statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(false);
      expect(harness.client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    },
  );

  it.each(operations)(
    '%s propagates connect failure without assuming a connection exists',
    async (_name, operation, command) => {
      const harness = fake();
      const failure = new Error('synthetic connect failure');
      harness.pool.connect.mockRejectedValue(failure);
      await expect(operation({ pool: harness.pool, request: command() })).rejects.toBe(failure);
      expect(harness.client.query).not.toHaveBeenCalled();
      expect(harness.client.release).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    '%s discards on BEGIN failure without issuing a fictitious rollback',
    async (_name, operation, command) => {
      const harness = fake({ fail: (sql) => sql.startsWith('BEGIN ') });
      await expect(operation({ pool: harness.pool, request: command() })).rejects.toBe(
        harness.failure,
      );
      expect(harness.statements.map(({ sql }) => sql)).toEqual([
        'BEGIN ISOLATION LEVEL READ COMMITTED',
      ]);
      expect(harness.client.release).toHaveBeenCalledExactlyOnceWith(harness.failure);
    },
  );

  it.each(operations)(
    '%s preserves original failure when rollback itself fails',
    async (_name, operation, command) => {
      const harness = fake({
        fail: (sql) => sql.startsWith('SET LOCAL search_path'),
        rollbackFails: true,
      });
      await expect(operation({ pool: harness.pool, request: command() })).rejects.toBe(
        harness.failure,
      );
      expect(harness.statements.at(-1).sql).toBe('ROLLBACK');
      expect(harness.client.release).toHaveBeenCalledExactlyOnceWith(harness.failure);
    },
  );

  it.each(operations)(
    '%s exposes unknown COMMIT outcome as failure and discards connection',
    async (_name, operation, command) => {
      const harness = fake({ fail: (sql) => sql === 'COMMIT' });
      await expect(operation({ pool: harness.pool, request: command() })).rejects.toBe(
        harness.failure,
      );
      expect(harness.statements.slice(-2).map(({ sql }) => sql)).toEqual(['COMMIT', 'ROLLBACK']);
      expect(harness.client.release).toHaveBeenCalledExactlyOnceWith(harness.failure);
    },
  );
});

describe('locked material reader and verification attestation', () => {
  it('reader forwards all four material projections and performs no writes', async () => {
    const harness = fake();
    const result = await read({ pool: harness.pool, request: reader() });
    expect(result.scope).toBe('private_verification_material');
    expect(result.bundle_fingerprint).toBe('b'.repeat(64));
    expect(result).toHaveProperty('entity_details.0.name', 'Person');
    expect(result).toHaveProperty('source_details.0.trust_score', 80);
    expect(result.evidence_details[0]).not.toHaveProperty('precise');
    expect(fingerprintCandidateVerificationMaterial).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        bundle: result.bundle,
        evidence_details: result.evidence_details,
        entity_details: result.entity_details,
        source_details: result.source_details,
      }),
    );
    expect(
      harness.statements.find(({ sql }) => sql.startsWith('SELECT id FROM public.signals')).sql,
    ).toContain('FOR SHARE');
    assertNoWrites(harness);
  });

  it('does not hash lossy database evidence timestamps', async () => {
    const harness = fake({ precise: false });
    await expect(read({ pool: harness.pool, request: reader() })).rejects.toMatchObject({
      code: 'invalid_material_timestamp',
    });
    expect(fingerprintCandidateVerificationMaterial).not.toHaveBeenCalled();
    assertNoWrites(harness);
  });

  it('records a matching material review using a DB-clock TTL and fixed-order check JSON', async () => {
    const harness = fake();
    const command = recordCommand();
    command.checks = Object.fromEntries(Object.entries(command.checks).reverse());
    const result = await record({ pool: harness.pool, request: command });
    expect(result).toMatchObject({ scope: 'private_recorded_verification', outcome: 'recorded' });
    const insert = harness.statements.find(({ sql }) =>
      sql.startsWith('INSERT INTO public.signal_candidate_verifications'),
    );
    expect(insert.sql).toContain('pg_catalog.statement_timestamp()');
    expect(insert.values[7]).toBe(fingerprintVerificationReport(command));
    expect(insert.values[9]).toBe(JSON.stringify(recordCommand().checks));
    expect(insert.values[10]).toBe(3600);
    expect(assembleVersion).not.toHaveBeenCalled();
  });

  it('replays matching stored JSONB checks in any key order without re-reading dependencies', async () => {
    const existing = storedRecord();
    existing.checks = Object.fromEntries(Object.entries(existing.checks).reverse());
    const harness = fake({ existing });
    const result = await record({ pool: harness.pool, request: recordCommand() });
    expect(result).toEqual({
      scope: 'private_historical_verification',
      outcome: 'replay',
      record: existing,
    });
    expect(lockBundle).not.toHaveBeenCalled();
    expect(fingerprintCandidateVerificationMaterial).not.toHaveBeenCalled();
    assertNoWrites(harness);
  });

  it.each([
    ['verifier identity', { verifier_id: otherId }],
    ['decision', { decision: 'rejected' }],
    ['TTL', { valid_for_seconds: 60 }],
    ['source hash', { source_content_hash: 'c'.repeat(64) }],
    ['material fingerprint', { bundle_fingerprint: 'd'.repeat(64) }],
  ])('rejects a reused verification key with changed %s', async (_label, change) => {
    const harness = fake({ existing: storedRecord() });
    await expect(
      record({ pool: harness.pool, request: recordCommand(change) }),
    ).rejects.toMatchObject({ code: 'verification_key_reused' });
    assertNoWrites(harness);
  });

  it('rejects a stored report hash that does not match recorded checks', async () => {
    const harness = fake({
      existing: storedRecord(recordCommand(), { report_hash: '0'.repeat(64) }),
    });
    await expect(record({ pool: harness.pool, request: recordCommand() })).rejects.toMatchObject({
      code: 'invalid_stored_verification',
    });
    assertNoWrites(harness);
  });

  it.each(['source_content_hash', 'bundle_fingerprint'])(
    'refuses to attest mismatched %s',
    async (field) => {
      const harness = fake();
      await expect(
        record({ pool: harness.pool, request: recordCommand({ [field]: 'e'.repeat(64) }) }),
      ).rejects.toMatchObject({ code: 'verification_material_changed' });
      assertNoWrites(harness);
    },
  );

  it('does not swallow underlying material-loader failure or empty INSERT result', async () => {
    const harness = fake();
    const failure = new Error('synthetic dependency failure');
    vi.mocked(lockBundle).mockRejectedValueOnce(failure);
    await expect(record({ pool: harness.pool, request: recordCommand() })).rejects.toBe(failure);
    expect(harness.client.release).toHaveBeenCalledWith(failure);
    assertNoWrites(harness);
    const empty = fake({ emptyRecordInsert: true });
    await expect(record({ pool: empty.pool, request: recordCommand() })).rejects.toMatchObject({
      code: 'assembly_write_conflict',
    });
    expect(empty.statements.at(-1).sql).toBe('ROLLBACK');
  });
});

describe('new verified candidate assembly, not publication', () => {
  it('assembles one cloned private version and checks expiry again before and after writes', async () => {
    const harness = fake();
    const result = await assemble({ pool: harness.pool, request: assemblyCommand() });
    expect(result).toMatchObject({
      scope: 'private_verified_candidate',
      outcome: 'assembled',
      receipt: receipt(),
    });
    expect(prepareVerifiedCandidateBundle).toHaveBeenCalledOnce();
    expect(cloneSignalSnapshotForPublication).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      2,
    );
    expect(assembleVersion).toHaveBeenCalledExactlyOnceWith(
      harness.client,
      expect.objectContaining({ version: 2, content_hash: 'd'.repeat(64) }),
      expect.objectContaining({ prepared: true }),
    );
    expect(harness.activeCount()).toBe(3);
    expect(harness.statements.some(({ sql }) => sql === 'SET CONSTRAINTS ALL IMMEDIATE')).toBe(
      true,
    );
    expect(
      harness.statements.some(({ sql }) =>
        /signal_publication_state|signal_publication_outbox|search_documents/.test(sql),
      ),
    ).toBe(false);
  });

  it('historical assembly replay neither reads expired verification/dependencies nor writes', async () => {
    const previous = receipt();
    const harness = fake({ receipt: previous, activeRecords: [] });
    expect(await assemble({ pool: harness.pool, request: assemblyCommand() })).toEqual({
      scope: 'private_historical_assembly',
      outcome: 'replay',
      receipt: previous,
    });
    expect(harness.activeCount()).toBe(0);
    expect(lockBundle).not.toHaveBeenCalled();
    expect(fingerprintCandidateVerificationMaterial).not.toHaveBeenCalled();
    assertNoWrites(harness);
  });

  it.each([
    'verification_id',
    'signal_id',
    'source_version',
    'target_version',
    'request_fingerprint',
  ])('rejects mismatched historical receipt %s', async (field) => {
    const previous = receipt();
    previous[field] = field.endsWith('version') ? 9 : 'different';
    const harness = fake({ receipt: previous });
    await expect(
      assemble({ pool: harness.pool, request: assemblyCommand() }),
    ).rejects.toMatchObject({ code: 'assembly_key_reused' });
    assertNoWrites(harness);
  });

  it.each([
    ['consumed verification', { consumed: true }, 'verification_already_consumed'],
    ['missing verification', { activeRecords: [] }, 'verification_not_found'],
    [
      'unsealed verification',
      { activeRecords: [{ ...storedRecord(), sealed: false, current: true }] },
      'verification_not_sealed',
    ],
    [
      'rejected verification',
      {
        activeRecords: [
          { ...storedRecord(recordCommand({ decision: 'rejected' })), sealed: true, current: true },
        ],
      },
      'verification_not_approved',
    ],
    [
      'expired verification',
      { activeRecords: [{ ...storedRecord(), sealed: true, current: false }] },
      'verification_expired',
    ],
    [
      'wrong signal binding',
      {
        activeRecords: [
          {
            ...storedRecord(recordCommand({ signal_id: 'another-signal' })),
            sealed: true,
            current: true,
          },
        ],
      },
      'verification_material_changed',
    ],
    ['missing signal', { missingSignal: true }, 'signal_not_found'],
    ['existing target', { maximum: 2 }, 'target_version_not_new'],
    ['missing source versions', { maximum: null }, 'target_version_not_new'],
  ])('rejects %s without any version or receipt writes', async (_label, options, code) => {
    const harness = fake(options);
    await expect(
      assemble({ pool: harness.pool, request: assemblyCommand() }),
    ).rejects.toMatchObject({ code });
    assertNoWrites(harness);
    expect(harness.statements.at(-1).sql).toBe('ROLLBACK');
  });

  it('rejects changed locked material before any assembly write', async () => {
    const harness = fake();
    vi.mocked(fingerprintCandidateVerificationMaterial).mockReturnValueOnce('c'.repeat(64));
    await expect(
      assemble({ pool: harness.pool, request: assemblyCommand() }),
    ).rejects.toMatchObject({ code: 'verification_material_changed' });
    assertNoWrites(harness);
  });

  it.each([1, 2])('rechecks and rolls back expiry observed at later read %s', async (laterRead) => {
    const valid = { ...storedRecord(), sealed: true, current: true };
    const expired = { ...valid, current: false };
    const harness = fake({
      activeRecords: [...Array.from({ length: laterRead }, () => valid), expired],
    });
    await expect(
      assemble({ pool: harness.pool, request: assemblyCommand() }),
    ).rejects.toMatchObject({ code: 'verification_expired' });
    expect(harness.statements.at(-1).sql).toBe('ROLLBACK');
    expect(harness.statements.some(({ sql }) => sql === 'COMMIT')).toBe(false);
    if (laterRead === 1) assertNoWrites(harness);
    else expect(assembleVersion).toHaveBeenCalledOnce();
  });

  it('rolls back an assembly dependency failure without inserting a receipt', async () => {
    const harness = fake();
    const failure = new Error('synthetic version insert failure');
    vi.mocked(assembleVersion).mockRejectedValueOnce(failure);
    await expect(assemble({ pool: harness.pool, request: assemblyCommand() })).rejects.toBe(
      failure,
    );
    expect(
      harness.statements.some(({ sql }) =>
        sql.startsWith('INSERT INTO public.signal_candidate_assembly_receipts'),
      ),
    ).toBe(false);
    expect(harness.client.release).toHaveBeenCalledWith(failure);
    expect(harness.statements.at(-1).sql).toBe('ROLLBACK');
  });

  it('rejects an empty receipt INSERT and rolls back the new candidate', async () => {
    const harness = fake({ emptyReceiptInsert: true });
    await expect(
      assemble({ pool: harness.pool, request: assemblyCommand() }),
    ).rejects.toMatchObject({ code: 'assembly_write_conflict' });
    expect(assembleVersion).toHaveBeenCalledOnce();
    expect(harness.statements.at(-1).sql).toBe('ROLLBACK');
  });
});
