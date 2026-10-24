import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorialReviewService } from '../lib/editorial-review-service.ts';
import { createEditorialHandler } from '../lib/admin-editorial-handler.ts';
import { editorialMissing } from '../lib/editorial-review.ts';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
const { Request } = globalThis;

const runId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const materialHash = 'a'.repeat(64);
const sourceUrl = 'https://example.com/news';
const dateSuggestion = {
  date: '2026-10-23',
  evidence: [{ fragment_id: 'fragment-1', quote: '3 min read\n\nOct 23, 2026' }],
};
const previewRequest = () => ({
  action: 'preview_organization',
  runId,
  candidateIndex: 0,
  materialHash,
  organization: { type: 'institution', name: '测试研究所' },
});
function setup() {
  let saved = null;
  const calls = [];
  const material = {
    materialHash,
    warnings: [],
    resources: [],
    sourceOptions: [sourceUrl],
    publicationDateSuggestion: dateSuggestion,
    missingResourceDetails: [{ type: 'organization', name: '测试研究所' }],
    content: {
      title: '测试标题',
      summary: '测试摘要',
      eventDate: null,
      dateBasis: 'source_published',
      signalType: 'research',
      organizations: [],
      persons: [],
      resources: [],
      topics: [{ id: 'ai', title: 'AI' }],
      sourceUrls: [],
    },
  };
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async (owner) => {
      if (owner !== 'owner') throw Object.assign(new Error('not_found'), { code: 'not_found' });
      return material;
    },
    topics: async () => material.content.topics,
    read: async () => saved,
    resources: async (resources) =>
      resources.map((r) => ({
        name: r.name,
        type: r.type,
        status: 'reuse',
        matches: [{ id: 'institution-test', name: r.name, type: r.type }],
      })),
    resourcePublicationReady: async () => true,
    save: async (owner, request, bound, options) => {
      normalizeEditorialRequest(request, bound, { automatic: options?.automatic === true });
      calls.push({ owner, request, bound });
      saved = {
        request_id: request.requestId,
        revision: 1,
        action: request.action,
        content: request.content,
        publication_basis: 'manual_confirmation',
      };
      return saved;
    },
  });
  return {
    service,
    calls,
    material,
    get saved() {
      return saved;
    },
  };
}

test('old candidate exposes a date suggestion without changing saved content or material identity', async () => {
  const f = setup();
  const before = JSON.stringify(f.material);
  const dashboard = await f.service.read('owner', runId, 0);
  assert.deepEqual(dashboard.publicationDateSuggestion, dateSuggestion);
  assert.equal(dashboard.content.eventDate, null);
  assert.equal(dashboard.materialHash, materialHash);
  assert.equal(JSON.stringify(f.material), before);
  assert.equal(f.saved, null);
  assert.equal(f.calls.length, 0);
});

test('organization preview is owner/material bound, read-only, and cannot accept generated/person evidence', async () => {
  const f = setup();
  const preview = await f.service.previewOrganization('owner', previewRequest());
  assert.equal(preview.resource.basis, 'manual_confirmation');
  assert.deepEqual(preview.resource.evidence, []);
  assert.equal(preview.resource.entity_id, 'institution-test');
  assert.deepEqual(preview.sourceUrls, [sourceUrl]);
  assert.equal(f.saved, null);
  for (const bad of [
    { ...previewRequest(), materialHash: 'b'.repeat(64) },
    { ...previewRequest(), organization: { type: 'person', name: '错误人物' } },
    {
      ...previewRequest(),
      organization: {
        ...previewRequest().organization,
        evidence: [{ fragment_id: 'fragment-1', quote: '伪造' }],
      },
    },
    { ...previewRequest(), sourceUrls: ['https://attacker.example'] },
  ])
    await assert.rejects(f.service.previewOrganization('owner', bad));
  await assert.rejects(f.service.previewOrganization('other-owner', previewRequest()), {
    code: 'not_found',
  });
  assert.equal(f.calls.length, 0);
});

test('manual organization and adopted date survive draft save/reread and are publishable with explicit source consent', async () => {
  const f = setup();
  const before = JSON.stringify(f.material);
  const initial = await f.service.read('owner', runId, 0);
  const preview = await f.service.previewOrganization('owner', previewRequest());
  const content = {
    ...initial.content,
    eventDate: dateSuggestion.date,
    organizations: [preview.resource.name],
    resources: [preview.resource],
    sourceUrls: [sourceUrl],
  };
  const request = {
    requestId,
    runId,
    candidateIndex: 0,
    expectedRevision: 0,
    materialHash,
    action: 'draft',
    content,
    consent: false,
  };
  await f.service.write('owner', request);
  const reread = await f.service.read('owner', runId, 0);
  assert.deepEqual(reread.content, content);
  assert.equal(reread.publicationDateSuggestion, undefined);
  assert.deepEqual(reread.warnings, []);
  assert.deepEqual(
    editorialMissing(
      reread.content,
      reread.resourceOptions,
      reread.resourceSourceOptions,
      reread.missingResourceDetails,
    ),
    [],
  );
  assert.equal(
    (
      await f.service.write('owner', {
        ...request,
        requestId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: 1,
        action: 'publish',
        consent: true,
      })
    ).action,
    'publish',
  );
  assert.equal(JSON.stringify(f.material), before);
  await assert.rejects(
    f.service.write(
      'owner',
      { ...request, action: 'publish', consent: false },
      { automatic: true },
    ),
    { code: 'automatic_publication_invalid' },
  );
});

test('manual coverage never hides person or unrelated organization gaps', async () => {
  const f = setup();
  const { resource } = await f.service.previewOrganization('owner', previewRequest());
  const content = {
    ...f.material.content,
    eventDate: dateSuggestion.date,
    organizations: [resource.name],
    resources: [resource],
    sourceUrls: [sourceUrl],
  };
  const missing = editorialMissing(
    content,
    [],
    [{ name: resource.name, type: resource.type, sourceUrls: [sourceUrl] }],
    [
      { type: 'organization', name: '测试研究所' },
      { type: 'organization', name: '另一组织' },
      { type: 'person', name: '测试研究所' },
    ],
  );
  assert.deepEqual(missing, ['另一组织 的组织资源资料', '测试研究所 的人物资源资料']);
});

test('preview route shares session/origin controls and never dispatches a publication write', async () => {
  const f = setup();
  let writes = 0;
  const handler = createEditorialHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => 'http://127.0.0.1:3000',
    read: () => Promise.resolve({}),
    write: async () => {
      writes++;
      return {};
    },
    previewOrganization: f.service.previewOrganization,
  });
  const request = (origin) =>
    new Request('http://127.0.0.1:3000/api/admin/editorial-signals', {
      method: 'POST',
      headers: { host: '127.0.0.1:3000', origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(previewRequest()),
    });
  assert.equal((await handler(request('https://attacker.example'))).status, 403);
  const response = await handler(request('http://127.0.0.1:3000'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).resource.basis, 'manual_confirmation');
  assert.equal(writes, 0);
  assert.equal(f.calls.length, 0);
});
