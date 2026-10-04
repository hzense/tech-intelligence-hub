import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
const { Request, structuredClone } = globalThis;
import { createEditorialReviewService } from '../lib/editorial-review-service.ts';
import { createEditorialHandler } from '../lib/admin-editorial-handler.ts';
import { editorialMissing, editorialNames } from '../lib/editorial-review.ts';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';

const runId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const content = {
  title: '合成标题',
  summary: '测试摘要',
  eventDate: '2026-09-25',
  signalType: 'product',
  organizations: ['合成组织'],
  persons: ['测试人物'],
  topics: [{ id: 'ai', title: 'AI' }],
  sourceUrls: [],
};
const materialHash = 'a'.repeat(64);
function setup() {
  const calls = [];
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async (owner, id, index) => {
      calls.push(['material', owner, id, index]);
      return { materialHash, content, warnings: [] };
    },
    topics: async () => content.topics,
    read: async () => null,
    save: async (owner, request, material) => {
      normalizeEditorialRequest(request, material);
      calls.push(['save', owner, request, material]);
      return {
        request_id: request.requestId,
        revision: 1,
        action: request.action,
        content: request.content,
      };
    },
  });
  return { service, calls };
}
const request = () => ({
  requestId,
  runId,
  candidateIndex: 0,
  expectedRevision: 0,
  materialHash,
  action: 'publish',
  content: structuredClone(content),
  consent: true,
});
test('publication metadata determines readiness; names normalize without invented entities', () => {
  assert.deepEqual(editorialMissing(content), []);
  assert.deepEqual(
    editorialMissing({
      ...content,
      eventDate: '2026-02-30',
      signalType: null,
      persons: [],
      organizations: [],
      topics: [],
    }),
    ['事件类型', '事件日期', '组织', '人物', '领域'],
  );
  assert.deepEqual(editorialNames('甲、乙\n甲，丙；丁'), ['甲', '乙', '丙', '丁']);
});
test('publication switch participates in build cache invalidation and stays closed in example configuration', async () => {
  const turbo = JSON.parse(await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'));
  assert.ok(turbo.globalEnv.includes('HZENSE_EDITORIAL_PUBLICATION_ENABLED'));
  const example = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^HZENSE_EDITORIAL_PUBLICATION_ENABLED=0$/m);
  assert.match(example, /^HZENSE_EDITORIAL_DATABASE_URL=$/m);
  assert.match(example, /^HZENSE_EDITORIAL_READER_DATABASE_URL=$/m);
});
test('service binds owner and immutable material while allowing manual four-field inputs', async () => {
  const { service, calls } = setup();
  const edit = request();
  edit.content.persons = ['人工补充姓名'];
  const result = await service.write('owner', edit);
  assert.equal(result.action, 'publish');
  assert.match(result.publicId, /^editorial-[a-f0-9]{32}$/);
  assert.equal(result.publicId.includes(runId), false);
  assert.equal(calls[1][1], 'owner');
  assert.deepEqual(calls[1][2].content.persons, ['人工补充姓名']);
  const dashboard = await service.read('owner', runId, 0);
  assert.equal(dashboard.revision, 0);
  assert.equal(dashboard.configured, true);
});
test('generation preselection uses the current enabled catalog and never overwrites saved selections', async () => {
  const topicOptions = [{ id: 'ai', title: '当前领域名称' }];
  let saved = null;
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({
      materialHash,
      content: { ...content, topics: [] },
      warnings: [],
      generatedTopicIds: ['ai', 'disabled-topic'],
    }),
    topics: async () => topicOptions,
    read: async () => saved,
    save: async () => {
      throw new Error('read-only preparation must not save');
    },
  });
  const prepared = await service.read('owner', runId, 0);
  assert.deepEqual(prepared.content.topics, topicOptions);
  assert.equal(prepared.action, null);
  for (const topics of [[], [{ id: 'manual-topic', title: '人工选择' }]]) {
    saved = {
      request_id: requestId,
      revision: 1,
      action: 'draft',
      content: { ...content, topics },
    };
    assert.deepEqual((await service.read('owner', runId, 0)).content.topics, topics);
  }
});
test('source choices are private until selected; saved links survive source removal and withdrawal', async () => {
  let saved = null;
  let sourceOptions = ['https://example.com/article'];
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({ materialHash, content, warnings: [], sourceOptions }),
    topics: async () => content.topics,
    read: async () => saved,
    save: async (_owner, request, bound) => {
      normalizeEditorialRequest(request, {
        ...bound,
        sourceOptions: [...bound.sourceOptions, ...(saved?.content.sourceUrls ?? [])],
      });
      return (saved = {
        request_id: request.requestId,
        revision: (saved?.revision ?? 0) + 1,
        action: request.action,
        content: request.content,
      });
    },
  });
  const dashboard = await service.read('owner', runId, 0);
  assert.deepEqual(dashboard.sourceOptions, sourceOptions);
  assert.deepEqual(dashboard.content.sourceUrls, []);
  const selected = { ...request(), content: { ...content, sourceUrls: sourceOptions } };
  assert.deepEqual((await service.write('owner', selected)).content.sourceUrls, sourceOptions);
  sourceOptions = [];
  assert.deepEqual((await service.read('owner', runId, 0)).sourceOptions, [
    'https://example.com/article',
  ]);
  assert.deepEqual((await service.write('owner', selected)).content.sourceUrls, [
    'https://example.com/article',
  ]);
  await assert.rejects(
    service.write('owner', {
      ...selected,
      content: { ...content, sourceUrls: ['https://forged.example'] },
    }),
    { code: 'material_changed' },
  );
  assert.equal(
    (await service.write('owner', { ...selected, action: 'withdraw' })).action,
    'withdraw',
  );
});
test('service rejects immutable text changes, missing confirmation, missing fields and unknown payload', async () => {
  const { service, calls } = setup();
  for (const modify of [
    (r) => {
      r.content.title = '篡改标题';
    },
    (r) => {
      r.content.sourceUrls = ['https://private.example/a'];
    },
    (r) => {
      r.consent = false;
    },
    (r) => {
      r.content.persons = [];
    },
    (r) => {
      r.extra = true;
    },
    (r) => {
      r.materialHash = 'b'.repeat(64);
    },
  ]) {
    const r = request();
    modify(r);
    await assert.rejects(service.write('owner', r));
  }
  assert.equal(
    calls.some((c) => c[0] === 'save'),
    false,
  );
});
test('partial draft allowed; feature disabled performs no save/read of ledger', async () => {
  const { service } = setup();
  const r = request();
  r.action = 'draft';
  r.consent = false;
  r.content.persons = [];
  assert.equal((await service.write('owner', r)).action, 'draft');
  let touched = false;
  const disabled = createEditorialReviewService({
    enabled: () => false,
    material: async () => ({ materialHash, content, warnings: [] }),
    topics: async () => [],
    read: async () => {
      touched = true;
    },
    save: async () => {
      touched = true;
    },
  });
  assert.equal((await disabled.read('owner', runId, 0)).configured, false);
  await assert.rejects(disabled.write('owner', request()), { code: 'not_configured' });
  assert.equal(touched, false);
});
test('API rejects unauthenticated/cross-origin/duplicate query and never accepts browser owner', async () => {
  let session = { user: { id: 'session-owner' } },
    writes = 0;
  const handler = createEditorialHandler({
    session: async () => session,
    origin: () => 'https://hzense.test',
    read: async (owner) => ({ owner }),
    write: async (owner) => {
      assert.equal(owner, 'session-owner');
      writes++;
      return { ok: true };
    },
  });
  const get = (query, headers = { host: 'hzense.test' }) =>
    new Request(`https://hzense.test/api/admin/editorial-signals?${query}`, { headers });
  assert.equal((await handler(get(`runId=${runId}&candidateIndex=0`))).status, 200);
  assert.equal(
    (await handler(get(`runId=${runId}&candidateIndex=0&candidateIndex=0`))).status,
    400,
  );
  assert.equal(
    (await handler(get(`runId=${runId}&candidateIndex=0`, { host: 'evil.test' }))).status,
    403,
  );
  const post = (origin) =>
    new Request('https://hzense.test/api/admin/editorial-signals', {
      method: 'POST',
      headers: { host: 'hzense.test', origin, 'content-type': 'application/json' },
      body: JSON.stringify(request()),
    });
  assert.equal((await handler(post('https://evil.test'))).status, 403);
  assert.equal((await handler(post('https://hzense.test'))).status, 200);
  session = null;
  assert.equal((await handler(post('https://hzense.test'))).status, 401);
  assert.equal(writes, 1);
});
test('API does not leak database errors and preserves ambiguous commit status', async () => {
  for (const [code, expected] of [
    ['commit_unknown', 'commit_unknown'],
    ['password secret host', 'unavailable'],
  ]) {
    const handler = createEditorialHandler({
      session: async () => ({ user: { id: 'owner' } }),
      origin: () => 'https://hzense.test',
      read: async () => {
        throw Object.assign(new Error('sensitive'), { code });
      },
      write: async () => {},
    });
    const response = await handler(
      new Request(
        `https://hzense.test/api/admin/editorial-signals?runId=${runId}&candidateIndex=0`,
        { headers: { host: 'hzense.test' } },
      ),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: expected });
  }
});

test('API returns the actionable person-policy rejection without leaking raw errors', async () => {
  const handler = createEditorialHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => 'https://hzense.test',
    read: async () => null,
    write: async () => {
      throw Object.assign(new Error('private database details'), { code: 'excluded_person' });
    },
  });
  const response = await handler(
    new Request('https://hzense.test/api/admin/editorial-signals', {
      method: 'POST',
      headers: {
        host: 'hzense.test',
        origin: 'https://hzense.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify(request()),
    }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'excluded_person' });
});

test('resource preparation reuses unique identities, preserves saved IDs and binds resource evidence on save', async () => {
  const resources = [
    {
      type: 'company',
      name: '合成组织',
      introduction: '合成组织研究工具。',
      event_role: '发布工具',
      evidence: [{ fragment_id: 'f1', quote: '合成组织研究工具。' }],
    },
    {
      type: 'person',
      name: '测试人物',
      introduction: null,
      event_role: '介绍工具',
      evidence: [{ fragment_id: 'f2', quote: '测试人物介绍工具。' }],
    },
  ];
  const resourceCatalog = [
    { id: 'company-example', type: 'company', name: '合成组织', status: 'active' },
  ];
  const choices = [
    { type: 'company', name: '合成组织', status: 'reuse', matches: resourceCatalog },
    { type: 'person', name: '测试人物', status: 'new', matches: [] },
  ];
  const resourceSourceOptions = resources.map(({ name, type }) => ({
    name,
    type,
    sourceUrls: ['https://example.com/article'],
  }));
  let saved = null;
  const saves = [];
  const resourceContent = {
    ...content,
    resources: resources.map((resource) => ({ ...resource, entity_id: null })),
  };
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({
      materialHash,
      content: resourceContent,
      warnings: [],
      resources,
      resourceCatalog,
      resourceSourceOptions,
      sourceOptions: ['https://example.com/article'],
    }),
    topics: async () => content.topics,
    resources: async (drafts, catalog) => {
      assert.deepEqual(drafts, resources);
      assert.deepEqual(catalog, resourceCatalog);
      return choices;
    },
    read: async () => saved,
    save: async (_owner, request, material) => {
      normalizeEditorialRequest(request, material);
      saves.push({ request, material });
      return {
        request_id: request.requestId,
        revision: 1,
        action: request.action,
        content: request.content,
      };
    },
  });
  const prepared = await service.read('owner', runId, 0);
  assert.equal(prepared.content.resources[0].entity_id, 'company-example');
  assert.equal(prepared.content.resources[1].entity_id, null);
  assert.deepEqual(prepared.resourceOptions, choices);
  assert.deepEqual(editorialMissing(prepared.content, choices, prepared.resourceSourceOptions), [
    '公开来源',
    '合成组织 的公开来源',
    '测试人物 的公开来源',
  ]);
  const selected = { ...prepared.content, sourceUrls: ['https://example.com/article'] };
  await service.write('owner', { ...request(), content: selected });
  assert.deepEqual(saves[0].material.resources, resources);
  assert.deepEqual(saves[0].material.resourceCatalog, resourceCatalog);
  assert.deepEqual(saves[0].material.resourceSourceOptions, resourceSourceOptions);
  assert.deepEqual(saves[0].request.content.resources, selected.resources);
  await assert.rejects(
    service.write('owner', {
      ...request(),
      content: {
        ...selected,
        resources: selected.resources.map((resource) => ({
          ...resource,
          introduction: '伪造的简介',
        })),
      },
    }),
    { code: 'material_changed' },
  );
  saved = {
    request_id: requestId,
    revision: 1,
    action: 'publish',
    content: {
      ...selected,
      resources: selected.resources.map((resource, i) => ({
        ...resource,
        entity_id: i ? 'person-saved' : 'company-saved',
      })),
    },
  };
  assert.deepEqual(
    (await service.read('owner', runId, 0)).content.resources.map((resource) => resource.entity_id),
    ['company-saved', 'person-saved'],
  );
});

test('resource publication readiness is separate from material reading and defaults closed', async () => {
  const resource = {
    type: 'company',
    name: '合成组织',
    introduction: null,
    event_role: null,
    evidence: [{ fragment_id: 'f1', quote: '合成组织' }],
  };
  const choice = {
    type: 'company',
    name: resource.name,
    status: 'reuse',
    matches: [{ id: 'company-existing', type: 'company', name: resource.name }],
  };
  let configured = true;
  let withResources = true;
  let ready = false;
  let checks = 0;
  let reads = 0;
  let previews = 0;
  const deps = {
    enabled: () => configured,
    material: async () => ({
      materialHash,
      warnings: [],
      content: {
        ...content,
        ...(withResources ? { resources: [{ ...resource, entity_id: null }] } : {}),
      },
      ...(withResources ? { resources: [resource] } : {}),
    }),
    topics: async () => content.topics,
    read: async () => {
      reads++;
      return null;
    },
    resources: async () => {
      previews++;
      return [choice];
    },
    resourcePublicationReady: async () => {
      checks++;
      return ready;
    },
    save: async () => {
      throw new Error('read must not write');
    },
  };
  const service = createEditorialReviewService(deps);
  const prepared = await service.read('owner', runId, 0);
  assert.equal(prepared.content.resources[0].entity_id, 'company-existing');
  assert.deepEqual(prepared.resourceOptions, [choice]);
  assert.equal(prepared.resourcePublicationReady, false);
  ready = true;
  assert.equal((await service.read('owner', runId, 0)).resourcePublicationReady, true);
  assert.equal(checks, 2);
  const noReadiness = createEditorialReviewService({
    ...deps,
    resourcePublicationReady: undefined,
  });
  assert.equal((await noReadiness.read('owner', runId, 0)).resourcePublicationReady, false);
  const counts = [checks, reads, previews];
  configured = false;
  assert.equal((await service.read('owner', runId, 0)).resourcePublicationReady, false);
  assert.deepEqual([checks, reads, previews], counts);
  configured = true;
  withResources = false;
  const legacy = await service.read('owner', runId, 0);
  assert.equal(Object.hasOwn(legacy, 'resourcePublicationReady'), false);
  assert.equal(checks, counts[0]);
  assert.equal(previews, counts[2]);
});

test('resource preview and capability failures do not masquerade as an empty catalog', async () => {
  const resources = [
    {
      type: 'company',
      name: '合成组织',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'f1', quote: '合成组织' }],
    },
  ];
  const deps = {
    enabled: () => true,
    material: async () => ({
      materialHash,
      warnings: [],
      resources,
      content: {
        ...content,
        resources: resources.map((resource) => ({ ...resource, entity_id: null })),
      },
    }),
    topics: async () => content.topics,
    read: async () => null,
    resources: async () => [],
    resourcePublicationReady: async () => false,
    save: async () => {
      throw new Error('read must not write');
    },
  };
  const failure = Object.assign(new Error('synthetic read failure'), {
    code: 'database_unavailable',
  });
  for (const dependency of ['resources', 'resourcePublicationReady']) {
    const service = createEditorialReviewService({
      ...deps,
      [dependency]: async () => {
        throw failure;
      },
    });
    await assert.rejects(service.read('owner', runId, 0), (error) => error === failure);
  }
});

test('ambiguous resources need an explicit identity of a compatible kind', () => {
  const resources = [
    {
      type: 'person',
      name: '测试人物',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'f1', quote: '测试人物' }],
      entity_id: null,
    },
  ];
  const options = [
    {
      type: 'person',
      name: '测试人物',
      status: 'ambiguous',
      matches: [
        { id: 'person-a', name: '测试人物', type: 'person' },
        { id: 'person-b', name: '测试人物', type: 'person' },
      ],
    },
  ];
  const value = { ...content, resources, sourceUrls: ['https://example.com/article'] };
  const sources = [{ type: 'person', name: '测试人物', sourceUrls: value.sourceUrls }];
  assert.deepEqual(editorialMissing(value, options, sources), ['测试人物 的资源身份']);
  assert.deepEqual(
    editorialMissing(
      { ...value, resources: [{ ...resources[0], entity_id: 'person-b' }] },
      options,
      sources,
    ),
    [],
  );
  assert.deepEqual(
    editorialMissing(
      { ...value, resources: [{ ...resources[0], entity_id: 'person-absent' }] },
      options,
      sources,
    ),
    ['测试人物 的资源身份'],
  );
  assert.deepEqual(
    editorialMissing(
      {
        ...value,
        resources: [{ ...resources[0], type: 'company', entity_id: 'institution-verified' }],
      },
      [
        {
          ...options[0],
          type: 'company',
          matches: [{ id: 'institution-verified', name: '测试人物', type: 'institution' }],
        },
      ],
      [{ ...sources[0], type: 'company' }],
    ),
    [],
  );
});

test('saved resource drafts refresh after enrichment without losing manual selections or identities', async () => {
  const company = {
    type: 'company',
    name: '合成组织',
    introduction: null,
    event_role: '发布工具',
    evidence: [{ fragment_id: 'f1', quote: '合成组织发布工具。' }],
  };
  const person = {
    type: 'person',
    name: '新增人物',
    introduction: null,
    event_role: '介绍工具',
    evidence: [{ fragment_id: 'f2', quote: '新增人物介绍工具。' }],
  };
  const selectedSource = 'https://example.com/original';
  const extraSource = 'https://example.com/supplement';
  const resources = [company, person];
  const resourceSourceOptions = [
    { name: company.name, type: company.type, sourceUrls: [selectedSource] },
    { name: person.name, type: person.type, sourceUrls: [extraSource] },
  ];
  let warnings = [];
  let saved = {
    request_id: requestId,
    revision: 1,
    action: 'draft',
    content: {
      ...content,
      eventDate: '2026-09-26',
      signalType: 'research',
      persons: [],
      sourceUrls: [selectedSource],
      topics: [{ id: 'manual', title: '人工领域' }],
      resources: [{ ...company, entity_id: 'company-selected' }],
    },
  };
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({
      materialHash,
      content: { ...content, resources: resources.map((r) => ({ ...r, entity_id: null })) },
      warnings,
      resources,
      resourceSourceOptions,
      sourceOptions: [selectedSource, extraSource],
    }),
    topics: async () => saved.content.topics,
    resources: async () => resources.map((r) => ({ ...r, status: 'new', matches: [] })),
    read: async () => saved,
    save: async (_owner, input, material) => {
      normalizeEditorialRequest(input, material);
      assert.deepEqual(material.resourceSourceOptions, resourceSourceOptions);
      return { ...saved, revision: 2, action: input.action, content: input.content };
    },
  });
  const updated = await service.read('owner', runId, 0);
  assert.deepEqual(
    updated.content.resources.map((r) => r.entity_id),
    ['company-selected', null],
  );
  assert.deepEqual(updated.content.persons, ['新增人物']);
  assert.equal(updated.content.eventDate, saved.content.eventDate);
  assert.equal(updated.content.signalType, saved.content.signalType);
  assert.deepEqual(updated.content.topics, saved.content.topics);
  assert.deepEqual(updated.content.sourceUrls, [selectedSource]);
  assert.deepEqual(updated.resourceSourceOptions, resourceSourceOptions);
  assert.match(updated.warnings.join(' '), /补全资料已更新/);
  const published = await service.write('owner', {
    ...request(),
    expectedRevision: 1,
    content: { ...updated.content, sourceUrls: [selectedSource, extraSource] },
  });
  assert.equal(published.action, 'publish');
  assert.equal(published.content.resources.length, 2);
  saved = { ...saved, action: 'publish' };
  assert.match((await service.read('owner', runId, 0)).warnings.join(' '), /再次确认发布/);
  warnings = ['补证材料当前不可用'];
  const unavailable = await service.read('owner', runId, 0);
  assert.deepEqual(unavailable.content.resources, saved.content.resources);
  assert.deepEqual(unavailable.warnings, warnings);
});

test('resource-backed signals without source-supported people do not require invented people', () => {
  assert.deepEqual(editorialMissing({ ...content, persons: [] }), ['人物']);
  const organization = {
    type: 'company',
    name: '合成组织',
    introduction: null,
    event_role: null,
    evidence: [{ fragment_id: 'f1', quote: '合成组织' }],
    entity_id: null,
  };
  assert.deepEqual(
    editorialMissing(
      {
        ...content,
        persons: [],
        resources: [organization],
        sourceUrls: ['https://example.com/article'],
      },
      [],
      [
        {
          name: organization.name,
          type: organization.type,
          sourceUrls: ['https://example.com/article'],
        },
      ],
    ),
    [],
  );
});

test('resource source choices retain only an unchanged committed public identity, never draft claims', async () => {
  const sourceUrl = 'https://example.com/article';
  const resource = {
    type: 'company',
    name: '合成组织',
    introduction: '有原文支持的简介',
    event_role: null,
    evidence: [{ fragment_id: 'f1', quote: '合成组织' }],
  };
  const saved = {
    request_id: requestId,
    revision: 1,
    action: 'publish',
    content: {
      ...content,
      persons: [],
      sourceUrls: [sourceUrl],
      resources: [
        {
          ...resource,
          entity_id: 'company-example',
          source_urls: [sourceUrl],
          evidence: [{ quote: '合成组织', fragment_id: 'f1' }],
        },
      ],
    },
  };
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({
      materialHash,
      content,
      warnings: [],
      resources: [resource],
      sourceOptions: [],
      resourceSourceOptions: [{ name: resource.name, type: resource.type, sourceUrls: [] }],
    }),
    topics: async () => content.topics,
    resources: async () => [],
    read: async () => saved,
    save: async () => {
      throw new Error('read only');
    },
  });
  assert.deepEqual((await service.read('owner', runId, 0)).resourceSourceOptions[0].sourceUrls, [
    sourceUrl,
  ]);
  saved.action = 'withdraw';
  assert.deepEqual((await service.read('owner', runId, 0)).resourceSourceOptions[0].sourceUrls, [
    sourceUrl,
  ]);
  saved.action = 'draft';
  assert.deepEqual((await service.read('owner', runId, 0)).resourceSourceOptions[0].sourceUrls, []);
  saved.action = 'publish';
  resource.introduction = '补全后的另一份简介';
  assert.deepEqual((await service.read('owner', runId, 0)).resourceSourceOptions[0].sourceUrls, []);
});

test('API returns bounded, actionable resource errors', async () => {
  for (const code of [
    'entity_reference_invalid',
    'resource_identity_ambiguous',
    'resource_source_required',
  ]) {
    const handler = createEditorialHandler({
      session: async () => ({ user: { id: 'owner' } }),
      origin: () => 'https://hzense.test',
      read: async () => null,
      write: async () => {
        throw Object.assign(new Error('private error'), { code });
      },
    });
    const response = await handler(
      new Request('https://hzense.test/api/admin/editorial-signals', {
        method: 'POST',
        headers: {
          host: 'hzense.test',
          origin: 'https://hzense.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify(request()),
      }),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: code });
  }
});
