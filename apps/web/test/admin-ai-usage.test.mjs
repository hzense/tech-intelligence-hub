import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../components/admin-ai-usage.tsx', import.meta.url))],
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
const render = (costs) =>
  renderToStaticMarkup(createElement(module.exports.AdminAiUsage, { costs }));

function costs(overrides = {}) {
  return {
    sampledAt: '2026-11-02T18:00:00.000Z',
    day: '2026-11-02',
    month: '2026-11',
    status: 'available',
    items: ['generation', 'enrichment', 'collection', 'insight', 'probe'].map((kind, index) => ({
      kind,
      scope: kind === 'probe' ? 'site' : 'owner',
      status: 'available',
      today: {
        chargedMicrousd: (index + 1) * 100_000,
        unsettledMicrousd: index === 0 ? 500_000 : 0,
      },
      monthToDate: {
        chargedMicrousd: (index + 1) * 1_000_000,
        unsettledMicrousd: index === 0 ? 750_000 : 0,
      },
    })),
    today: { chargedMicrousd: 1_500_000, unsettledMicrousd: 500_000 },
    monthToDate: { chargedMicrousd: 15_000_000, unsettledMicrousd: 750_000 },
    ...overrides,
  };
}

test('AI fees separate charged cost from unsettled amounts and explain owner versus site scope', () => {
  const html = render(costs());
  assert.match(html, /AI 调用费用/);
  assert.match(html, /今日已记账<span>2026-11-02<\/span><\/dt><dd>\$1\.50<\/dd>/);
  assert.match(html, /本月已记账<span>2026-11<\/span><\/dt><dd>\$15\.00<\/dd>/);
  assert.match(html, /未结额 \$0\.5000/);
  assert.match(html, /未结额 \$0\.7500/);
  assert.match(html, /<th scope="row">信号生成<\/th><td>当前管理员<\/td>/);
  assert.match(html, /<th scope="row">能力测试<\/th><td>全站<\/td>/);
  assert.match(html, /2026\/11\/02 18:00.*UTC/);
  assert.match(html, /真实调用，不含模拟/);
  assert.match(html, /API 返回值与未取得返回值时的估算，非供应商最终账单/);
  assert.match(html, /未结额尚未完成记账，单独展示，不计入已记账费用/);
});

test('partial AI data is a known subtotal and unavailable rows remain blank rather than zero', () => {
  const value = costs();
  value.items[1] = { ...value.items[1], status: 'unavailable', today: null, monthToDate: null };
  const html = render({
    ...value,
    status: 'partial',
    today: { chargedMicrousd: 1_300_000, unsettledMicrousd: 500_000 },
    monthToDate: { chargedMicrousd: 13_000_000, unsettledMicrousd: 750_000 },
  });
  assert.match(html, /数据不完整/);
  assert.match(html, /合计仅为已知小计，不代表完整费用/);
  assert.match(html, /今日已知小计/);
  assert.match(html, /\$1\.30/);
  const row = html.match(/<tr><th scope="row">材料补全[\s\S]*?<\/tr>/)?.[0];
  assert.ok(row);
  assert.match(row, /暂不可用/);
  assert.doesNotMatch(row, /\$0/);
});

test('unknown AI fees never become zero, while confirmed zero and tiny costs remain meaningful', () => {
  for (const value of [
    undefined,
    null,
    costs({ status: 'unavailable', today: null, monthToDate: null }),
  ]) {
    const html = render(value);
    assert.match(html, /暂不可用/);
    assert.doesNotMatch(html, /\$/);
  }
  const zero = render(
    costs({
      today: { chargedMicrousd: 0, unsettledMicrousd: 0 },
      monthToDate: { chargedMicrousd: 10, unsettledMicrousd: 0 },
    }),
  );
  assert.match(zero, /今日已记账<span>2026-11-02<\/span><\/dt><dd>\$0\.00<\/dd>/);
  assert.match(zero, /本月已记账<span>2026-11<\/span><\/dt><dd>&lt; \$0\.0001<\/dd>/);
});
