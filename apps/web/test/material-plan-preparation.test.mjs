/* global structuredClone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { prepareMaterialPlan } from '../lib/material-plan-preparation.ts';
import { approvedMaterialDossier } from '../lib/material-review-dossier.ts';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import {
  assessMaterialVerification,
  signMaterialVerification,
} from '../../../packages/database/src/material-verification-worker.mjs';
import { verifyMaterialAttestation } from '../../../packages/database/src/material-registration-contract.mjs';

const excerpt = 'Ada, researcher at Lab, announced AI X on 2026-09-24.';
const now = new Date('2026-09-24T12:00:00.000Z');
const ref = { fragment_id: 'fragment-1', quote: excerpt };
function packet() {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    owner: 'owner',
    runId: '22222222-2222-4222-8222-222222222222',
    candidateIndex: 0,
    baseMaterialHash: 'a'.repeat(64),
    bundle: buildCandidateSourceBundle({
      baseMaterialHash: 'a'.repeat(64),
      supplements: [],
      source: {
        classification: 'private',
        fragments: [{ id: 'fragment-1', text: excerpt, locator: { paragraph: 1 } }],
      },
    }),
    originalSourceUrl: 'https://example.com/article',
    candidate: {
      title: 'AI X announced',
      summary: 'Lab announces AI X.',
      event_date: '2026-09-24',
      event_date_evidence: [ref],
      persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab', evidence: [ref] }],
      organizations: ['Lab'],
      claims: [{ text: 'Lab announced AI X.', evidence: [ref] }],
    },
    catalog: {
      topics: [{ id: 'ai', title: 'AI' }],
      sources: [],
      entities: [{ id: 'lab', type: 'institution', name: 'Lab', aliases: [], status: 'active' }],
    },
  };
}
test('rules prepare deterministic private plan; human approval plus live reread is required for signature', async () => {
  const request = packet();
  const a = prepareMaterialPlan(request, now),
    b = prepareMaterialPlan(request, now);
  assert.deepEqual(a, b);
  assert.equal(a.ready, true);
  assert.equal(a.payload.dossier.version, 'material-review-draft-v1');
  assert.equal(a.payload.dossier.checks, undefined);
  assert.equal(a.payload.plan.candidate.title, request.candidate.title);
  const approval = { owner_id: 'owner', approved_by: 'owner', created_at: now.toISOString() };
  const dossier = approvedMaterialDossier(a.payload, approval);
  assert.equal(dossier.sources[0].usageRights.approved, true);
  // jsonb objects may be reordered; this cannot invalidate a matching approval.
  const reordered = structuredClone(a.payload);
  reordered.dossier.statements = Object.fromEntries(
    Object.entries(reordered.dossier.statements).reverse(),
  );
  assert.deepEqual(approvedMaterialDossier(reordered, approval), dossier);
  const assessment = await assessMaterialVerification({
    request,
    plan: a.payload.plan,
    dossier,
    clock: () => now,
    fetchSource: async (sourceUrl) => ({ sourceUrl, text: excerpt, fetchedAt: now.toISOString() }),
  });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const envelope = signMaterialVerification({
    assessment,
    approvedDossierHash: assessment.dossierHash,
    keyId: 'test',
    verifierId: 'independent',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now,
  });
  assert.equal(
    verifyMaterialAttestation({
      envelope,
      plan: a.payload.plan,
      now,
      trustedVerifiers: {
        test: {
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
          verifierId: 'independent',
        },
      },
    }).planHash,
    a.payload.dossier.planHash,
  );
});
test('distinct immutable request snapshots do not collide on evidence IDs', () => {
  const first = prepareMaterialPlan(packet(), now);
  const second = prepareMaterialPlan(
    { ...packet(), requestId: '33333333-3333-4333-8333-333333333333' },
    new Date(now.getTime() + 1000),
  );
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.notEqual(first.payload.plan.evidence[0].id, second.payload.plan.evidence[0].id);
});
for (const [name, mutate, code] of [
  [
    'missing person',
    (p) => {
      p.candidate.persons = [];
    },
    'needs_person_evidence',
  ],
  [
    'missing date',
    (p) => {
      p.candidate.event_date = null;
    },
    'needs_event_time',
  ],
  [
    'private file only',
    (p) => {
      p.originalSourceUrl = null;
    },
    'needs_public_evidence',
  ],
  [
    'unsupported role',
    (p) => {
      p.candidate.persons[0].role = 'CEO';
    },
    'needs_public_evidence',
  ],
  [
    'unknown organization type',
    (p) => {
      p.catalog.entities = [];
    },
    'needs_organization_identity',
  ],
  [
    'archived entity',
    (p) => {
      p.catalog.entities[0].status = 'archived';
    },
    'material_entity_ambiguous',
  ],
  [
    'ambiguous entity',
    (p) => {
      p.catalog.entities.push({ ...p.catalog.entities[0], id: 'other' });
    },
    'material_entity_ambiguous',
  ],
  [
    'unrelated topic',
    (p) => {
      p.catalog.topics[0].title = 'Quantum';
    },
    'needs_topic_evidence',
  ],
  [
    'disabled source',
    (p) => {
      p.catalog.sources.push({
        id: 'old',
        name: 'old',
        active: false,
        allowed_hosts: ['example.com'],
      });
    },
    'source_conflict',
  ],
])
  test(`preparation blocks ${name} without fabrication`, () => {
    const p = packet();
    mutate(p);
    const before = JSON.stringify(p);
    assert.deepEqual(prepareMaterialPlan(p, now), { ready: false, blockers: [code] });
    assert.equal(JSON.stringify(p), before);
  });
test('approval cannot change owner, plan hash or six statements', () => {
  const { payload } = prepareMaterialPlan(packet(), now);
  assert.throws(
    () =>
      approvedMaterialDossier(payload, {
        owner_id: 'owner',
        approved_by: 'other',
        created_at: now,
      }),
    /material_changed/,
  );
  const changed = structuredClone(payload);
  changed.dossier.statements.usageRights = 'Assumed by model';
  assert.throws(
    () =>
      approvedMaterialDossier(changed, {
        owner_id: 'owner',
        approved_by: 'owner',
        created_at: now,
      }),
    /material_changed/,
  );
});
