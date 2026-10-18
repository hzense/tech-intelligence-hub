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
      contents: `export { AdminSignalGeneration } from './components/admin-signal-generation'; export { GenerationLiveDetail } from './components/generation-live-detail'; export { GenerationProgress } from './components/generation-progress';`,
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
  const { AdminSignalGeneration, GenerationLiveDetail, GenerationProgress } = module.exports;
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
});
