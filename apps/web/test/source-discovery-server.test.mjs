import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const diagnostics = {
  version: 1,
  responseId: 'gen-synthetic-receipt',
  searchRequests: 0,
  searchCountStatus: 'zero',
  finishReason: 'stop',
  choiceCount: 1,
  annotationCount: 0,
  providerError: false,
  providerErrorCode: null,
};

test('discovery server persists safe receipts without replaying a paid search', async (t) => {
  const source = await readFile(
    new URL('../lib/server/source-discovery.ts', import.meta.url),
    'utf8',
  );
  const mocks = {
    'server-only': '',
    '@hzense/content': 'export async function loadTaxonomy(){return {topics:[]}}',
    './admin-ai': 'export async function aiStageAccess(){return {}}',
    '../seed-runtime':
      "export async function getSignalEntries(){return [{public_sources:[{url:'https://example.com/published'}]}]}",
    '../source-discovery-core': 'export function discoveryTopics(){return []}',
    '../admin-ai-core':
      "export function readAiBackendConfiguration(){return {allowedHosts:['openrouter.ai']}}",
    './automation-store-access': 'export const automationPool={};',
    '../../../../packages/database/src/automation-contract.mjs':
      'export function normalizeAutomationConfig(value){return value}',
    '../../../../packages/database/src/automation-store.mjs': `
      export async function readAutomationRun(){return structuredClone(globalThis.__discoveryServer.run)}
      export async function readCollectedSourceUrls(){return ['https://example.com/collected']}
      export async function beginSourceDiscovery(){
        const f=globalThis.__discoveryServer;f.fenceAttempts++;
        if(f.fenceError)throw Error(f.fenceError);
        if(f.run.phase!=='preparing')throw Error('stale_attempt');
        f.run.phase='discovering';
      }
      export async function updateAutomationRun(args){
        const f=globalThis.__discoveryServer;f.updates.push(structuredClone(args));
        if(f.updateErrors.length)throw Error(f.updateErrors.shift());
        f.run.result=args.result;f.run.phase=args.phase;f.run.status=args.status??f.run.status;
        if(args.costMicrousd!==undefined)f.run.charged_microusd=args.costMicrousd;
        if(args.costSource!==undefined)f.run.cost_source=args.costSource;
        return structuredClone(f.run);
      }
    `,
    '../source-discovery-provider': `
      export class DiscoveryFailure extends Error {
        constructor(code,called=false,costMicrousd=null,diagnostics){
          super(code);this.code=code;this.called=called;this.costMicrousd=costMicrousd;this.diagnostics=diagnostics;
        }
      }
      export function discoveryEstimate(){return globalThis.__discoveryServer.estimate}
      export async function invokeSourceDiscovery(input){
        const f=globalThis.__discoveryServer;f.invocations++;f.knownUrls=input.knownUrls;
        if(f.preCallError)throw new DiscoveryFailure(f.preCallError);
        try{await input.beforeCall()}catch(error){throw new DiscoveryFailure(error.message)}
        f.paidCalls++;
        if(f.failure)throw new DiscoveryFailure(f.failure.code,true,f.failure.costMicrousd,f.failure.diagnostics);
        return structuredClone(f.receipt);
      }
    `,
  };
  const fixture = await build({
    stdin: { contents: source, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'synthetic-discovery-server',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: mocks[args.path],
          }));
        },
      },
    ],
  });
  const { discoverSources } = await import(
    `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString('base64')}`
  );
  const setup = () =>
    (globalThis.__discoveryServer = {
      invocations: 0,
      paidCalls: 0,
      fenceAttempts: 0,
      estimate: 250000,
      updates: [],
      updateErrors: [],
      receipt: {
        result: {
          articles: [
            { url: 'https://example.com/new', title: '新资料', publishedAt: '2026-10-02' },
          ],
          rejected: 0,
          duplicates: 0,
          searchRequests: 1,
          searchEvidence: 'search_count',
        },
        costMicrousd: 64200,
        costSource: 'provider',
        diagnostics: {
          ...diagnostics,
          searchRequests: 1,
          searchCountStatus: 'confirmed',
          annotationCount: 1,
        },
      },
      run: {
        id: 'synthetic-run',
        status: 'running',
        phase: 'preparing',
        lease_token: 'synthetic-lease',
        created_at: '2026-10-02T19:43:43Z',
        reserved_microusd: 1250000,
        result: null,
        snapshot: {
          discovery: { maxSources: 5 },
          profileId: 'profile',
          profileRevision: 1,
          topicIds: [],
          sourceUrls: [],
        },
      },
    });

  try {
    for (const code of [
      'discovery_search_unconfirmed',
      'discovery_invalid_output',
      'discovery_provider_error',
      'discovery_output_truncated',
    ]) {
      await t.test(`${code} preserves the provider charge and diagnostics`, async () => {
        const f = setup();
        f.failure = { code, costMicrousd: 64200, diagnostics };
        await assert.rejects(discoverSources('owner', f.run.id), { message: code });
        assert.equal(f.paidCalls, 1);
        assert.equal(f.fenceAttempts, 1);
        assert.equal(f.updates.length, 1);
        assert.equal(f.run.status, 'failed');
        assert.equal(f.run.phase, 'discovery_failed');
        assert.equal(f.updates[0].errorCode, code);
        assert.equal(f.run.charged_microusd, 64200);
        assert.equal(f.run.cost_source, 'provider');
        assert.deepEqual(f.run.result.discoveryDiagnostics, diagnostics);
        assert.equal(f.run.result.discovery, undefined);
        await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
        assert.equal(f.paidCalls, 1, 'a failed receipt does not authorize another paid call');
      });
    }

    await t.test('a confirmed zero-dollar charge is provider accounting, not unknown', async () => {
      const f = setup();
      f.failure = { code: 'discovery_search_unconfirmed', costMicrousd: 0, diagnostics };
      await assert.rejects(discoverSources('owner', f.run.id), /discovery_search_unconfirmed/);
      assert.equal(f.run.status, 'failed');
      assert.equal(f.run.charged_microusd, 0);
      assert.equal(f.run.cost_source, 'provider');
      assert.deepEqual(f.run.result.discoveryDiagnostics, diagnostics);
    });

    await t.test('unknown provider cost remains unknown and never becomes zero', async () => {
      const f = setup();
      f.failure = { code: 'discovery_search_unconfirmed', costMicrousd: null, diagnostics };
      await assert.rejects(discoverSources('owner', f.run.id), /discovery_search_unconfirmed/);
      assert.equal(f.run.status, 'unknown');
      assert.equal(Object.hasOwn(f.updates[0], 'costMicrousd'), false);
      assert.equal(Object.hasOwn(f.updates[0], 'costSource'), false);
      assert.deepEqual(f.run.result.discoveryDiagnostics, diagnostics);
      await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
      assert.equal(f.paidCalls, 1);
    });

    await t.test('a pre-call rejection does not charge or cross the paid-call fence', async () => {
      const f = setup();
      f.preCallError = 'capability_failed';
      await assert.rejects(discoverSources('owner', f.run.id), /capability_failed/);
      assert.equal(f.run.status, 'failed');
      assert.equal(f.run.charged_microusd, 0);
      assert.equal(f.run.cost_source, 'estimate');
      assert.equal(f.paidCalls, 0);
      assert.equal(f.fenceAttempts, 0);
      assert.equal(f.run.result.discoveryDiagnostics, undefined);
    });

    await t.test('budget rejection happens before any provider invocation', async () => {
      const f = setup();
      f.estimate = f.run.reserved_microusd + 1;
      await assert.rejects(discoverSources('owner', f.run.id), /budget_exceeded/);
      assert.equal(f.invocations, 0);
      assert.equal(f.paidCalls, 0);
      assert.equal(f.run.charged_microusd, 0);
    });

    await t.test('a duplicate losing the fence cannot overwrite the original run', async () => {
      const f = setup();
      f.run.result = { existingReceipt: 'must-stay' };
      f.fenceError = 'stale_attempt';
      await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
      assert.equal(f.updates.length, 0);
      assert.equal(f.paidCalls, 0);
      assert.deepEqual(f.run.result, { existingReceipt: 'must-stay' });
    });

    for (const searchEvidence of ['search_count', 'provider_url_citations']) {
      for (const costSource of ['provider', 'estimate']) {
        await t.test(
          `storage failure preserves the ${costSource} receipt with ${searchEvidence}`,
          async () => {
            const f = setup();
            f.receipt.costSource = costSource;
            f.receipt.result.searchEvidence = searchEvidence;
            if (searchEvidence === 'provider_url_citations') {
              f.receipt.result.searchRequests = null;
              f.receipt.diagnostics.searchRequests = null;
              f.receipt.diagnostics.searchCountStatus = 'missing';
            }
            f.updateErrors = ['synthetic_storage_failure'];
            await assert.rejects(discoverSources('owner', f.run.id), /discovery_unavailable/);
            assert.equal(f.updates.length, 2);
            assert.equal(f.run.status, 'failed');
            assert.equal(f.run.charged_microusd, f.receipt.costMicrousd);
            assert.equal(f.run.cost_source, costSource);
            assert.deepEqual(f.run.result.discovery, f.receipt.result);
            assert.deepEqual(f.run.result.discoveryDiagnostics, f.receipt.diagnostics);
            assert.equal(f.run.result.discoveryCostMicrousd, f.receipt.costMicrousd);
            assert.equal(f.run.result.discoveryCostSource, costSource);
            assert.equal(f.paidCalls, 1);
            await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
            assert.equal(f.paidCalls, 1);
          },
        );
      }
    }

    await t.test(
      'successful discovery stores diagnostics beside its deduplicated sources',
      async () => {
        const f = setup();
        assert.deepEqual(await discoverSources('owner', f.run.id), ['https://example.com/new']);
        assert.equal(f.run.phase, 'sources_discovered');
        assert.deepEqual(f.run.result.discovery, f.receipt.result);
        assert.deepEqual(f.run.result.discoveryDiagnostics, f.receipt.diagnostics);
        assert.deepEqual(f.knownUrls, [
          'https://example.com/collected',
          'https://example.com/published',
        ]);
        await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
        assert.equal(f.paidCalls, 1);
      },
    );

    await t.test(
      'citation-backed discovery persists an unknown search count without rewriting diagnostics',
      async () => {
        const f = setup();
        f.receipt.result.searchRequests = null;
        f.receipt.result.searchEvidence = 'provider_url_citations';
        f.receipt.diagnostics.searchRequests = null;
        f.receipt.diagnostics.searchCountStatus = 'missing';
        assert.deepEqual(await discoverSources('owner', f.run.id), ['https://example.com/new']);
        assert.equal(f.run.phase, 'sources_discovered');
        assert.equal(f.updates.length, 1);
        assert.deepEqual(f.run.result.discovery, f.receipt.result);
        assert.equal(f.run.result.discovery.searchRequests, null);
        assert.equal(f.run.result.discovery.searchEvidence, 'provider_url_citations');
        assert.deepEqual(f.run.result.discoveryDiagnostics, f.receipt.diagnostics);
        assert.equal(f.run.result.discoveryDiagnostics.searchRequests, null);
        assert.equal(f.run.result.discoveryDiagnostics.searchCountStatus, 'missing');
        assert.equal(f.run.result.discoveryCostMicrousd, 64200);
        assert.equal(f.run.result.discoveryCostSource, 'provider');
        assert.equal(f.paidCalls, 1);
        assert.equal(f.fenceAttempts, 1);
        await assert.rejects(discoverSources('owner', f.run.id), /stale_attempt/);
        assert.equal(f.paidCalls, 1, 'an accepted citation receipt never replays a paid search');
      },
    );

    await t.test('legacy URL configurations never invoke discovery or its paid fence', async () => {
      const f = setup();
      delete f.run.snapshot.discovery;
      f.run.snapshot.sourceUrls = ['https://example.com/legacy'];
      assert.deepEqual(await discoverSources('owner', f.run.id), ['https://example.com/legacy']);
      assert.equal(f.invocations, 0);
      assert.equal(f.fenceAttempts, 0);
      assert.equal(f.paidCalls, 0);
      assert.equal(f.updates.length, 0);
    });
  } finally {
    delete globalThis.__discoveryServer;
  }
});
