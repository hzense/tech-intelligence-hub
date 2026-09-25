import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { materialProposalHash } from '../../../packages/database/src/candidate-material-proposal-store.mjs';

// Exercise the real server orchestration; only external storage/identity boundaries
// are substituted. No credentials, database, model or production writes.
const compiled = await build({
  entryPoints: [new URL('../lib/server/material-registration.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'isolated-material-boundaries',
      setup(builder) {
        for (const [filter, path] of [
          [/candidate-material-store\.mjs$/, 'fixture:store'],
          [/candidate-material-proposal-store\.mjs$/, 'fixture:proposals'],
          [/material-registration-role\.mjs$/, 'fixture:role'],
          [/material-registration-config$/, 'fixture:config'],
          [/material-source-reader$/, 'fixture:source'],
          [/^\.\/generation-import-reader$/, 'fixture:imports'],
          [/^\.\/signal-generation$/, 'fixture:generation'],
          [/^\.\.\/candidate-review$/, 'fixture:packet'],
          [/^\.\/candidate-enrichment$/, 'fixture:enrichment'],
        ])
          builder.onResolve({ filter }, () => ({ path, external: true }));
      },
    },
  ],
});
const realRequire = createRequire(import.meta.url);
function fixture() {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const text = 'Ada, researcher at Lab, announced AI X on 2026-09-24.';
  const ref = { fragment_id: 'fragment-1', quote: text };
  const candidate = {
    title: 'AI X announced',
    summary: 'Lab announces AI X.',
    event_date: '2026-09-24',
    event_date_evidence: [ref],
    persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab', evidence: [ref] }],
    organizations: ['Lab'],
    claims: [{ text: 'Lab announced AI X.', evidence: [ref] }],
  };
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    supplements: [],
    source: {
      classification: 'private',
      fragments: [{ id: 'fragment-1', text, locator: { paragraph: 1 } }],
    },
  });
  const request = {
    id: requestId,
    run_id: runId,
    candidate_index: 0,
    base_material_hash: 'a'.repeat(64),
    bundle,
    created_at: '2026-09-25T09:00:00Z',
  };
  const saved = [];
  const env = { HZENSE_MATERIAL_REVIEW_ENABLED: '1' };
  const deps = {
    'server-only': {},
    pg: {
      Pool: class {
        on() {}
        async connect() {
          return {
            async query(sql) {
              if (sql.includes('FROM public.topics')) return { rows: [{ id: 'ai', title: 'AI' }] };
              return { rows: [] };
            },
            release() {},
          };
        }
      },
    },
    'fixture:store': {
      getMaterialRequest: async ({ owner, id }) => {
        if (owner !== 'owner' || id !== requestId)
          throw Object.assign(new Error('not_found'), { code: 'not_found' });
        return request;
      },
    },
    'fixture:proposals': {
      latestApprovedMaterialProposal: async () => null,
      createMaterialProposal: async (args) => {
        saved.push(args);
        return {
          id: '33333333-3333-4333-8333-333333333333',
          proposal_hash: materialProposalHash(args),
        };
      },
    },
    'fixture:role': { assertMaterialRole: async () => {} },
    'fixture:config': {
      requireMaterialWrites: () => {},
      materialDatabaseConfiguration: () => 'synthetic',
    },
    'fixture:source': {
      readMaterialSupplement: async () => ({
        contentHash: 'source',
        sourceUrl: 'https://example.com/article',
      }),
    },
    'fixture:imports': { importPool: {}, importsConfigured: () => true },
    'fixture:generation': { generationRecord: async () => ({ source_hash: 'source' }) },
    'fixture:packet': { buildCandidateReview: () => ({ candidate, materialHash: 'a'.repeat(64) }) },
    'fixture:enrichment': { listCandidateEnrichmentDtos: async () => [] },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', compiled.outputFiles[0].text)(
    (name) => (Object.hasOwn(deps, name) ? deps[name] : realRequire(name)),
    module,
    module.exports,
    { env },
  );
  return {
    saved,
    env,
    candidate,
    prepare: (input = { requestId }, owner = 'owner') =>
      module.exports.prepareCandidateMaterials(owner, input),
    requestId,
  };
}
test('server prepares manual organization evidence, persists actor-bound dossier and leaves approval separate', async () => {
  const f = fixture();
  const blocked = await f.prepare();
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, ['needs_organization_identity']);
  assert.equal(f.saved.length, 0);
  const review = blocked.organizationReview;
  const organizationConfirmation = {
    contextHash: review.contextHash,
    consent: true,
    selections: [
      { name: 'Lab', type: 'institution', evidenceId: review.organizations[0].evidence[0].id },
    ],
  };
  assert.equal((await f.prepare({ requestId: f.requestId, organizationConfirmation })).ready, true);
  assert.equal(f.saved.length, 1);
  const stored = f.saved[0].payload;
  assert.equal(stored.dossier.organizationConfirmation.confirmedBy, 'owner');
  assert.equal(stored.plan.entities.find((row) => row.name === 'Lab').type, 'institution');
  assert.equal(stored.dossier.checks, undefined);
  assert.equal(stored.plan.candidate.title, f.candidate.title);
  await f.prepare({ requestId: f.requestId, organizationConfirmation });
  assert.equal(materialProposalHash(f.saved[0]), materialProposalHash(f.saved[1]));
  f.candidate.summary += ' changed';
  await assert.rejects(f.prepare({ requestId: f.requestId, organizationConfirmation }), {
    code: 'material_changed',
  });
  assert.equal(f.saved.length, 2);
  await assert.rejects(
    f.prepare({ requestId: f.requestId, organizationConfirmation }, 'another-owner'),
    { code: 'not_found' },
  );
  f.env.HZENSE_MATERIAL_REVIEW_ENABLED = '0';
  await assert.rejects(f.prepare(), { code: 'not_configured' });
});
