import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  normalizeCandidateReviewRequest,
  candidateReviewMaterialHash,
} from '../src/candidate-review-contract.mjs';
import { saveCandidateReview, readCandidateReviews } from '../src/candidate-review-store.mjs';
import { signalGenerationSourceHash } from '../src/signal-generation-store.mjs';
import { assessGeneratedCandidates } from '../../ingestion/src/signal-generation-contract.mjs';
export function fixture() {
  const source = {
    classification: 'private',
    fragments: [
      { id: 'fragment-1', text: '张三于2026年9月20日宣布发布新产品。', locator: { paragraph: 1 } },
    ],
  };
  const evidence = [{ fragment_id: 'fragment-1', quote: source.fragments[0].text }];
  const result = assessGeneratedCandidates(
    {
      candidates: [
        {
          title: '新产品发布',
          summary: '张三宣布发布新产品。',
          event_date: '2026-09-20',
          event_date_evidence: evidence,
          persons: [{ name: '张三', role: '发布者', organization: null, evidence }],
          organizations: [],
          claims: [{ text: '宣布发布新产品', evidence }],
        },
      ],
      reason: 'test',
    },
    source,
  );
  const run = {
    id: randomUUID(),
    owner_id: 'owner',
    status: 'completed',
    deleted_at: null,
    source_hash: signalGenerationSourceHash(source),
    snapshot: { source },
    result,
  };
  const request = {
    requestId: randomUUID(),
    runId: run.id,
    candidateIndex: 0,
    materialHash: candidateReviewMaterialHash(run, 0),
    expectedRevision: 0,
    decision: 'draft',
    note: '审核',
    draft: {
      title: '标题',
      summary: '摘要',
      eventDate: null,
      sourceUrls: [],
      personIds: [],
      organizationIds: [],
      topicIds: [],
      eventKey: '',
      publicEvidenceIds: [],
      claims: [],
    },
  };
  return { run, request };
}
describe('private review contract', () => {
  it('counts Chinese and astral Unicode code points at exact 80/500 boundaries', () => {
    const { request } = fixture();
    const draft = { ...request.draft, title: '😀'.repeat(80), summary: '汉'.repeat(500) };
    expect(normalizeCandidateReviewRequest({ ...request, draft }).draft).toEqual(draft);
    expect(() =>
      normalizeCandidateReviewRequest({ ...request, draft: { ...draft, title: '😀'.repeat(81) } }),
    ).toThrow();
    for (const invalid of [
      { ...request, owner: 'intruder' },
      { ...request, draft: { ...draft, verified: true } },
      {
        ...request,
        draft: { ...draft, claims: [{ text: 'x', evidenceId: 'ev-1', verified: true }] },
      },
    ])
      expect(() => normalizeCandidateReviewRequest(invalid)).toThrow();
  });
  it('normalizes a bounded editable draft, never elevates it to verification', () => {
    const { request } = fixture();
    expect(normalizeCandidateReviewRequest(request)).toEqual(request);
    expect(() => normalizeCandidateReviewRequest({ ...request, decision: 'verified' })).toThrow();
  });
  it('checks Unicode lengths and real event dates', () => {
    const { request } = fixture();
    for (const draft of [
      { ...request.draft, title: '字'.repeat(81) },
      { ...request.draft, summary: '字'.repeat(501) },
      { ...request.draft, eventDate: '2026-02-30' },
    ])
      expect(() => normalizeCandidateReviewRequest({ ...request, draft })).toThrow();
  });
  it('requires explicit public evidence and person binding before submission', () => {
    const { request } = fixture();
    expect(() =>
      normalizeCandidateReviewRequest({ ...request, decision: 'submit_verification' }),
    ).toThrow('review_incomplete');
  });
  it('rejects deleted, changed and cross-candidate material', () => {
    const { run, request } = fixture();
    expect(candidateReviewMaterialHash(run, 0)).toBe(request.materialHash);
    expect(() => candidateReviewMaterialHash({ ...run, deleted_at: 'now' }, 0)).toThrow();
    expect(() => candidateReviewMaterialHash(run, 1)).toThrow();
    expect(() => candidateReviewMaterialHash({ ...run, source_hash: 'a'.repeat(64) }, 0)).toThrow();
  });
  it('CAS failure rolls back and releases without altering generation results', async () => {
    const { run, request } = fixture();
    const queries = [];
    const client = {
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes('FROM public.signal_generation_runs')) return { rows: [run] };
        if (sql.includes('SELECT revision')) return { rows: [{ revision: 2 }] };
        return { rows: [] };
      },
      release: () => queries.push('release'),
    };
    await expect(
      saveCandidateReview({
        pool: { connect: async () => client },
        owner: 'owner',
        request,
        materialHash: request.materialHash,
      }),
    ).rejects.toThrow('revision_conflict');
    expect(queries).toContain('ROLLBACK');
    expect(queries.at(-1)).toBe('release');
    expect(queries.some((s) => s.startsWith('UPDATE'))).toBe(false);
  });
  it('owner-scopes history and hides deleted generation tasks', async () => {
    let query;
    await readCandidateReviews({
      pool: {
        connect: async () => ({
          query: async (sql, args) => {
            if (sql.includes('SELECT')) query = { sql, args };
            return { rows: [] };
          },
          release: () => {},
        }),
      },
      owner: 'owner',
      runId: randomUUID(),
      candidateIndex: 0,
    });
    expect(query.sql).toContain('g.deleted_at IS NULL');
    expect(query.sql).toContain('r.owner_id=$1');
    expect(query.args[0]).toBe('owner');
  });
});
