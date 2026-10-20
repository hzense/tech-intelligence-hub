import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('server-selected local UI explains simulation and technical reservation without changing production copy', async () => {
  const compiled = await build({
    stdin: {
      contents: `export { AdminSignalGeneration } from './components/admin-signal-generation'; export { GenerationLiveDetail } from './components/generation-live-detail'; export { GenerationProgress } from './components/generation-progress'; export { PrivateResult } from './components/private-generation-result';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.module.css': 'empty' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const { AdminSignalGeneration, GenerationLiveDetail, GenerationProgress, PrivateResult } =
    module.exports;
  const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
  const local = render(AdminSignalGeneration, { configured: true, localMode: true });
  assert.match(local, /本地信号生成联调/);
  assert.match(local, /不请求供应商、不调用真实 AI/);
  assert.match(local, /1 微美元（\$0\.000001）的技术预留/);
  assert.match(local, /技术预留和模拟记账不是实际费用/);
  assert.doesNotMatch(
    local,
    /我允许把所选资料.*发送给|手动执行可能产生费用|并可能再次计费|模型最多等待 25/,
  );
  const production = render(AdminSignalGeneration, { configured: true });
  assert.match(production, /今日 AI 调用费用总额/);
  assert.match(production, /我允许把所选资料.*发送给/);
  assert.match(production, /手动执行可能产生费用/);
  assert.doesNotMatch(production, /本地信号生成联调|技术预留和模拟记账不是实际费用/);
  const real = render(AdminSignalGeneration, {
    configured: true,
    localMode: true,
    localRealAi: true,
  });
  assert.match(real, /本地真实 AI 信号生成/);
  assert.match(real, /联网调用并可能产生费用/);
  assert.match(real, /我允许把所选资料.*发送给/);
  assert.match(real, /历史模拟技术预留不计入费用/);
  assert.doesNotMatch(real, /无 AI 调用费用|不请求供应商、不调用真实 AI|资料仅在本机处理/);
  const initialRun = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'failed',
    reserved_microusd: 1,
    charged_microusd: 1,
    result: null,
  };
  const detail = render(GenerationLiveDetail, { initialRun, localMode: true });
  assert.match(detail, /技术预留 1 微美元，记账 1 微美元/);
  assert.match(detail, /不是供应商费用/);
  assert.doesNotMatch(detail, /未确认成功；费用记录保留/);
  const progress = render(GenerationProgress, {
    run: { ...initialRun, status: 'running', progress_phase: 'generating' },
    localMode: true,
  });
  assert.match(progress, /本地模拟中/);
  assert.doesNotMatch(progress, /模型生成中/);
  for (const localRealAi of [false, true]) {
    const realRun = { ...initialRun, ai_mode: 'local-real' };
    const realDetail = render(GenerationLiveDetail, {
      initialRun: realRun,
      localMode: true,
      localRealAi,
    });
    assert.match(realDetail, /本地真实 AI 记录/);
    assert.match(realDetail, /未确认成功；费用记录保留/);
    assert.doesNotMatch(realDetail, /不是供应商费用|不产生供应商费用|本地模拟：/);
    const historicalMock = render(GenerationLiveDetail, {
      initialRun: { ...initialRun, ai_mode: 'local-mock' },
      localMode: true,
      localRealAi,
    });
    assert.match(historicalMock, /本地模拟：不请求供应商/);
    assert.match(historicalMock, /不是供应商费用/);
  }
  const oldMock = render(GenerationLiveDetail, {
    initialRun: { ...initialRun, profile_id: '1389674e-ea29-4a37-a563-073f498fb7f2' },
    localMode: true,
    localRealAi: true,
  });
  assert.match(oldMock, /本地模拟：不请求供应商/);
  const realCandidate = render(PrivateResult, {
    result: { classification: 'private', candidates: [] },
    reviewTask: { ...initialRun, ai_mode: 'local-real' },
    localMode: true,
  });
  assert.match(realCandidate, /本地页面或发布记录为准，未同步生产/);
  assert.doesNotMatch(realCandidate, /原始模拟候选|不代表真实 AI 分析/);
  const mockSnapshot = render(PrivateResult, {
    result: { classification: 'private', candidates: [] },
    reviewTask: { ...initialRun, ai_mode: 'local-mock' },
    localMode: true,
    localRealAi: true,
    snapshotOnly: true,
  });
  assert.match(mockSnapshot, /原始模拟候选快照/);
});
