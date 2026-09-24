import { describe, it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { buildCandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import { assessGeneratedCandidates } from '../../ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../src/signal-generation-store.mjs';
import { candidateReviewMaterialHash } from '../src/candidate-review-contract.mjs';
import { materialPlanHash } from '../src/material-registration-contract.mjs';
import {
  candidateMaterialFunctionHashes,
  candidateMaterialTriggers,
} from '../src/candidate-material-catalog.mjs';
import {
  createMaterialRequest,
  getMaterialRequest,
  readMaterialRequests,
  saveMaterialReport,
  readMaterialReports,
  getMaterialReport,
  latestVerifiedMaterialReport,
  saveMaterialReceipt,
} from '../src/candidate-material-store.mjs';

function fixture() {
  const excerpt = 'Ada, researcher at Lab, announced X on September 24, 2026.';
  const source = {
    classification: 'private',
    fragments: [{ id: 'fragment-1', text: excerpt, locator: { paragraph: 1 } }],
  };
  const evidence = [{ fragment_id: 'fragment-1', quote: excerpt }];
  const run = {
    id: randomUUID(),
    owner_id: 'owner',
    status: 'completed',
    deleted_at: null,
    snapshot: { source },
    source_hash: signalGenerationSourceHash(source),
    result: assessGeneratedCandidates(
      {
        candidates: [
          {
            title: 'Lab announces X',
            summary: 'Ada announces X.',
            event_date: '2026-09-24',
            event_date_evidence: evidence,
            persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab', evidence }],
            organizations: ['Lab'],
            claims: [{ text: 'Lab announced X.', evidence }],
          },
        ],
        reason: 'fixture',
      },
      source,
    ),
  };
  const baseMaterialHash = candidateReviewMaterialHash(run, 0);
  const bundle = buildCandidateSourceBundle({ baseMaterialHash, source, supplements: [] });
  const request = {
    id: randomUUID(),
    runId: run.id,
    candidateIndex: 0,
    baseMaterialHash,
    bundleHash: bundle.sourceBundleHash,
  };
  const plan = {
    version: 'material-registration-v1',
    owner: 'owner',
    runId: run.id,
    candidateIndex: 0,
    baseMaterialHash,
    sourceBundleHash: bundle.sourceBundleHash,
    entities: [
      { id: 'p', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['e'] },
      { id: 'org', type: 'institution', name: 'Lab', aliases: [], evidenceIds: ['e'] },
    ],
    sources: [{ id: 's', name: 'Lab', url: 'https://example.com/', allowedHosts: ['example.com'] }],
    evidence: [
      {
        id: 'e',
        sourceId: 's',
        sourceUrl: 'https://example.com/x',
        locator: 'paragraph 1',
        excerpt,
        contentHash: createHash('sha256').update(excerpt).digest('hex'),
        capturedAt: '2026-09-24T10:00:00.000Z',
        sourcePublishedAt: null,
      },
    ],
    topicIds: ['topic-ai'],
    candidate: {
      title: 'Lab announces X',
      summary: 'Ada announces X.',
      eventDate: '2026-09-24',
      persons: [{ entityId: 'p', role: 'researcher', organizationId: 'org', evidenceIds: ['e'] }],
      organizationIds: ['org'],
      claims: [{ text: 'Lab announced X.', evidenceId: 'e' }],
    },
  };
  return { run, request, bundle, plan };
}
function database(run) {
  const receivedAt = '2026-09-24T10:00:00.000Z';
  const requests = [],
    reports = [],
    receipts = [],
    queries = [];
  let failCommit = false;
  const client = {
    release: () => queries.push({ sql: 'release' }),
    query: async (sql, args = []) => {
      queries.push({ sql, args });
      if (sql === 'COMMIT' && failCommit) throw Error('connection lost');
      if (sql === 'SELECT transaction_timestamp() AS received_at')
        return { rows: [{ received_at: receivedAt }] };
      if (sql.startsWith('SELECT id,owner_id,status'))
        return { rows: run.id === args[0] && run.owner_id === args[1] ? [run] : [] };
      if (sql.startsWith('INSERT INTO public.candidate_material_requests')) {
        const [
          id,
          owner_id,
          run_id,
          candidate_index,
          base_material_hash,
          bundle_hash,
          fingerprint,
          bundle,
        ] = args;
        if (requests.some((row) => row.id === id))
          throw Object.assign(Error('duplicate'), { code: '23505' });
        const row = {
          id,
          owner_id,
          run_id,
          candidate_index,
          base_material_hash,
          bundle_hash,
          fingerprint,
          bundle: JSON.parse(bundle),
        };
        requests.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('INSERT INTO public.candidate_material_reports')) {
        const [id, request_id, owner_id, plan_hash, plan, attestation] = args;
        const row = {
          id,
          request_id,
          owner_id,
          plan_hash,
          plan: JSON.parse(plan),
          attestation: JSON.parse(attestation),
          received_at: receivedAt,
        };
        reports.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('INSERT INTO public.candidate_material_receipts')) {
        const [id, request_id, report_id, owner_id, plan_hash, stage] = args;
        const row = { id, request_id, report_id, owner_id, plan_hash, stage };
        receipts.push(row);
        return { rows: [row] };
      }
      if (sql.includes('FROM public.candidate_material_requests')) {
        if (sql.includes('JOIN') && (run.deleted_at || run.status !== 'completed'))
          return { rows: [] };
        if (sql.includes('AS selected_report')) {
          const eligible = requests.filter(
            (r) =>
              r.owner_id === args[0] &&
              r.run_id === args[1] &&
              r.candidate_index === args[2] &&
              r.base_material_hash === args[3],
          );
          const matches = receipts
            .filter((c) => c.stage === 'verified')
            .flatMap((c) => {
              const request = eligible.find(
                (r) => r.id === c.request_id && r.owner_id === c.owner_id,
              );
              const report = reports.find(
                (p) =>
                  p.id === c.report_id &&
                  p.request_id === c.request_id &&
                  p.owner_id === c.owner_id &&
                  p.plan_hash === c.plan_hash,
              );
              return request && report
                ? [
                    {
                      ...request,
                      selected_report: report,
                      receiptTime: c.created_at ?? '',
                      receiptId: c.id,
                    },
                  ]
                : [];
            })
            .sort(
              (a, b) =>
                b.receiptTime.localeCompare(a.receiptTime) ||
                b.receiptId.localeCompare(a.receiptId),
            );
          return {
            rows: matches.slice(0, 1).map(({ receiptTime, receiptId, ...row }) => {
              void receiptTime;
              void receiptId;
              return row;
            }),
          };
        }
        if (sql.includes('WHERE r.owner_id=$1'))
          return {
            rows: requests
              .filter(
                (r) =>
                  r.owner_id === args[0] && r.run_id === args[1] && r.candidate_index === args[2],
              )
              .slice(0, 10),
          };
        if (sql.includes('WHERE owner_id=$1'))
          return {
            rows: requests.filter(
              (r) =>
                r.owner_id === args[0] &&
                r.run_id === args[1] &&
                r.candidate_index === args[2] &&
                r.base_material_hash === args[3] &&
                r.bundle_hash === args[4],
            ),
          };
        return { rows: requests.filter((r) => r.id === args[0] && r.owner_id === args[1]) };
      }
      if (sql.includes('FROM public.candidate_material_reports')) {
        if (sql.includes('LIMIT 1'))
          return {
            rows: reports
              .filter(
                (r) =>
                  r.request_id === args[0] &&
                  r.owner_id === args[1] &&
                  (sql.includes('AND id=$3') ? r.id === args[2] : r.plan_hash === args[2]),
              )
              .slice(0, 1),
          };
        if (sql.includes('WHERE id=$1'))
          return {
            rows: reports.filter(
              (r) =>
                r.id === args[0] &&
                r.request_id === args[1] &&
                r.owner_id === args[2] &&
                r.plan_hash === args[3],
            ),
          };
        return {
          rows: reports
            .filter(
              (r) =>
                r.request_id === args[0] &&
                r.owner_id === args[1] &&
                (!args[2] || r.plan_hash === args[2]),
            )
            .slice(0, 3),
        };
      }
      if (sql.includes('FROM public.candidate_material_receipts')) {
        if (sql.includes('WHERE report_id=$1'))
          return {
            rows: receipts.filter(
              (r) => r.report_id === args[0] && r.request_id === args[1] && r.owner_id === args[2],
            ),
          };
        return {
          rows: receipts.filter(
            (r) =>
              r.request_id === args[0] && r.owner_id === args[1] && args[2].includes(r.report_id),
          ),
        };
      }
      return { rows: [] };
    },
  };
  return {
    pool: { connect: async () => client },
    requests,
    reports,
    receipts,
    queries,
    failCommit: () => {
      failCommit = true;
    },
  };
}
describe('private candidate material persistence', () => {
  it('requires signature admission at the database receipt time and reuses the original time on replay', async () => {
    const f = fixture(),
      db = database(f.run),
      owned = { pool: db.pool, owner: 'owner' };
    await createMaterialRequest({ ...f, ...owned });
    const args = {
      ...owned,
      requestId: f.request.id,
      plan: f.plan,
      planHash: materialPlanHash(f.plan),
      attestation: { signature: 'original' },
    };
    const before = db.queries.length;
    await expect(saveMaterialReport(args)).rejects.toThrow('invalid_request');
    expect(db.queries).toHaveLength(before);
    // Admission was valid before opening the DB connection, but its one-second
    // window has elapsed at transaction_timestamp(): no unusable row is stored.
    await expect(
      saveMaterialReport({
        ...args,
        assertAttestationAt: (_plan, _envelope, receivedAt) => {
          if (new Date(receivedAt).getTime() > Date.parse('2026-09-24T09:59:59.000Z'))
            throw Error('expired');
        },
      }),
    ).rejects.toThrow('invalid_attestation');
    expect(db.reports).toHaveLength(0);
    await expect(
      saveMaterialReport({ ...args, assertAttestationAt: async () => {} }),
    ).rejects.toThrow('invalid_attestation');
    expect(db.reports).toHaveLength(0);
    const seen = [];
    const assertAttestationAt = (plan, attestation, receivedAt) =>
      seen.push({ plan, attestation, receivedAt });
    const report = await saveMaterialReport({ ...args, assertAttestationAt });
    expect(seen[0].receivedAt).toBe(report.received_at);
    const timeReads = db.queries.filter(
      ({ sql }) => sql === 'SELECT transaction_timestamp() AS received_at',
    ).length;
    expect(
      (
        await saveMaterialReport({
          ...args,
          attestation: { signature: 'new-untrusted' },
          assertAttestationAt,
        })
      ).id,
    ).toBe(report.id);
    expect(seen[1].attestation).toEqual({ signature: 'original' });
    expect(seen[1].receivedAt).toBe(report.received_at);
    expect(
      db.queries.filter(({ sql }) => sql === 'SELECT transaction_timestamp() AS received_at'),
    ).toHaveLength(timeReads);
    expect(db.reports).toHaveLength(1);
    const insert = db.queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO public.candidate_material_reports'),
    );
    expect(insert.sql).not.toContain('received_at');
  });
  it('exact report reads and latest verified selection survive both dashboard limits', async () => {
    const f = fixture(),
      db = database(f.run),
      owned = { pool: db.pool, owner: 'owner' };
    await createMaterialRequest({ ...f, ...owned });
    const oldestRequest = db.requests[0];
    const oldReport = {
      id: randomUUID(),
      request_id: oldestRequest.id,
      owner_id: 'owner',
      plan_hash: 'a'.repeat(64),
      plan: f.plan,
      attestation: {},
    };
    for (let i = 0; i < 3; i++)
      db.reports.push({ ...oldReport, id: randomUUID(), plan_hash: String(i).repeat(64) });
    db.reports.push(oldReport);
    db.receipts.push({
      id: randomUUID(),
      request_id: oldestRequest.id,
      report_id: oldReport.id,
      owner_id: 'owner',
      plan_hash: oldReport.plan_hash,
      stage: 'verified',
      created_at: '2026-09-24T09:00:00.000Z',
    });
    // Put ten newer requests ahead of the already-verified request in dashboard order.
    for (let i = 0; i < 10; i++) db.requests.unshift({ ...oldestRequest, id: randomUUID() });
    expect(
      (await readMaterialRequests({ ...owned, runId: f.run.id, candidateIndex: 0 })).some(
        (r) => r.id === oldestRequest.id,
      ),
    ).toBe(false);
    expect(
      (await getMaterialRequest({ ...owned, id: oldestRequest.id })).reports.some(
        (r) => r.id === oldReport.id,
      ),
    ).toBe(false);
    const before = db.queries.length;
    expect(
      (await getMaterialReport({ ...owned, requestId: oldestRequest.id, reportId: oldReport.id }))
        .receipts,
    ).toHaveLength(1);
    expect(
      (
        await getMaterialReport({
          ...owned,
          requestId: oldestRequest.id,
          planHash: oldReport.plan_hash,
        })
      ).id,
    ).toBe(oldReport.id);
    const latestArgs = {
      ...owned,
      runId: f.run.id,
      candidateIndex: 0,
      baseMaterialHash: f.request.baseMaterialHash,
    };
    expect((await latestVerifiedMaterialReport(latestArgs)).report.id).toBe(oldReport.id);
    // Receipt completion order, not report/request creation order, selects authority.
    db.receipts.push({
      ...db.receipts[0],
      id: randomUUID(),
      report_id: db.reports[0].id,
      plan_hash: db.reports[0].plan_hash,
      created_at: '2026-09-24T10:00:00.000Z',
    });
    expect((await latestVerifiedMaterialReport(latestArgs)).report.id).toBe(db.reports[0].id);
    expect(await latestVerifiedMaterialReport({ ...latestArgs, owner: 'intruder' })).toBe(null);
    expect(
      await latestVerifiedMaterialReport({ ...latestArgs, baseMaterialHash: 'f'.repeat(64) }),
    ).toBe(null);
    await expect(
      getMaterialReport({
        ...owned,
        owner: 'intruder',
        requestId: oldestRequest.id,
        reportId: oldReport.id,
      }),
    ).rejects.toThrow('not_found');
    for (const selector of [{}, { reportId: oldReport.id, planHash: oldReport.plan_hash }])
      await expect(
        getMaterialReport({ ...owned, requestId: oldestRequest.id, ...selector }),
      ).rejects.toThrow('invalid_request');
    f.run.deleted_at = 'now';
    expect(await latestVerifiedMaterialReport(latestArgs)).toBe(null);
    await expect(
      getMaterialReport({ ...owned, requestId: oldestRequest.id, reportId: oldReport.id }),
    ).rejects.toThrow('not_found');
    expect(db.queries.slice(before).some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(
      false,
    );
  });
  it('replays identity and bundle duplicates without appending; same ID with different bundle conflicts', async () => {
    const f = fixture(),
      db = database(f.run),
      args = { ...f, pool: db.pool, owner: 'owner' };
    const first = await createMaterialRequest(args);
    expect((await createMaterialRequest(args)).id).toBe(first.id);
    expect(
      (await createMaterialRequest({ ...args, request: { ...f.request, id: randomUUID() } })).id,
    ).toBe(first.id);
    const more = {
      classification: 'private',
      fragments: [
        { id: 'fragment-1', text: 'Additional supporting context.', locator: { paragraph: 2 } },
      ],
    };
    const changed = buildCandidateSourceBundle({
      baseMaterialHash: f.request.baseMaterialHash,
      source: f.run.snapshot.source,
      supplements: [
        {
          batchId: randomUUID(),
          itemId: randomUUID(),
          fence: 1,
          contentHash: signalGenerationSourceHash(more),
          sourceUrl: null,
          source: more,
        },
      ],
    });
    await expect(
      createMaterialRequest({
        ...args,
        bundle: changed,
        request: { ...f.request, bundleHash: changed.sourceBundleHash },
      }),
    ).rejects.toThrow('request_id_conflict');
    expect(db.requests).toHaveLength(1);
    expect(db.queries.some((q) => q.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  });
  it('rejects digest forgery, changed original text and stale generation material', async () => {
    const f = fixture(),
      db = database(f.run),
      args = { ...f, pool: db.pool, owner: 'owner' };
    await expect(
      createMaterialRequest({ ...args, request: { ...f.request, bundleHash: 'a'.repeat(64) } }),
    ).rejects.toThrow('invalid_bundle');
    const forged = buildCandidateSourceBundle({
      baseMaterialHash: f.request.baseMaterialHash,
      source: {
        classification: 'private',
        fragments: [{ id: 'fragment-1', text: 'Forged original.', locator: { paragraph: 1 } }],
      },
      supplements: [],
    });
    await expect(
      createMaterialRequest({
        ...args,
        bundle: forged,
        request: { ...f.request, bundleHash: forged.sourceBundleHash },
      }),
    ).rejects.toThrow('invalid_bundle');
    f.run.source_hash = '0'.repeat(64);
    await expect(createMaterialRequest(args)).rejects.toThrow('material_changed');
    expect(db.requests).toHaveLength(0);
  });
  it('isolates owners and hides deleted tasks for reads and writes', async () => {
    const f = fixture(),
      db = database(f.run);
    await createMaterialRequest({ ...f, pool: db.pool, owner: 'owner' });
    await expect(
      getMaterialRequest({ pool: db.pool, owner: 'intruder', id: f.request.id }),
    ).rejects.toThrow('not_found');
    await expect(createMaterialRequest({ ...f, pool: db.pool, owner: 'intruder' })).rejects.toThrow(
      'not_found',
    );
    f.run.deleted_at = 'now';
    expect(
      await readMaterialRequests({
        pool: db.pool,
        owner: 'owner',
        runId: f.run.id,
        candidateIndex: 0,
      }),
    ).toEqual([]);
    await expect(createMaterialRequest({ ...f, pool: db.pool, owner: 'owner' })).rejects.toThrow(
      'not_found',
    );
  });
  it('binds reports, replays receipts and requires registration before verified stage', async () => {
    const f = fixture(),
      db = database(f.run),
      owned = { pool: db.pool, owner: 'owner' };
    await createMaterialRequest({ ...f, ...owned });
    const args = {
      ...owned,
      requestId: f.request.id,
      plan: f.plan,
      planHash: materialPlanHash(f.plan),
      attestation: { trustedServerChecked: true },
      assertAttestationAt: () => {},
    };
    const wrong = { ...f.plan, owner: 'someone-else' };
    await expect(
      saveMaterialReport({ ...args, plan: wrong, planHash: materialPlanHash(wrong) }),
    ).rejects.toThrow('invalid_plan');
    const report = await saveMaterialReport(args);
    expect((await saveMaterialReport(args)).id).toBe(report.id);
    const receipt = {
      ...owned,
      requestId: f.request.id,
      reportId: report.id,
      planHash: args.planHash,
    };
    await expect(saveMaterialReceipt({ ...receipt, stage: 'verified' })).rejects.toThrow(
      'stage_conflict',
    );
    await saveMaterialReceipt({ ...receipt, stage: 'registered' });
    const verified = await saveMaterialReceipt({ ...receipt, stage: 'verified' });
    expect((await saveMaterialReceipt({ ...receipt, stage: 'verified' })).id).toBe(verified.id);
    expect(db.reports).toHaveLength(1);
    expect(db.receipts).toHaveLength(2);
    const before = db.queries.length;
    expect(
      (await readMaterialReports({ ...owned, requestId: f.request.id }))[0].receipts,
    ).toHaveLength(2);
    const history = await readMaterialRequests({ ...owned, runId: f.run.id, candidateIndex: 0 });
    expect(history[0].reports[0].receipts).toHaveLength(2);
    const reads = db.queries.slice(before).map((q) => q.sql);
    expect(reads.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(reads).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const limit of ['LIMIT 10', 'LIMIT 3', 'LIMIT 6'])
      expect(reads.some((sql) => sql.includes(limit))).toBe(true);
  });
  it('reports unknown commits separately from unavailable databases', async () => {
    const f = fixture(),
      db = database(f.run);
    db.failCommit();
    await expect(createMaterialRequest({ ...f, pool: db.pool, owner: 'owner' })).rejects.toThrow(
      'commit_unknown',
    );
    expect(db.queries.at(-1).sql).toBe('release');
    await expect(
      createMaterialRequest({
        ...f,
        pool: {
          connect: async () => {
            throw Error('offline');
          },
        },
        owner: 'owner',
      }),
    ).rejects.toThrow('database_unavailable');
  });
  it('keeps the migration private and seals every append-only trigger body', () => {
    const sql = readFileSync(
      new URL('../../../db/migrations/0023_candidate_materials.sql', import.meta.url),
      'utf8',
    );
    const body = sql.split('AS $guard$')[1].split('$guard$;')[0].trim();
    expect(createHash('sha256').update(body).digest('hex')).toBe(
      candidateMaterialFunctionHashes.hzense_guard_candidate_materials,
    );
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = pg_catalog, pg_temp');
    expect(sql).not.toMatch(/\bGRANT\b/);
    for (const trigger of candidateMaterialTriggers)
      expect(sql).toContain(`ENABLE ALWAYS TRIGGER ${trigger.name}`);
  });
});
