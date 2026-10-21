import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  LOCAL_GENERATION_PROFILE_ID,
  localGenerationAccess,
  invokeLocalGeneration,
  localFixtureSourceOptions,
} from '../lib/local-generation.ts';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import {
  buildGenerationSource,
  GENERATION_RESOURCES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';

const secret = 'a'.repeat(64);
const env = {
  NODE_ENV: 'development',
  HZENSE_LOCAL_DEVELOPMENT: '1',
  PORT: '3000',
  NEXTAUTH_URL: 'http://127.0.0.1:3000',
  HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
  HZENSE_RUNTIME_EXPECTED_PORT: '55432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  HZENSE_RUNTIME_DATABASE_URL: `postgresql://hzense_runtime:${secret}@127.0.0.1:55432/hzense_local`,
};
const topics = [{ id: 'topic-semiconductors', title: '半导体' }];
const template = await readFile(
  new URL('../../../docs/fixtures/local-signal.md', import.meta.url),
  'utf8',
);
function input(text) {
  const access = localGenerationAccess(LOCAL_GENERATION_PROFILE_ID, 1, true, env);
  const source = buildGenerationSource(
    parseImportOutput({
      fragments: text
        .split(/\n\s*\n/u)
        .map((text, index) => ({ text, locator: { paragraph: index + 1 } })),
    }),
  );
  return {
    source,
    topics,
    stage: access.profile.stages.extract,
    connection: access.connection,
    apiKey: access.apiKey,
    allowedHosts: [],
    outputContract: GENERATION_RESOURCES_CONTRACT,
  };
}

test('simulation profile is explicitly fictional, detached from mutable callers and unavailable outside strict local mode', () => {
  const first = localGenerationAccess(LOCAL_GENERATION_PROFILE_ID, 1, false, env);
  assert.match(first.profile.name, /本地模拟.*非真实模型/);
  assert.equal(first.connection.settings.input_price_microusd_per_million, 0);
  assert.equal(first.connection.settings.output_price_microusd_per_million, 0);
  assert.equal('apiKey' in first, false);
  first.profile.name = 'mutated';
  assert.notEqual(
    localGenerationAccess(LOCAL_GENERATION_PROFILE_ID, 1, false, env).profile.name,
    'mutated',
  );
  for (const bad of [
    { ...env, NODE_ENV: 'production' },
    { ...env, VERCEL_ENV: 'production' },
    { ...env, VERCEL: '1' },
    { ...env, HZENSE_LOCAL_DEVELOPMENT: '0' },
    { ...env, DATABASE_URL: 'postgresql://user:secret@remote.example/db' },
  ])
    assert.throws(() => localGenerationAccess(LOCAL_GENERATION_PROFILE_ID, 1, true, bad), {
      code: 'local_development_unavailable',
    });
  assert.throws(() => localGenerationAccess(LOCAL_GENERATION_PROFILE_ID, 2, true, env), {
    code: 'local_development_unavailable',
  });
  assert.throws(() => localGenerationAccess('11111111-1111-4111-8111-111111111111', 1, true, env), {
    code: 'local_development_unavailable',
  });
});

test('ordinary imported documents never masquerade as generated AI analysis', async () => {
  for (const text of [
    '某公司发布芯片，研究员宣布最新成果。',
    template.replace('HZense 本地联调资料', '真实新闻'),
    '# HZense 本地联调资料\n\n这是缺少必要字段的测试资料。',
  ]) {
    const result = await invokeLocalGeneration(input(text), env);
    assert.equal(result.success, true);
    assert.deepEqual(result.output.candidates, []);
    assert.match(result.output.reason, /本地模拟.*未调用真实模型/);
    assert.equal(result.input_tokens, 0);
    assert.equal(result.output_tokens, 0);
    assert.equal('provider_cost_microusd' in result, false);
  }
});

test('new local simulations use the explicit article publication date without reinterpreting historical fixtures', async () => {
  const request = { ...input(template), outputContract: GENERATION_SOURCE_PUBLICATION_CONTRACT };
  const result = await invokeLocalGeneration(request, env);
  assert.equal(result.output.candidates[0].event_date, '2026-10-19');
  assert.equal(result.output.candidates[0].date_basis, 'source_published');
  assert.match(result.output.candidates[0].event_date_evidence[0].quote, /^原文发布日期：/u);
  const legacy = await invokeLocalGeneration(input(template), env);
  assert.equal(legacy.output.candidates[0].event_date, '2026-10-18');
  assert.equal('date_basis' in legacy.output.candidates[0], false);
  const missing = await invokeLocalGeneration(
    { ...request, source: input(template.replace('原文发布日期：2026-10-19', '')).source },
    env,
  );
  assert.equal(missing.output.candidates.length, 0);
});

test('checked-in fixture produces a valid candidate with literal source evidence and zero real model calls', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('network_forbidden_in_fixture');
  });
  const value = input(template);
  const result = await invokeLocalGeneration(value, env);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(result.success, true);
  assert.equal(result.output.candidates.length, 1);
  const candidate = result.output.candidates[0];
  assert.match(candidate.title, /^【本地模拟】/);
  assert.equal(candidate.event_date, '2026-10-18');
  assert.deepEqual(candidate.topic_ids, ['topic-semiconductors']);
  assert.equal(candidate.signal_type, 'technology');
  assert.equal(candidate.persons[0].name, '林青');
  assert.deepEqual(candidate.organizations, ['示例计算公司']);
  assert.equal(candidate.resources.length, 2);
  const evidence = [
    ...candidate.event_date_evidence,
    ...candidate.persons.flatMap((person) => person.evidence),
    ...candidate.claims.flatMap((claim) => claim.evidence),
    ...candidate.resources.flatMap((resource) => resource.evidence),
  ];
  assert.ok(evidence.length >= 5);
  for (const reference of evidence) {
    const fragment = value.source.fragments.find(
      (fragment) => fragment.id === reference.fragment_id,
    );
    assert.ok(fragment, 'evidence must reference an existing source fragment');
    assert.ok(fragment.text.includes(reference.quote), 'quote must be a literal substring');
  }
  assert.equal(result.input_tokens, 0);
  assert.equal(result.output_tokens, 0);
  assert.equal('provider_cost_microusd' in result, false);
  assert.match(result.output.reason, /不代表真实 AI 分析/);
  assert.deepEqual(await invokeLocalGeneration(value, env), result);
});

test('simulation invocation refuses production contexts and real provider/model identities', async () => {
  const value = input(template);
  for (const bad of [
    { ...env, NODE_ENV: 'production' },
    { ...env, VERCEL: '1' },
    { ...env, HZENSE_LOCAL_DEVELOPMENT: '0' },
  ])
    await assert.rejects(invokeLocalGeneration(value, bad), {
      code: 'local_development_unavailable',
    });
  for (const altered of [
    { ...value, stage: { ...value.stage, model_id: 'real/provider-model' } },
    { ...value, connection: { ...value.connection, id: 'different' } },
    { ...value, connection: { ...value.connection, base_url: 'https://openrouter.ai/api/v1' } },
  ])
    await assert.rejects(invokeLocalGeneration(altered, env), {
      code: 'local_development_unavailable',
    });
});

test('fictional publication source is available only to a completed, source-bound local fixture task', () => {
  const value = input(template);
  const run = {
    generation_version: 'local-simulation-v1',
    profile_id: LOCAL_GENERATION_PROFILE_ID,
    profile_revision: 1,
    status: 'completed',
    source_hash: signalGenerationSourceHash(value.source),
    snapshot: { source: value.source },
  };
  const sources = localFixtureSourceOptions(run, env);
  assert.equal(sources.length, 1);
  assert.match(JSON.stringify(sources), /https:\/\/example\.invalid\//);
  assert.deepEqual(
    localFixtureSourceOptions(
      {
        ...run,
        generation_version: 'local-simulation-v1/retry/11111111-1111-4111-8111-111111111111',
      },
      env,
    ),
    sources,
  );
  for (const changed of [
    { ...run, generation_version: 'private-candidate-v1' },
    { ...run, generation_version: 'local-simulation-v1-other' },
    { ...run, generation_version: 'local-simulation-v1/retry/not-a-uuid' },
    {
      ...run,
      generation_version: 'local-simulation-v1/retry/11111111-1111-4111-8111-111111111111/extra',
    },
    {
      ...run,
      generation_version: 'local-simulation-v1/retry/11111111-1111-4111-8111-111111111111\n',
    },
    { ...run, profile_id: '11111111-1111-4111-8111-111111111111' },
    { ...run, profile_revision: 2 },
    { ...run, status: 'running' },
    { ...run, status: 'failed' },
    { ...run, source_hash: '0'.repeat(64) },
  ])
    assert.deepEqual(localFixtureSourceOptions(changed, env), []);
  const ordinary = input('普通资料，没有本地联调模板标记。').source;
  assert.deepEqual(
    localFixtureSourceOptions(
      { ...run, source_hash: signalGenerationSourceHash(ordinary), snapshot: { source: ordinary } },
      env,
    ),
    [],
  );
  const tampered = input(template.replace('示例计算公司', 'different company')).source;
  assert.deepEqual(
    localFixtureSourceOptions({ ...run, snapshot: { source: { fragments: null } } }, env),
    [],
  );
  assert.deepEqual(localFixtureSourceOptions({ ...run, snapshot: { source: null } }, env), []);
  assert.deepEqual(localFixtureSourceOptions({ ...run, snapshot: { source: tampered } }, env), []);
  for (const bad of [
    { ...env, NODE_ENV: 'production' },
    { ...env, VERCEL: '1' },
    { ...env, HZENSE_LOCAL_DEVELOPMENT: '0' },
  ])
    assert.deepEqual(localFixtureSourceOptions(run, bad), []);
});
