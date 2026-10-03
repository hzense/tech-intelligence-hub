import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { materialEnrichmentInput, assessMaterialEnrichment } from '../lib/material-enrichment.ts';

const id = '11111111-1111-4111-8111-111111111111';
const extraId = '22222222-2222-4222-8222-222222222222';
const fragment = (text) => ({
  classification: 'private',
  fragments: [{ id: 'fragment-1', text, locator: { paragraph: 1 } }],
});
const ref = (number, quote) => ({ fragment_id: `fragment-${number}`, quote });

test('actual material publication bridge forwards restored resources with provenance from the owner-bound bundle', async () => {
  const source = fragment('Lab announced X on 2026-09-24.');
  const supplement = fragment(
    'Lab is a company. Ada, researcher at Lab, announced X on 2026-09-24.',
  );
  const sourceUrl = 'https://example.com/original';
  const extraUrl = 'https://example.com/supplement';
  const original = {
    materialHash: 'a'.repeat(64),
    candidate: {
      index: 0,
      classification: 'private',
      status: 'needs_review',
      issues: [],
      title: 'Lab 发布 X',
      summary: 'Lab 发布 X。',
      event_date: '2026-09-24',
      event_date_evidence: [ref(1, '2026-09-24')],
      persons: [],
      organizations: ['Lab'],
      claims: [{ text: 'Lab 发布 X', evidence: [ref(1, 'Lab announced X')] }],
      signal_type: 'product',
      topic_ids: ['topic-ai'],
      resources: [
        {
          type: 'company',
          name: 'Lab',
          introduction: null,
          event_role: '发布 X',
          evidence: [ref(1, 'Lab announced X')],
        },
      ],
    },
  };
  const extraReceipt = {
    batchId: extraId,
    itemId: extraId,
    fence: 2,
    contentHash: signalGenerationSourceHash(supplement),
    sourceUrl: extraUrl,
    source: supplement,
  };
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: original.materialHash,
    source,
    supplements: [extraReceipt],
  });
  const context = { topics: [{ id: 'topic-ai', title: '人工智能' }] };
  const selected = materialEnrichmentInput(bundle, original.candidate);
  const person = {
    name: 'Ada',
    role: 'researcher',
    organization: 'Lab',
    evidence: [ref(2, 'Ada, researcher at Lab')],
  };
  const proposal = {
    event_date: '2026-09-24',
    event_date_evidence: [ref(2, '2026-09-24')],
    persons: [person],
    organizations: ['Lab'],
    claim_evidence: [[ref(2, supplement.fragments[0].text)]],
    organization_identities: [
      { name: 'Lab', type: 'company', evidence: [ref(2, 'Lab is a company.')] },
    ],
    topic_ids: ['topic-ai'],
    resources: [
      {
        type: 'person',
        name: 'Ada',
        introduction: 'Researcher at Lab.',
        event_role: '研究人员',
        evidence: person.evidence,
      },
    ],
  };
  const result = assessMaterialEnrichment(proposal, selected.candidate, selected.source, context);
  const state = {
    run: {
      owner_id: 'owner',
      batch_id: id,
      item_id: id,
      source_fence: 1,
      source_hash: signalGenerationSourceHash(source),
    },
    requests: [
      {
        id,
        base_material_hash: original.materialHash,
        bundle_hash: bundle.sourceBundleHash,
        bundle,
      },
    ],
    tasks: [
      {
        id: extraId,
        status: 'completed',
        material_hash: bundle.sourceBundleHash,
        created_at: '2026-10-03T00:00:00Z',
        result,
      },
    ],
    topics: context.topics,
    receipts: {
      [id]: {
        batchId: id,
        itemId: id,
        fence: 1,
        contentHash: signalGenerationSourceHash(source),
        sourceUrl,
      },
      [extraId]: extraReceipt,
    },
    sourceReads: [],
    requestReads: [],
  };
  globalThis.__resourcePrefillTest = state;
  try {
    const modules = {
      'server-only': 'export {};',
      pg: `export default {Pool: class {on() {} async connect() {return {query:async () => ({rows:globalThis.__resourcePrefillTest.topics}),release(){}}}}};`,
      '../../../../packages/database/src/candidate-material-store.mjs': `export const readMaterialRequests = async (args) => {globalThis.__resourcePrefillTest.requestReads.push(args);return globalThis.__resourcePrefillTest.requests;}; export const getMaterialRequest = () => {}; export class CandidateMaterialStoreError extends Error {} export const createMaterialRequest = () => {}; export const getMaterialReport = () => {}; export const saveMaterialReport = () => {}; export const latestVerifiedMaterialReport = () => {};`,
      '../../../../packages/database/src/material-registration-role.mjs':
        'export const assertMaterialRole = async () => {};',
      '../material-registration-config': `export const materialDatabaseConfiguration = () => 'fixture'; export const materialKeyring = () => ({}); export const requireMaterialWrites = () => {};`,
      './signal-generation':
        'export const generationRecord = async () => globalThis.__resourcePrefillTest.run;',
      './generation-import-reader':
        'export const importPool = {}; export const importsConfigured = () => true;',
      './candidate-enrichment':
        'export const listCandidateEnrichmentDtos = async () => globalThis.__resourcePrefillTest.tasks; export const createCandidateEnrichment = () => {}; export const candidateEnrichmentConfigured = () => true;',
      '../material-source-reader':
        'export const readMaterialSupplement = async (_pool, owner, batchId, itemId) => {globalThis.__resourcePrefillTest.sourceReads.push([owner,batchId,itemId]);return globalThis.__resourcePrefillTest.receipts[batchId];};',
    };
    const bundled = await build({
      entryPoints: [new URL('../lib/server/material-registration.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-resource-prefill',
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
    const { materialPublicationPreview } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const preview = await materialPublicationPreview('owner', id, 0, original);
    assert.deepEqual(preview.editorialPrefill.resources, result.candidate.resources);
    assert.deepEqual(preview.editorialPrefill.resourceSourceOptions, [
      { name: 'Lab', type: 'company', sourceUrls: [sourceUrl] },
      { name: 'Ada', type: 'person', sourceUrls: [extraUrl] },
    ]);
    assert.deepEqual(preview.editorialPrefill.sourceOptions, [sourceUrl, extraUrl]);
    assert.deepEqual(preview.editorialPrefill.persons, ['Ada']);
    assert.equal(state.requestReads[0].owner, 'owner');
    assert.deepEqual(state.sourceReads, [
      ['owner', id, id],
      ['owner', extraId, extraId],
    ]);
    state.receipts[extraId] = { ...extraReceipt, fence: 3 };
    const changed = await materialPublicationPreview('owner', id, 0, original);
    assert.deepEqual(changed.editorialPrefill.resourceSourceOptions[1].sourceUrls, []);
    assert.deepEqual(changed.editorialPrefill.resources, result.candidate.resources);
  } finally {
    delete globalThis.__resourcePrefillTest;
  }
});
