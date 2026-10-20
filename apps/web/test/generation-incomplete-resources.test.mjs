import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { URL } from 'node:url';
import { build } from 'esbuild';
import {
  assessGeneratedCandidates,
  GENERATION_RESOURCES_CONTRACT,
  normalizeGeneratedCandidates,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { candidateReviewMaterialHash } from '../../../packages/database/src/candidate-review-contract.mjs';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { buildCandidateReview, buildEnrichedCandidateReview } from '../lib/candidate-review.ts';

const { structuredClone } = globalThis;
const id = '11111111-1111-4111-8111-111111111111';
const sourceUrl = 'https://example.com/announcement';
const topics = [{ id: 'topic-ai', title: '人工智能' }];
const ref = (quote) => ({ fragment_id: 'fragment-1', quote });
const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: 'Lab is a company. Ada, researcher at Lab, announced X on 2026-10-20. Partner is an institution.',
      locator: { paragraph: 1 },
    },
  ],
};
const resource = (type, name, quote) => ({
  type,
  name,
  introduction: null,
  event_role: null,
  evidence: [ref(quote)],
});
const lab = resource('company', 'Lab', 'Lab is a company.');
const ada = resource('person', 'Ada', 'Ada, researcher at Lab');
const partner = resource('institution', 'Partner', 'Partner is an institution.');
const raw = {
  title: 'Lab 发布 X',
  summary: 'Lab 的研究人员 Ada 宣布发布 X。',
  event_date: '2026-10-20',
  event_date_evidence: [ref('2026-10-20')],
  persons: [
    {
      name: 'Ada',
      role: 'researcher',
      organization: 'Lab',
      evidence: [ref('Ada, researcher at Lab')],
    },
  ],
  organizations: ['Lab', 'Partner'],
  claims: [{ text: 'Ada 宣布发布 X。', evidence: [ref('Ada, researcher at Lab, announced X')] }],
  signal_type: 'product',
  topic_ids: ['topic-ai'],
  resources: [lab],
};
const missing = [
  { type: 'person', name: 'Ada' },
  { type: 'organization', name: 'Partner' },
];
function fixture() {
  return {
    id,
    owner_id: 'owner',
    status: 'completed',
    deleted_at: null,
    source_hash: signalGenerationSourceHash(source),
    snapshot: {
      source: structuredClone(source),
      topics: structuredClone(topics),
      output_contract: GENERATION_RESOURCES_CONTRACT,
    },
    result: assessGeneratedCandidates(
      { candidates: [structuredClone(raw)], reason: '私有候选' },
      source,
      topics,
      GENERATION_RESOURCES_CONTRACT,
    ),
  };
}
function proposal(resources = [ada, partner]) {
  return {
    event_date: raw.event_date,
    event_date_evidence: structuredClone(raw.event_date_evidence),
    persons: structuredClone(raw.persons),
    organizations: [...raw.organizations],
    resources: structuredClone(resources),
  };
}

test('incomplete resources remain reviewable with a recomputed issue and matching database material identity', () => {
  const run = fixture();
  assert.equal(run.result.candidates.length, 1);
  assert.deepEqual(run.result.rejected, []);
  const before = JSON.stringify(run);
  const packet = buildCandidateReview(run, 0);
  assert.equal(packet.canPublish, false);
  assert.equal(packet.materialHash, candidateReviewMaterialHash(run, 0));
  assert.deepEqual(packet.candidate.resources, [lab]);
  assert.deepEqual(packet.candidate.organizations, ['Lab', 'Partner']);
  assert.deepEqual(packet.candidate.persons, raw.persons);
  assert.ok(packet.candidate.issues.includes('needs_resource_details'));
  assert.equal(JSON.stringify(run), before);

  // Persisted/model assertions cannot hide the missing-resource requirement.
  run.result.candidates[0].issues = [];
  const rechecked = buildCandidateReview(run, 0);
  assert.ok(rechecked.candidate.issues.includes('needs_resource_details'));
  assert.equal(rechecked.materialHash, packet.materialHash);
  assert.equal(rechecked.materialHash, candidateReviewMaterialHash(run, 0));
  assert.throws(() =>
    normalizeGeneratedCandidates(
      { candidates: [raw], reason: '严格补全检查' },
      source,
      topics,
      GENERATION_RESOURCES_CONTRACT,
    ),
  );
});

test('strict enrichment completes missing resource identities without changing the original candidate or review identity', () => {
  const run = fixture();
  const before = JSON.stringify(run);
  const original = buildCandidateReview(run, 0);
  const enriched = buildEnrichedCandidateReview(run, 0, proposal());
  assert.equal(enriched.materialHash, original.materialHash);
  assert.deepEqual(enriched.candidate.resources, [lab, ada, partner]);
  assert.equal(enriched.candidate.issues.includes('needs_resource_details'), false);
  for (const field of ['title', 'summary', 'claims', 'persons', 'organizations'])
    assert.deepEqual(enriched.candidate[field], original.candidate[field]);
  assert.equal(JSON.stringify(run), before);

  assert.throws(() => buildEnrichedCandidateReview(run, 0, proposal([])), {
    code: 'invalid_enrichment_output',
  });
  assert.throws(() => buildEnrichedCandidateReview(run, 0, proposal([ada])), {
    code: 'invalid_enrichment_output',
  });
  assert.throws(
    () =>
      buildEnrichedCandidateReview(
        run,
        0,
        proposal([{ ...ada, evidence: [ref('invented identity evidence')] }, partner]),
      ),
    { code: 'invalid_enrichment_output' },
  );
});

async function actualEditorialService() {
  const modules = {
    'server-only': 'export {};',
    '../unified-signal-mode': 'export const unifiedSignalEnabled = () => false;',
    '../../../../packages/database/src/editorial-signal-store.mjs': `
      export const saveEditorialSignal = async (args) => globalThis.__incompleteResourceTest.save(args);
      export const readEditorialSignal = async () => null;
      export const previewEditorialResources = async () => [];
    `,
    './signal-generation':
      'export const generationRecord = async () => globalThis.__incompleteResourceTest.run;',
    './candidate-enrichment':
      'export const listCandidateEnrichmentDtos = async () => globalThis.__incompleteResourceTest.enrichments;',
    './material-registration':
      'export const materialPublicationPreview = async () => globalThis.__incompleteResourceTest.preview;',
    './editorial-database': `
      export const editorialPool = {};
      export const editorialPublicationEnabled = () => true;
      export const editorialResourcePublicationReady = async () => true;
    `,
    './candidate-review-database': 'export const candidateReviewPool = {};',
    './editorial-topics':
      'export const editorialTopicOptions = async () => globalThis.__incompleteResourceTest.topics;',
    './generation-import-reader': 'export const importPool = {};',
    '../material-source-reader': 'export const readMaterialSupplement = async () => null;',
    '../editorial-source-options':
      'export const readEditorialSourceOptions = async () => [globalThis.__incompleteResourceTest.sourceUrl];',
    '../seed-runtime': 'export const getResourceEntries = async () => [];',
    '../local-generation': 'export const localFixtureSourceOptions = () => [];',
  };
  const bundled = await build({
    entryPoints: [new URL('../lib/server/editorial-review.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    footer: { js: '//# sourceURL=hzense-incomplete-resources-editorial-test.mjs' },
    plugins: [
      {
        name: 'isolate-incomplete-resource-editorial-io',
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            modules[args.path] === undefined
              ? undefined
              : { path: args.path, namespace: 'fixture' },
          );
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: modules[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
}

test('actual editorial material preserves missing identities as a publication gate until validated enrichment completes them', async () => {
  const run = fixture();
  const attempts = [];
  globalThis.__incompleteResourceTest = {
    run,
    topics,
    sourceUrl,
    enrichments: [],
    preview: null,
    async save(args) {
      attempts.push(args);
      const checked = normalizeEditorialRequest(args.request, args.material);
      return {
        request_id: checked.requestId,
        revision: 1,
        action: checked.action,
        content: checked.content,
      };
    },
  };
  const state = globalThis.__incompleteResourceTest;
  try {
    const { editorialDashboard, writeEditorialReview } = await actualEditorialService();
    const dashboard = await editorialDashboard('owner', id, 0);
    assert.deepEqual(dashboard.missingResourceDetails, missing);
    // Read-only resource projection cannot silently discard the obligations
    // from the original candidate, even when every visible field is filled.
    assert.deepEqual(dashboard.content.organizations, ['Lab']);
    assert.deepEqual(dashboard.content.persons, []);
    const request = {
      requestId: '22222222-2222-4222-8222-222222222222',
      runId: id,
      candidateIndex: 0,
      materialHash: dashboard.materialHash,
      expectedRevision: 0,
      action: 'publish',
      consent: true,
      content: { ...dashboard.content, sourceUrls: [sourceUrl] },
    };
    await assert.rejects(writeEditorialReview('owner', request), {
      code: 'resource_details_incomplete',
    });
    assert.deepEqual(attempts[0].material.missingResourceDetails, missing);

    const enriched = buildEnrichedCandidateReview(run, 0, proposal());
    state.enrichments = [
      {
        status: 'completed',
        material_hash: dashboard.materialHash,
        result: { candidate: enriched.candidate },
      },
    ];
    const completed = await editorialDashboard('owner', id, 0);
    assert.deepEqual(completed.missingResourceDetails, []);
    assert.deepEqual(completed.content.organizations, ['Lab', 'Partner']);
    assert.deepEqual(completed.content.persons, ['Ada']);
    assert.equal(completed.materialHash, dashboard.materialHash);
    const published = await writeEditorialReview('owner', {
      ...request,
      content: { ...completed.content, sourceUrls: [sourceUrl] },
    });
    assert.equal(published.action, 'publish');
    assert.deepEqual(attempts.at(-1).material.missingResourceDetails, []);

    // Corrupt enrichment must fall back to the immutable original and remain blocked.
    state.enrichments[0].result.candidate.resources = [lab];
    const failedEnrichment = await editorialDashboard('owner', id, 0);
    assert.deepEqual(failedEnrichment.missingResourceDetails, missing);
  } finally {
    delete globalThis.__incompleteResourceTest;
  }
});

test('actual editorial material checks supplemented resource coverage against immutable identities, not just supplied lists', async () => {
  const run = fixture();
  globalThis.__incompleteResourceTest = {
    run,
    topics,
    sourceUrl,
    enrichments: [],
    preview: {
      editorialPrefill: {
        eventDate: raw.event_date,
        persons: [],
        organizations: ['Lab'],
        topics,
        resources: [lab],
        resourceSourceOptions: [{ name: 'Lab', type: 'company', sourceUrls: [sourceUrl] }],
      },
    },
  };
  try {
    const { editorialDashboard } = await actualEditorialService();
    const incomplete = await editorialDashboard('owner', id, 0);
    assert.deepEqual(incomplete.missingResourceDetails, missing);
    globalThis.__incompleteResourceTest.preview.editorialPrefill = {
      eventDate: raw.event_date,
      persons: ['Ada'],
      organizations: ['Lab', 'Partner'],
      topics,
      resources: [lab, ada, partner],
      resourceSourceOptions: [lab, ada, partner].map(({ name, type }) => ({
        name,
        type,
        sourceUrls: [sourceUrl],
      })),
    };
    const completed = await editorialDashboard('owner', id, 0);
    assert.deepEqual(completed.missingResourceDetails, []);
    assert.deepEqual(completed.content.persons, ['Ada']);
    assert.deepEqual(completed.content.organizations, ['Lab', 'Partner']);
  } finally {
    delete globalThis.__incompleteResourceTest;
  }
});
