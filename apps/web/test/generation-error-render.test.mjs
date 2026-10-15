import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('generation details explain bounded output failures without guessing historical causes', async () => {
  const compiled = await build({
    stdin: {
      contents: `export * from './lib/generation-error-messages'; export { GenerationLiveDetail } from './components/generation-live-detail';`,
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
  const { knownGenerationErrorMessage, generationFailureMessage, GenerationLiveDetail } =
    module.exports;
  const failures = {
    generation_invalid_json: '模型输出不是有效的 JSON',
    generation_invalid_envelope: '模型输出的顶层字段或对象结构不符合约定',
    generation_invalid_candidates: '模型输出的 candidates 字段不是候选数组',
    generation_too_many_candidates: '模型输出超过单次最多 5 条候选的限制',
    generation_invalid_reason: '模型输出的 reason 字段格式不符合约定',
    generation_output_too_large: '模型输出的正文超过安全大小限制',
    budget_exceeded: '预算不足，暂不能执行生成',
    source_changed: '原资料在任务创建后发生变化',
    configuration_changed: '任务创建后模型配置发生变化',
  };
  for (const [code, expected] of Object.entries(failures)) {
    const initialRun = {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      error_code: code,
      result: null,
    };
    const message = knownGenerationErrorMessage(code);
    assert.ok(message.startsWith(expected));
    assert.equal(generationFailureMessage(initialRun), message);
    const html = renderToStaticMarkup(createElement(GenerationLiveDetail, { initialRun }));
    assert.ok(html.includes(`aria-label="任务失败原因">失败原因：${message}`));
    assert.doesNotMatch(html, /调用 AI，可能计费|确认发布/);
  }
  const historical = generationFailureMessage({
    status: 'failed',
    error_code: 'generation_invalid_output',
  });
  assert.match(historical, /结构或原文证据校验/);
  assert.match(historical, /若没有记录，无法据此判断具体原因/);
  assert.doesNotMatch(historical, /不是有效的 JSON|名称未匹配|超时/);

  for (const unknown of [
    undefined,
    null,
    {},
    '__proto__',
    'constructor',
    'SYNTHETIC_PRIVATE_PROVIDER_TEXT',
    '<script>SYNTHETIC_PRIVATE_PROVIDER_TEXT</script>',
  ]) {
    assert.equal(knownGenerationErrorMessage(unknown), null);
    assert.match(generationFailureMessage({ status: 'failed', error_code: unknown }), /未保留/);
    assert.doesNotMatch(
      generationFailureMessage({ status: 'failed', error_code: unknown }),
      /SYNTHETIC_PRIVATE_PROVIDER_TEXT|script|constructor/,
    );
    assert.equal(generationFailureMessage({ status: 'completed', error_code: unknown }), null);
  }
});
