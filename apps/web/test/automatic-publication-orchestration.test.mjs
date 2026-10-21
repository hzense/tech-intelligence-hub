import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';
import {
  automaticPublicationPreview,
  createAutomaticPublisher,
} from '../lib/automatic-publication.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const source = 'https://example.com/public-announcement';
const policy = { mode: 'automatic', policy: 'auto-publication-v1', sourceUrls: [source] };
function readyDashboard() {
  return {
    configured: true,
    materialHash: 'a'.repeat(64),
    revision: 0,
    action: null,
    requestId: null,
    publicId: null,
    warnings: [],
    content: {
      title: 'Private candidate title before publication',
      summary: 'An institution announces a product.',
      eventDate: '2026-10-20',
      dateBasis: 'source_published',
      signalType: 'product',
      organizations: ['Example Institution'],
      persons: [],
      topics: [{ id: 'topic-ai', title: 'AI' }],
      sourceUrls: [],
      resources: [
        {
          name: 'Example Institution',
          type: 'institution',
          introduction: null,
          event_role: 'publisher',
          evidence: [{ fragment_id: 'fragment-1', quote: 'An institution announces a product.' }],
          entity_id: null,
        },
      ],
    },
    topicOptions: [{ id: 'topic-ai', title: 'AI' }],
    sourceOptions: [source],
    resourcePublicationReady: true,
    missingResourceDetails: [],
    resourceOptions: [
      { name: 'Example Institution', type: 'institution', status: 'new', matches: [] },
    ],
    resourceSourceOptions: [
      { name: 'Example Institution', type: 'institution', sourceUrls: [source] },
    ],
  };
}
function scenario({ commitBeforeError = false } = {}) {
  const state = {
    enabled: true,
    generationCalls: 0,
    dispatches: 0,
    paidCalls: 0,
    publicationCalls: [],
    stopCalls: 0,
    errorsRemaining: 1,
    logs: [],
    dashboard: readyDashboard(),
    run: {
      status: 'pending',
      snapshot: { publication: policy },
      result: {
        classification: 'private',
        candidates: [{ index: 0, classification: 'private', status: 'needs_review' }],
      },
    },
  };
  state.publisher = createAutomaticPublisher({
    enabled: () => state.enabled,
    run: async () => state.run,
    read: async () => globalThis.structuredClone(state.dashboard),
    publish: async (_owner, request) => {
      state.publicationCalls.push(request);
      const commit = () => {
        state.dashboard = {
          ...state.dashboard,
          revision: 1,
          action: 'publish',
          content: request.content,
        };
      };
      if (state.errorsRemaining-- > 0) {
        if (commitBeforeError) commit();
        throw Object.assign(new Error('SENSITIVE_DATABASE_DETAIL'), {
          code: commitBeforeError ? 'commit_unknown' : 'database_unavailable',
        });
      }
      commit();
      return { action: 'publish', revision: 1 };
    },
  });
  return state;
}

async function workflowHarness(state) {
  globalThis.__automaticOrchestration = state;
  const fixtureModules = {
    workflow: 'export async function sleep() {}',
    '../lib/local-development': 'export function isLocalDevelopment() { return true; }',
    '../lib/server/signal-generation': `
      export async function executeGeneration() {
        const s = globalThis.__automaticOrchestration;
        s.generationCalls++; s.paidCalls++; s.run.status = 'completed';
        return { status: 'completed' };
      }
      export async function failQueuedGeneration() {
        const s = globalThis.__automaticOrchestration;
        if (s.run.status === 'pending') s.run.status = 'failed';
      }
    `,
    '../lib/server/generation-sandbox': `
      export async function startGenerationSandbox() {
        const s = globalThis.__automaticOrchestration;
        s.dispatches++; s.paidCalls++;
        return { sandboxName: 'synthetic', commandId: 'synthetic' };
      }
      export async function pollGenerationSandbox() {
        globalThis.__automaticOrchestration.run.status = 'completed'; return 'finished';
      }
      export async function stopGenerationSandbox() { globalThis.__automaticOrchestration.stopCalls++; }
    `,
    '../lib/server/editorial-review': `
      export async function publishGeneratedSignals(...args) {
        return globalThis.__automaticOrchestration.publisher(...args);
      }
    `,
  };
  const bundled = await build({
    stdin: {
      contents: `
        export { signalGenerationWorkflow } from './workflows/signal-generation';
        export { localSignalGenerationWorkflow } from './workflows/local-signal-generation';
        export { runAutomaticPublicationStep } from './workflows/automatic-publication';
      `,
      loader: 'ts',
      resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    // Substitute only the logging sink and local environment. The production
    // orchestration and publication step remain the real source modules.
    define: {
      console: 'globalThis.__automaticOrchestration.logger',
      'process.env.WORKFLOW_TARGET_WORLD': '"local"',
    },
    plugins: [
      {
        name: 'automatic-publication-isolated-services',
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            fixtureModules[args.path] === undefined
              ? undefined
              : { path: args.path, namespace: 'fixture' },
          );
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: fixtureModules[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  state.logger = { info: (line) => state.logs.push(JSON.parse(line)) };
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
}

test('production completion plus unknown publication commit retries only the publication receipt', async () => {
  const state = scenario({ commitBeforeError: true });
  try {
    const api = await workflowHarness(state);
    await assert.rejects(
      api.signalGenerationWorkflow('PRIVATE_OWNER', runId),
      /automatic_publication_unavailable/,
    );
    assert.equal(state.run.status, 'completed');
    assert.equal(state.paidCalls, 1);
    assert.equal(state.dispatches, 1);
    assert.equal(state.stopCalls, 1);
    assert.equal(state.dashboard.action, 'publish');
    const result = await api.runAutomaticPublicationStep('PRIVATE_OWNER', runId);
    assert.equal(result.state, 'processed');
    assert.equal(
      state.publicationCalls.length,
      1,
      'confirmed committed revision is not written twice',
    );
    assert.equal(state.paidCalls, 1, 'publication recovery invokes neither sandbox nor AI');
    assert.equal(api.runAutomaticPublicationStep.maxRetries, 3);
    assert.equal(state.logs.at(-1).published, 1);
    const logs = JSON.stringify(state.logs);
    for (const secret of [
      'PRIVATE_OWNER',
      'SENSITIVE_DATABASE_DETAIL',
      source,
      state.dashboard.content.title,
    ])
      assert.equal(logs.includes(secret), false);
  } finally {
    delete globalThis.__automaticOrchestration;
  }
});

test('local publication retry after rollback keeps the same request ID and does not repeat generation', async () => {
  const state = scenario();
  try {
    const api = await workflowHarness(state);
    await assert.rejects(
      api.localSignalGenerationWorkflow('PRIVATE_OWNER', runId, 'dispatch'),
      /automatic_publication_unavailable/,
    );
    assert.equal(state.run.status, 'completed');
    assert.equal(state.dashboard.revision, 0);
    await api.runAutomaticPublicationStep('PRIVATE_OWNER', runId);
    assert.equal(state.generationCalls, 1);
    assert.equal(state.paidCalls, 1);
    assert.equal(state.publicationCalls.length, 2);
    assert.equal(state.publicationCalls[0].requestId, state.publicationCalls[1].requestId);
    assert.equal(state.publicationCalls[1].expectedRevision, 0);
    assert.equal(state.publicationCalls[1].consent, false);
    assert.equal(state.dashboard.action, 'publish');
  } finally {
    delete globalThis.__automaticOrchestration;
  }
});

test('manual draft, edit or withdrawal winning after preview cannot be overwritten by an automatic retry', async () => {
  for (const action of ['draft', 'publish', 'withdraw']) {
    const state = scenario();
    state.run.status = 'completed';
    let writes = 0;
    const publish = createAutomaticPublisher({
      enabled: () => true,
      run: async () => state.run,
      read: async () => globalThis.structuredClone(state.dashboard),
      publish: async (_owner, request) => {
        writes++;
        assert.equal(request.expectedRevision, 0);
        state.dashboard = {
          ...state.dashboard,
          action,
          revision: 3,
          content: { ...state.dashboard.content, title: 'Human correction' },
        };
        throw Object.assign(new Error('race'), { code: 'revision_conflict' });
      },
    });
    const first = await publish('PRIVATE_OWNER', runId);
    assert.equal(first.candidates[0].status, 'needs_attention');
    const again = await publish('PRIVATE_OWNER', runId);
    assert.equal(again.candidates[0].status, action === 'publish' ? 'published' : 'skipped');
    assert.equal(writes, 1);
    assert.equal(state.dashboard.content.title, 'Human correction');
    assert.equal(state.dashboard.action, action);
  }
});

test('automatic publication never promotes a fallback whose supplementary material could not be read', () => {
  const dashboard = readyDashboard();
  dashboard.warnings.push('历史 AI 补全暂不可读取，当前按原候选展示；可直接手动补充并确认。');
  const preview = automaticPublicationPreview(dashboard, policy, true);
  assert.equal(preview.state.status, 'needs_attention');
  assert.ok(preview.state.reasons.length > 0);
});

test('a disappeared pinned source is not substituted by newly available supplementary URLs', () => {
  const dashboard = readyDashboard();
  const supplemental = 'https://example.com/different-source';
  dashboard.sourceOptions = [supplemental];
  dashboard.resourceSourceOptions[0].sourceUrls = [supplemental];
  const preview = automaticPublicationPreview(dashboard, policy, true);
  assert.equal(preview.state.status, 'needs_attention');
  assert.deepEqual(preview.content.sourceUrls, []);
});
