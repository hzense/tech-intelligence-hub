import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { validateConnectionTarget } from '../../../packages/database/src/connection-policy.mjs';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../lib/server/candidate-review.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'isolated-services',
      setup(builder) {
        for (const [filter, path] of [
          [/candidate-review-store\.mjs$/, 'fixture:store'],
          [/candidate-review-role\.mjs$/, 'fixture:role'],
          [/candidate-review-config$/, 'fixture:config'],
          [/^\.\/signal-generation$/, 'fixture:generation'],
          [/^\.\.\/candidate-review$/, 'fixture:packet'],
          [/^\.\/candidate-enrichment$/, 'fixture:enrichment'],
          [/^\.\/material-registration$/, 'fixture:materials'],
        ])
          builder.onResolve({ filter }, () => ({ path, external: true }));
      },
    },
  ],
});
const realRequire = createRequire(import.meta.url);
const runId = '11111111-1111-4111-8111-111111111111';
const materialHash = 'a'.repeat(64);
function fixture(queryOverride) {
  const candidate = {
    title: '语言模型发布',
    summary: '张三宣布语言模型发布。',
    event_date: '2026-09-21',
    event_date_evidence: [{ fragment_id: 'fragment-1', quote: '2026年9月21日' }],
    persons: [
      {
        name: '张三',
        role: '发布者',
        organization: null,
        evidence: [{ fragment_id: 'fragment-1', quote: '张三宣布' }],
      },
    ],
    organizations: [],
    claims: [
      { text: '语言模型发布', evidence: [{ fragment_id: 'fragment-1', quote: '语言模型发布' }] },
    ],
  };
  const state = {
    entities: [{ id: 'person-zhang-san', name: '张三', aliases: [], type: 'person' }],
    evidence: [
      {
        id: 'e1',
        source_url: 'https://example.com/event',
        allowed_hosts: ['example.com'],
        excerpt: '张三宣布语言模型发布。',
      },
    ],
    enrichments: [],
    enrichmentError: false,
    materialPreview: null,
    previewError: false,
    registered: null,
    previewReads: 0,
    saved: [],
    queries: [],
    busy: false,
  };
  class CandidateReviewError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const client = {
    async query(sql, params) {
      assert.equal(state.busy, false, 'queries must not overlap on a shared pg client');
      state.busy = true;
      await Promise.resolve();
      state.busy = false;
      state.queries.push(sql);
      if (queryOverride) return queryOverride(sql, params);
      if (sql.includes('FROM public.entities')) return { rows: state.entities };
      if (sql.includes('FROM public.person_profiles'))
        return { rows: state.entities.map((row) => ({ entity_id: row.id, kind: 'person' })) };
      if (sql.includes('FROM public.topics'))
        return { rows: [{ id: 'topic-language-models', name: '语言模型' }] };
      if (sql.includes('FROM public.public_source_evidence')) return { rows: state.evidence };
      return { rows: [] };
    },
    release() {},
  };
  const deps = {
    'server-only': {},
    pg: {
      Pool: class {
        on() {}
        async connect() {
          return client;
        }
      },
    },
    'fixture:store': {
      CandidateReviewError,
      readCandidateReviews: async () => [],
      saveCandidateReview: async (args) => {
        state.saved.push(args);
        return { revision: 1, draft: args.request.draft };
      },
    },
    'fixture:role': { assertCandidateReviewRole: async () => {} },
    'fixture:config': {
      readReviewDatabaseConfiguration: () => 'synthetic',
      ReviewConfigurationError: CandidateReviewError,
    },
    'fixture:generation': {
      generationRecord: async (owner) => {
        if (owner !== 'owner') throw new CandidateReviewError('not_found');
        return {};
      },
    },
    'fixture:packet': {
      buildCandidateReview: () => ({ candidate, materialHash }),
      buildEnrichedCandidateReview: () => ({
        candidate: { ...candidate, event_date: '2026-09-22' },
        materialHash,
      }),
    },
    'fixture:enrichment': {
      listCandidateEnrichmentDtos: async () => {
        if (state.enrichmentError) throw new CandidateReviewError('unavailable');
        return state.enrichments;
      },
    },
    'fixture:materials': {
      registeredMaterialForCandidate: async () => state.registered,
      materialPublicationPreview: async () => {
        state.previewReads++;
        if (state.previewError) throw new Error('private preview detail');
        return state.materialPreview;
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', compiled.outputFiles[0].text)(
    (name) => (Object.hasOwn(deps, name) ? deps[name] : realRequire(name)),
    module,
    module.exports,
    { env: { HZENSE_REVIEW_ENABLED: '1' } },
  );
  const read = () => module.exports.reviewDashboard('owner', runId, 0);
  const confirm = (preparationHash, extra = {}) =>
    module.exports.confirmPreparedReview('owner', {
      runId,
      candidateIndex: 0,
      materialHash,
      preparationHash,
      expectedReviewRevision: 0,
      requestKey: '22222222-2222-4222-8222-222222222222',
      ...extra,
    });
  return { state, read, confirm, services: module.exports };
}

test('server reads complete private materials and confirms only the matching displayed preparation', async () => {
  const f = fixture();
  const dashboard = await f.read();
  assert.equal(dashboard.preparation.ready, true);
  assert.equal(
    dashboard.preparation.materials.items.find((i) => i.key === 'claim:0').matches[0].id,
    'e1',
  );
  await f.confirm(dashboard.preparation.preparationHash);
  assert.equal(f.state.saved.length, 1);
  assert.deepEqual(f.state.saved[0].request.draft.personIds, ['person-zhang-san']);
  assert.equal(f.state.saved[0].owner, 'owner');
  assert.equal(
    f.state.saved[0].request.note,
    `publication-materials-v1:${dashboard.preparation.preparationHash}`,
  );
  assert.ok(f.state.queries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.equal(
    f.state.queries.some((sql) => /INSERT|UPDATE|DELETE/.test(sql)),
    false,
  );
});

test('catalog or enrichment drift rejects confirmation without writing a review', async () => {
  for (const change of [
    (s) => {
      s.entities[0].id = 'person-different';
    },
    (s) => {
      s.evidence[0].source_url = 'https://example.com/new';
    },
    (s) => {
      s.enrichments = [
        { status: 'completed', material_hash: materialHash, result: { candidate: {} } },
      ];
    },
  ]) {
    const f = fixture();
    const dashboard = await f.read();
    change(f.state);
    await assert.rejects(f.confirm(dashboard.preparation.preparationHash), {
      code: 'material_changed',
    });
    assert.equal(f.state.saved.length, 0);
  }
});

test('supplement preview never changes review readiness, confirmation hashes or saved drafts', async () => {
  const f = fixture();
  const original = await f.read();
  f.state.materialPreview = {
    requestId: 'request',
    taskId: 'task',
    materials: { title: 'preview', items: [] },
  };
  const previewed = await f.read();
  assert.deepEqual(previewed.materialPreview, f.state.materialPreview);
  assert.deepEqual(previewed.preparation, original.preparation);
  const reads = f.state.previewReads;
  await f.confirm(original.preparation.preparationHash);
  assert.equal(f.state.previewReads, reads, 'write path must never consume display-only previews');
  assert.deepEqual(f.state.saved[0].request.draft.personIds, ['person-zhang-san']);
  f.state.entities = [];
  assert.equal((await f.read()).preparation.ready, false);
});

test('invalid or unavailable supplement previews cannot block valid formal materials or weaken their gate', async () => {
  const f = fixture();
  const original = await f.read();
  f.state.previewError = true;
  const unavailable = await f.read();
  assert.equal(unavailable.materialPreview, null);
  assert.equal(unavailable.materialPreviewUnavailable, true);
  assert.deepEqual(unavailable.preparation, original.preparation);
  assert.doesNotMatch(JSON.stringify(unavailable), /private preview detail/);
  await f.confirm(original.preparation.preparationHash);
  assert.equal(f.state.saved.length, 1);
  f.state.entities = [];
  assert.equal((await f.read()).preparation.ready, false);
  f.state.previewError = false;
  assert.equal((await f.read()).materialPreviewUnavailable, false);
});

test('missing fingerprints, browser-authored drafts and cross-owner access are rejected', async () => {
  const f = fixture();
  for (const hash of [undefined, '', 'invalid'])
    await assert.rejects(f.confirm(hash), { code: 'invalid_request' });
  const dashboard = await f.read();
  await assert.rejects(
    f.confirm(dashboard.preparation.preparationHash, { draft: { verified: true } }),
    { code: 'invalid_request' },
  );
  await assert.rejects(f.services.reviewDashboard('other-owner', runId, 0), { code: 'not_found' });
  assert.equal(f.state.saved.length, 0);
});

test('failed enrichment reads and truncated catalogs cannot be treated as empty or uniquely matched', async () => {
  const f = fixture();
  const dashboard = await f.read();
  f.state.enrichmentError = true;
  await assert.rejects(f.read(), { code: 'unavailable' });
  await assert.rejects(f.confirm(dashboard.preparation.preparationHash), { code: 'unavailable' });
  f.state.enrichmentError = false;
  f.state.enrichments = [{ status: 'completed', material_hash: materialHash, result: null }];
  await assert.rejects(f.read(), { code: 'material_changed' });
  f.state.enrichments = [];
  f.state.evidence = Array.from({ length: 500 }, (_, i) => ({
    ...f.state.evidence[0],
    id: `e${i}`,
  }));
  await assert.rejects(f.read(), { code: 'review_incomplete' });
  assert.equal(f.state.saved.length, 0);
});

test(
  'actual PostgreSQL preparation queries normalize names and read the source host contract',
  {
    skip: !process.env.HZENSE_CANDIDATE_REVIEW_SQL_TEST_URL,
  },
  async () => {
    const connectionString = process.env.HZENSE_CANDIDATE_REVIEW_SQL_TEST_URL;
    validateConnectionTarget({ connectionString, profile: 'local-test' });
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    const admin = new pg.Client({ connectionString });
    const database = `hzense_materials_${process.pid}_${Date.now()}`;
    const databaseUrl = new URL(connectionString);
    databaseUrl.pathname = `/${database}`;
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    let created = false;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
      created = true;
      await client.connect();
      // Synthetic relations exist only in this test's newly created database.
      await client.query(`
      CREATE TABLE public.entities(id text,name text,aliases text[],type text,status text);
      CREATE TABLE public.person_profiles(entity_id text);
      CREATE TABLE public.organization_profiles(entity_id text);
      CREATE TABLE public.topics(id text,title text,runtime_enabled boolean,status text);
      CREATE TABLE public.sources(id text,active boolean,allowed_hosts text[]);
      CREATE TABLE public.public_source_evidence(id text,source_id text,source_url text,excerpt text,verification_status text);
      INSERT INTO public.entities VALUES('p1','张三','{}','person','active');
      INSERT INTO public.person_profiles VALUES('p1');
      INSERT INTO public.topics VALUES('topic-language-models','语言模型',true,'active');
      INSERT INTO public.sources VALUES('s1',true,ARRAY['example.com']);
      INSERT INTO public.public_source_evidence VALUES('e1','s1','https://example.com/event','语言模型发布','verified');
    `);
      const f = fixture((sql, params) => client.query(sql, params));
      const dashboard = await f.read();
      assert.equal(dashboard.preparation.ready, true);
      await f.confirm(dashboard.preparation.preparationHash);
      assert.equal(f.state.saved[0].request.draft.personIds[0], 'p1');
      await client.query("UPDATE public.sources SET allowed_hosts=ARRAY['other.example']");
      assert.equal((await f.read()).preparation.ready, false);
      assert.equal(
        (await client.query("SELECT normalize('ＡＢＣ',NFKC) AS value")).rows[0].value,
        'ABC',
      );
    } finally {
      await client.end();
      if (created) await admin.query(`DROP DATABASE "${database}"`);
      await admin.end();
    }
  },
);
