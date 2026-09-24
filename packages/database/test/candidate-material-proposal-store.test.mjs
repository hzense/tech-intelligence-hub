import { describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { buildCandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import { assessGeneratedCandidates } from '../../ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../src/signal-generation-store.mjs';
import { candidateReviewMaterialHash } from '../src/candidate-review-contract.mjs';
import { materialPlanHash } from '../src/material-registration-contract.mjs';
import {
  createMaterialProposal,
  getMaterialProposal,
  readMaterialProposals,
  approveMaterialProposal,
  latestApprovedMaterialProposal,
  materialProposalHash,
} from '../src/candidate-material-proposal-store.mjs';
import {
  materialRoleCheckSQL,
  materialProposalRoleProvisionSQL,
} from '../src/material-registration-role.mjs';
import {
  materialProposalFunctionHashes,
  materialProposalTriggers,
} from '../src/candidate-material-proposal-catalog.mjs';
import { signalImmutabilityFixture } from './signal-immutability-fixtures.mjs';
import {
  inspectSignalImmutabilityCatalog,
  signalGuardSourceHash,
} from '../src/signal-immutability-catalog.mjs';

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

function database(f) {
  const proposals = [],
    approvals = [],
    queries = [];
  const request = {
    id: f.request.id,
    owner_id: 'owner',
    run_id: f.run.id,
    candidate_index: 0,
    base_material_hash: f.request.baseMaterialHash,
    bundle_hash: f.request.bundleHash,
  };
  let commitFails = false;
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, args = []) => {
      queries.push({ sql, args });
      if (sql === 'COMMIT' && commitFails) throw Error('lost connection');
      if (sql.startsWith('SELECT * FROM public.candidate_material_requests'))
        return { rows: args[0] === request.id && args[1] === request.owner_id ? [request] : [] };
      if (sql.startsWith('SELECT id,owner_id,status'))
        return { rows: args[0] === f.run.id && args[1] === f.run.owner_id ? [f.run] : [] };
      if (sql.startsWith('INSERT INTO public.candidate_material_proposals')) {
        const [id, request_id, owner_id, plan_hash, proposal_hash, payload] = args;
        const row = {
          id,
          request_id,
          owner_id,
          plan_hash,
          proposal_hash,
          payload: JSON.parse(payload),
          created_at: new Date(1000 + proposals.length),
        };
        proposals.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('INSERT INTO public.candidate_material_approvals')) {
        const [id, proposal_id, request_id, owner_id, proposal_hash] = args;
        const row = {
          id,
          proposal_id,
          request_id,
          owner_id,
          proposal_hash,
          approved_by: owner_id,
          created_at: new Date(1000 + approvals.length),
        };
        approvals.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('SELECT * FROM public.candidate_material_proposals')) {
        if (sql.includes('WHERE id='))
          return {
            rows: proposals.filter(
              (p) => p.id === args[0] && p.request_id === args[1] && p.owner_id === args[2],
            ),
          };
        let rows = proposals.filter((p) => p.request_id === args[0] && p.owner_id === args[1]);
        if (sql.includes('proposal_hash=$3'))
          rows = rows.filter((p) => p.proposal_hash === args[2]);
        if (sql.includes('LIMIT 10')) rows = rows.toReversed().slice(0, 10);
        return { rows };
      }
      if (sql.startsWith('SELECT * FROM public.candidate_material_approvals')) {
        if (sql.includes('WHERE proposal_id='))
          return {
            rows: approvals.filter(
              (p) =>
                p.proposal_id === args[0] && p.request_id === args[1] && p.owner_id === args[2],
            ),
          };
        return {
          rows: approvals
            .filter((p) => p.request_id === args[0] && p.owner_id === args[1])
            .toReversed()
            .slice(0, 1),
        };
      }
      return { rows: [] };
    }),
  };
  return {
    pool: { connect: async () => client },
    client,
    proposals,
    approvals,
    queries,
    failCommit: () => {
      commitFails = true;
    },
  };
}
function args(f, db) {
  return {
    pool: db.pool,
    owner: 'owner',
    requestId: f.request.id,
    payload: {
      plan: f.plan,
      dossier: { version: 'untrusted-draft', summary: 'Review source evidence.' },
    },
  };
}

describe('append-only private material proposals and explicit owner confirmation', () => {
  it('deduplicates normalized drafts, preserves full dossier hash and never creates a trusted report', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db),
      id = randomUUID();
    const proposal = await createMaterialProposal({ ...input, id });
    expect(proposal.plan_hash).toBe(materialPlanHash(f.plan));
    expect(await createMaterialProposal({ ...input, id })).toEqual(proposal);
    expect(await createMaterialProposal({ ...input, id: randomUUID() })).toEqual(proposal);
    expect(db.proposals).toHaveLength(1);
    expect(await getMaterialProposal({ ...input, proposalId: id })).toEqual(proposal);
    expect(await readMaterialProposals(input)).toEqual([proposal]);
    expect(await latestApprovedMaterialProposal(input)).toBeNull();
    expect(
      db.queries.some(({ sql }) =>
        /INSERT INTO public.candidate_material_(reports|receipts)/.test(sql),
      ),
    ).toBe(false);
    const other = await createMaterialProposal({
      ...input,
      payload: { ...input.payload, dossier: { summary: 'Different dossier' } },
    });
    expect(other.proposal_hash).not.toBe(proposal.proposal_hash);
    expect(other.plan_hash).toBe(proposal.plan_hash);
  });
  it('approves the exact proposal once, binds actor and hash, resolves approval beyond the display limit', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db);
    const proposal = await createMaterialProposal(input);
    const approve = {
      ...input,
      proposalId: proposal.id,
      proposalHash: proposal.proposal_hash,
      approvedBy: 'owner',
    };
    await expect(approveMaterialProposal({ ...approve, approvedBy: 'other' })).rejects.toThrow(
      'invalid_request',
    );
    await expect(
      approveMaterialProposal({ ...approve, proposalHash: 'f'.repeat(64) }),
    ).rejects.toThrow('material_changed');
    const approval = await approveMaterialProposal(approve);
    expect(await approveMaterialProposal(approve)).toEqual(approval);
    expect(db.approvals).toHaveLength(1);
    for (let i = 0; i < 12; i++)
      await createMaterialProposal({ ...input, payload: { ...input.payload, dossier: { i } } });
    expect(await readMaterialProposals(input)).toHaveLength(10);
    expect(await latestApprovedMaterialProposal(input)).toEqual({ proposal, approval });
    const insert = db.queries.find(({ sql }) =>
      sql.startsWith('INSERT INTO public.candidate_material_approvals'),
    ).sql;
    expect(insert).toContain('JOIN public.candidate_material_requests');
    expect(insert).toContain('p.proposal_hash=$5');
    expect(insert).toContain('p.owner_id FROM');
  });
  it('blocks cross-owner access, mismatched requests, altered plans, and deleted generation tasks', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db);
    const proposal = await createMaterialProposal(input);
    await expect(
      getMaterialProposal({ ...input, owner: 'other', proposalId: proposal.id }),
    ).rejects.toThrow('not_found');
    await expect(
      getMaterialProposal({ ...input, requestId: randomUUID(), proposalId: proposal.id }),
    ).rejects.toThrow('not_found');
    await expect(
      createMaterialProposal({
        ...input,
        payload: { ...input.payload, plan: { ...f.plan, sourceBundleHash: 'f'.repeat(64) } },
      }),
    ).rejects.toThrow('material_changed');
    await expect(
      createMaterialProposal({
        ...input,
        id: proposal.id,
        payload: { ...input.payload, dossier: { changed: true } },
      }),
    ).rejects.toThrow('request_id_conflict');
    f.run.deleted_at = new Date();
    await expect(
      approveMaterialProposal({
        ...input,
        proposalId: proposal.id,
        proposalHash: proposal.proposal_hash,
        approvedBy: 'owner',
      }),
    ).rejects.toThrow('not_found');
    expect(db.approvals).toHaveLength(0);
  });
  it('detects saved payload and approval tampering before returning a signable proposal', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db);
    const proposal = await createMaterialProposal(input);
    const approve = {
      ...input,
      proposalId: proposal.id,
      proposalHash: proposal.proposal_hash,
      approvedBy: 'owner',
    };
    const approval = await approveMaterialProposal(approve);
    proposal.payload.dossier.summary = 'modified';
    await expect(latestApprovedMaterialProposal(input)).rejects.toThrow('material_changed');
    proposal.payload.dossier.summary = 'Review source evidence.';
    approval.approved_by = 'other';
    await expect(latestApprovedMaterialProposal(input)).rejects.toThrow('material_changed');
  });
  it('hashes canonical JSON without executing getters and fails closed on unsafe or oversized payloads', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db),
      getter = vi.fn();
    const dangerous = { plan: f.plan, dossier: {} };
    Object.defineProperty(dangerous.dossier, 'x', { enumerable: true, get: getter });
    for (const payload of [
      dangerous,
      { plan: f.plan, dossier: null },
      { plan: f.plan, dossier: { text: 'x'.repeat(2_000_001) } },
      { plan: f.plan, dossier: { n: NaN } },
      { plan: f.plan, dossier: { x: undefined } },
      { plan: f.plan, dossier: {}, attestation: {} },
    ])
      await expect(createMaterialProposal({ ...input, payload })).rejects.toThrow(
        'invalid_request',
      );
    expect(getter).not.toHaveBeenCalled();
    const h = materialProposalHash(input);
    expect(
      materialProposalHash({ ...input, payload: { dossier: input.payload.dossier, plan: f.plan } }),
    ).toBe(h);
    expect(materialProposalHash({ ...input, requestId: randomUUID() })).not.toBe(h);
  });
  it('keeps unknown commit outcomes reconcilable and releases the database client', async () => {
    const f = fixture(),
      db = database(f),
      input = args(f, db);
    db.failCommit();
    await expect(createMaterialProposal(input)).rejects.toThrow('commit_unknown');
    expect(db.client.release).toHaveBeenCalledOnce();
  });
  it('seals both tables and provides a separately opted-in exact role extension', () => {
    const f = signalImmutabilityFixture(),
      routine = f.routines.find((r) => r.name === 'hzense_guard_material_proposals');
    expect(signalGuardSourceHash(routine.source)).toBe(
      materialProposalFunctionHashes.hzense_guard_material_proposals,
    );
    expect(inspectSignalImmutabilityCatalog(f, 'hzense_migrator')).toEqual([]);
    expect(materialProposalTriggers).toHaveLength(4);
    f.triggers.find((t) => t.name === 'candidate_material_approvals_guard_trg').enabled = 'O';
    expect(inspectSignalImmutabilityCatalog(f, 'hzense_migrator')).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
    const legacy = materialRoleCheckSQL('hzense_material_registrar');
    expect(legacy).not.toContain("('candidate_material_proposals'");
    const registrar = materialRoleCheckSQL('hzense_material_registrar', { proposals: true });
    expect(registrar).toContain("('candidate_material_proposals','payload','INSERT')");
    expect(registrar).not.toContain("('candidate_material_proposals','created_at','INSERT')");
    const verifier = materialRoleCheckSQL('hzense_material_verifier', { proposals: true });
    expect(verifier).toContain("('candidate_material_approvals','proposal_hash','SELECT')");
    expect(verifier).not.toContain("('candidate_material_approvals','id','INSERT')");
    expect(
      readFileSync(
        new URL('../../../db/roles/configure_material_review.sql', import.meta.url),
        'utf8',
      ),
    ).toBe(materialProposalRoleProvisionSQL());
  });
});
