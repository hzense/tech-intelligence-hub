import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  automaticPublicationAvailable,
  automaticPublicationEnabled,
  automaticPublicationPolicy,
  automaticPublicationPreview,
  automaticPublicationRequestId,
  createAutomaticPublisher,
} from '../lib/automatic-publication.ts';
import { localDatabaseEnvironmentRoles } from '../lib/local-development.ts';
import { createAutomaticPublicationHandler } from '../lib/admin-automatic-publication-handler.ts';
const { Request, structuredClone } = globalThis;
const id = '11111111-1111-4111-8111-111111111111';
const source = 'https://example.com/news';
const policy = { mode: 'automatic', policy: 'auto-publication-v1', sourceUrls: [source] };
const collection = {
  runId: id,
  windowStart: '2026-10-24T00:00:37.200Z',
  windowEnd: '2026-10-26T00:00:37.200Z',
  sourceUrl: source,
  discoveredPublishedAt: '2026-10-24',
};
const dashboard = () => ({
  configured: true,
  materialHash: 'a'.repeat(64),
  revision: 0,
  action: null,
  requestId: null,
  publicId: null,
  warnings: [],
  content: {
    title: '机构发布产品',
    summary: '机构发布新产品及相关资料。',
    eventDate: '2026-10-21',
    dateBasis: 'source_published',
    signalType: 'product',
    organizations: ['机构'],
    persons: [],
    topics: [{ id: 'ai', title: '人工智能' }],
    sourceUrls: [],
    resources: [
      {
        name: '机构',
        type: 'institution',
        introduction: null,
        event_role: '发布者',
        evidence: [{ fragment_id: 'fragment-1', quote: '机构发布新产品' }],
        entity_id: null,
      },
    ],
  },
  topicOptions: [{ id: 'ai', title: '人工智能' }],
  sourceOptions: [source, 'https://example.com/supplement'],
  resourcePublicationReady: true,
  missingResourceDetails: [],
  resourceOptions: [{ name: '机构', type: 'institution', status: 'new', matches: [] }],
  resourceSourceOptions: [{ name: '机构', type: 'institution', sourceUrls: [source] }],
});
function setup() {
  const state = {
    enabled: true,
    run: {
      status: 'completed',
      snapshot: { publication: policy },
      result: {
        classification: 'private',
        candidates: [{ index: 0, classification: 'private', status: 'needs_review' }],
      },
    },
    dashboard: dashboard(),
    calls: [],
    error: null,
  };
  const publish = createAutomaticPublisher({
    enabled: () => state.enabled,
    run: async (owner, runId) => {
      state.calls.push(['read', owner, runId]);
      return state.run;
    },
    read: async () => structuredClone(state.dashboard),
    publish: async (owner, request) => {
      state.calls.push(['publish', owner, request]);
      if (state.error) throw state.error;
      state.dashboard = {
        ...state.dashboard,
        action: 'publish',
        revision: 1,
        content: request.content,
      };
    },
  });
  return { state, publish };
}
test('automatic publication is a default-closed explicit opt-in, never local mock', () => {
  const enabled = {
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
  };
  assert.equal(automaticPublicationEnabled({}), false);
  assert.equal(automaticPublicationEnabled(enabled), true);
  assert.equal(
    automaticPublicationEnabled({ ...enabled, HZENSE_UNIFIED_SIGNAL_ENABLED: '0' }),
    false,
  );
  assert.equal(
    automaticPublicationEnabled({
      ...enabled,
      HZENSE_LOCAL_DEVELOPMENT: '1',
      HZENSE_LOCAL_AI_MODE: 'mock',
    }),
    false,
  );
});
test('saved automatic collection is available in isolated local real AI without changing manual UI opt-in', () => {
  const local = {
    NODE_ENV: 'development',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_AI_MODE: 'real',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
    ...Object.fromEntries(
      Object.entries(localDatabaseEnvironmentRoles).map(([key, role]) => [
        key,
        `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
      ]),
    ),
  };
  assert.equal(automaticPublicationAvailable(local), true);
  assert.equal(automaticPublicationEnabled(local), false);
  assert.equal(
    automaticPublicationEnabled({ ...local, HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1' }),
    true,
  );
  for (const patch of [
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { CI: 'true' },
    { HZENSE_UNIFIED_SIGNAL_ENABLED: '0' },
    { HZENSE_EDITORIAL_PUBLICATION_ENABLED: '0' },
    {
      HZENSE_RUNTIME_DATABASE_URL: local.HZENSE_RUNTIME_DATABASE_URL.replace(
        '127.0.0.1',
        'db.example.com',
      ),
    },
    { DATABASE_URL: 'postgresql://owner:private@db.example.com/db' },
    { NEXTAUTH_URL: 'https://hzense.com' },
  ]) {
    assert.equal(automaticPublicationAvailable({ ...local, ...patch }), false);
    assert.equal(
      automaticPublicationEnabled({
        ...local,
        ...patch,
        HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1',
      }),
      false,
    );
  }
  const production = {
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
  };
  assert.equal(automaticPublicationAvailable(production), false);
  assert.equal(
    automaticPublicationAvailable({ ...production, HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1' }),
    true,
  );
});
test('policy only accepts exact known schema and safe pinned article URLs', () => {
  assert.deepEqual(automaticPublicationPolicy(policy), policy);
  assert.deepEqual(automaticPublicationPolicy({ ...policy, sourceUrls: [] }).sourceUrls, []);
  for (const value of [
    undefined,
    null,
    { ...policy, extra: true },
    { ...policy, mode: 'manual' },
    { ...policy, policy: 'future' },
    { ...policy, sourceUrls: [null] },
    { ...policy, sourceUrls: [source, source] },
    { ...policy, sourceUrls: ['https://example.com/private/doc'] },
    { ...policy, sourceUrls: ['https://example.com/news?token=secret'] },
    { ...policy, sourceUrls: ['https://drive.google.com/file/d/private'] },
  ])
    assert.equal(automaticPublicationPolicy(value), null);
});
test('only pinned original links are selected; new resources can be registered without fabricated people', () => {
  const original = dashboard();
  const preview = automaticPublicationPreview(original, policy, true);
  assert.equal(preview.state.status, 'pending');
  assert.deepEqual(preview.content.sourceUrls, [source]);
  assert.equal(preview.content.resources[0].entity_id, '__new__');
  assert.deepEqual(preview.content.persons, []);
  assert.deepEqual(original.content.sourceUrls, []);
});
test('collection dates are rechecked after extraction, while source dates and private results remain intact', async () => {
  for (const date of ['2026-10-16', '2025-10-20', '2026-10-22', '2026-10-27', null]) {
    const { state, publish } = setup();
    state.run.snapshot.publication = { ...policy, collection };
    state.dashboard.content.eventDate = date;
    const before = structuredClone(state.run.result);
    const result = await publish('owner', id);
    assert.equal(result.candidates[0].status, 'needs_attention');
    assert.match(
      result.candidates[0].reasons.join(' '),
      /不在本次采集范围.*2026-10-24.*2026-10-26/,
    );
    assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 0);
    assert.equal(state.dashboard.content.eventDate, date);
    assert.deepEqual(state.run.result, before);
    assert.equal(state.run.status, 'completed', 'generation remains successful and billable');
    await publish('owner', id);
    assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 0);
  }
});
test('collection window uses inclusive UTC source dates, not execution date or discovery date equality', async () => {
  for (const date of ['2026-10-24', '2026-10-25', '2026-10-26']) {
    const { state, publish } = setup();
    state.run.snapshot.publication = { ...policy, collection };
    state.dashboard.content.eventDate = date;
    assert.equal((await publish('owner', id)).candidates[0].status, 'published');
    assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 1);
  }
});
test('malformed or detached collection policy is never treated as an unrestricted policy', () => {
  const bound = { ...policy, collection };
  assert.deepEqual(automaticPublicationPolicy(bound), bound);
  for (const value of [
    null,
    { ...collection, sourceUrl: 'https://example.com/other' },
    { ...collection, windowEnd: '2026-10-23T00:00:37.200Z' },
    { ...collection, discoveredPublishedAt: '2026-10-16' },
  ])
    assert.equal(automaticPublicationPolicy({ ...policy, collection: value }), null);
});
test('publication reread preserves already published historical records and explains storage date refusals', async () => {
  const { state, publish } = setup();
  state.run.snapshot.publication = { ...policy, collection };
  state.dashboard.action = 'publish';
  state.dashboard.revision = 1;
  assert.equal((await publish('owner', id)).candidates[0].status, 'published');
  assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 0);
  state.dashboard.action = null;
  state.dashboard.revision = 0;
  state.dashboard.content.eventDate = '2026-10-24';
  state.error = Object.assign(new Error('private diagnostic'), {
    code: 'automatic_publication_date_out_of_window',
  });
  const result = await publish('owner', id);
  assert.equal(result.candidates[0].status, 'needs_attention');
  assert.match(result.candidates[0].reasons[0], /原文发布日期不在本次采集范围/);
});
test('missing dates, private uploads, unavailable sources and ambiguous identity remain exceptions', () => {
  const variants = [
    {
      modify: (d) => {
        d.content.eventDate = null;
      },
      reason: /原文发布日期/,
    },
    {
      modify: (d) => {
        d.sourceOptions = [];
      },
      reason: /原始网页来源/,
    },
    {
      modify: (d) => {
        d.resourcePublicationReady = false;
      },
      reason: /权限/,
    },
    {
      modify: (d) => {
        d.content.topics = [];
      },
      reason: /领域/,
    },
    {
      modify: (d) => {
        d.topicOptions = [];
      },
      reason: /领域标签已变更/,
    },
    {
      modify: (d) => {
        d.resourceOptions[0] = {
          ...d.resourceOptions[0],
          status: 'ambiguous',
          matches: [
            { id: 'a', name: '机构', type: 'institution' },
            { id: 'b', name: '机构', type: 'institution' },
          ],
        };
      },
      reason: /资源身份/,
    },
  ];
  for (const { modify, reason } of variants) {
    const d = dashboard();
    modify(d);
    const preview = automaticPublicationPreview(d, policy, true);
    assert.equal(preview.state.status, 'needs_attention');
    assert.match(preview.state.reasons.join(' '), reason);
  }
  assert.equal(
    automaticPublicationPreview(dashboard(), { ...policy, sourceUrls: [] }, true).state.status,
    'needs_attention',
  );
});
test('historical, unfinished, disabled and malformed result tasks never write', async () => {
  for (const change of [
    (s) => {
      s.enabled = false;
    },
    (s) => {
      s.run.snapshot = {};
    },
    (s) => {
      s.run.status = 'running';
    },
    (s) => {
      s.run.result.candidates.push({ ...s.run.result.candidates[0] });
    },
    (s) => {
      s.run.result.classification = 'public';
    },
  ]) {
    const { state, publish } = setup();
    change(state);
    await publish('owner', id);
    assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 0);
  }
});
test('publishes first revision once using automatic consent semantics and stable ID', async () => {
  const { state, publish } = setup();
  assert.equal((await publish('owner', id)).candidates[0].status, 'published');
  assert.equal((await publish('owner', id)).candidates[0].status, 'published');
  const calls = state.calls.filter(([kind]) => kind === 'publish');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].consent, false);
  assert.equal(calls[0][2].expectedRevision, 0);
  assert.equal(calls[0][2].requestId, automaticPublicationRequestId(id, 0));
  assert.notEqual(automaticPublicationRequestId(id, 0), automaticPublicationRequestId(id, 1));
});
test('manual drafts, edits and withdrawals are never overwritten or resurrected', async () => {
  for (const action of ['draft', 'publish', 'withdraw']) {
    const { state, publish } = setup();
    state.dashboard.action = action;
    state.dashboard.revision = 3;
    await publish('owner', id);
    assert.equal(state.calls.filter(([kind]) => kind === 'publish').length, 0);
  }
});
test('permanent validation errors are isolated; uncertain commits fail only publication not generation', async () => {
  const { state, publish } = setup();
  state.error = Object.assign(new Error('raw private value'), {
    code: 'resource_identity_ambiguous',
  });
  assert.equal((await publish('owner', id)).candidates[0].status, 'needs_attention');
  state.error = Object.assign(new Error('raw private value'), { code: 'commit_unknown' });
  await assert.rejects(publish('owner', id), /^Error: automatic_publication_unavailable$/);
  assert.equal(state.run.status, 'completed');
});
test('retry endpoint requires same-origin authenticated POST and only run identity', async () => {
  const calls = [];
  let authenticated = true;
  const handler = createAutomaticPublicationHandler({
    session: async () => (authenticated ? { user: { id: 'owner' } } : null),
    origin: () => 'https://hzense.test',
    publish: async (...args) => {
      calls.push(args);
      return { state: 'processed', candidates: [] };
    },
  });
  const request = (body, headers = {}, method = 'POST') =>
    new Request('https://hzense.test/api/admin/signals/auto-publish', {
      method,
      headers: {
        host: 'hzense.test',
        origin: 'https://hzense.test',
        'content-type': 'application/json',
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await handler(request({ runId: id }))).status, 200);
  assert.deepEqual(calls, [['owner', id]]);
  assert.equal((await handler(request({ runId: id, automatic: true }))).status, 400);
  assert.equal((await handler(request({}, {}, 'GET'))).status, 405);
  assert.equal(
    (await handler(request({ runId: id }, { origin: 'https://other.test' }))).status,
    403,
  );
  authenticated = false;
  assert.equal((await handler(request({ runId: id }))).status, 401);
  assert.equal(calls.length, 1);
});
test('both local and production workflows run separate retriable publication after paid generation', async () => {
  const local = await readFile(
    new URL('../workflows/local-signal-generation.ts', import.meta.url),
    'utf8',
  );
  const production = await readFile(
    new URL('../workflows/signal-generation.ts', import.meta.url),
    'utf8',
  );
  const step = await readFile(
    new URL('../workflows/automatic-publication.ts', import.meta.url),
    'utf8',
  );
  assert.match(local, /result\.status === 'completed'.*runAutomaticPublicationStep/);
  assert.match(production, /await runAutomaticPublicationStep\(owner, id\)/);
  assert.match(step, /runAutomaticPublicationStep\.maxRetries = 3/);
  assert.doesNotMatch(step, /executeGeneration|invokeSignalGeneration|apiKey/);
});
