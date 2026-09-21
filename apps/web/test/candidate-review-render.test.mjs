import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('review renders private evidence safely and requires explicit configured review actions', async () => {
  const compiled = await build({
    stdin: {
      contents: `export { CandidateReview } from './components/candidate-review'; export { PrivateResult } from './components/private-generation-result';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'tsx',
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    external: ['react', 'react/jsx-runtime'],
    loader: { '.module.css': 'empty' },
    plugins: [
      {
        name: 'link-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^next\/link$/ }, () => ({
            path: 'link',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `import React from 'react'; export default function Link(props) { const {prefetch, ...rest} = props; return React.createElement('a',rest); }`,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const html = renderToStaticMarkup(
    createElement(module.exports.CandidateReview, {
      packet: {
        runId: 'fixture-run',
        candidateIndex: 2,
        materialHash: 'abc',
        canPublish: false,
        candidate: {
          index: 2,
          title: '<script>alert(1)</script>',
          summary: '候选摘要',
          claims: [],
          persons: [],
          organizations: [],
        },
        checks: [{ code: 'public_evidence', label: '公开来源', detail: '尚未核验' }],
        fragments: [
          { id: 'fragment-1', locator: { paragraph: 1 }, text: '<img src=x onerror=alert(1)>' },
        ],
      },
    }),
  );
  assert.match(html, /私有候选 · 未发布/);
  assert.match(html, /人工审核与可信核验分开保存/);
  assert.match(html, /候选 3/);
  assert.match(html, /保存草稿/);
  assert.match(html, /disabled=""/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /\/admin\/signal-generation\/fixture-run/);
  assert.match(html, /返回 AI 生成任务列表/);
  assert.doesNotMatch(html, /href="\/admin\/signal-review"|候选审核工作台|候选审核汇总/);
  assert.doesNotMatch(html, /aria-label="审核候选/);

  const id = '11111111-1111-4111-8111-111111111111';
  const candidate = {
    index: 3,
    classification: 'private',
    status: 'needs_review',
    title: '部分通过的第四条候选',
  };
  const result = { classification: 'private', candidates: [candidate] };
  const render = (reviewTask, value = result) =>
    renderToStaticMarkup(
      createElement(module.exports.PrivateResult, { result: value, reviewTask }),
    );
  const taskHtml = render({ id, status: 'completed' });
  assert.match(taskHtml, new RegExp(`href="/admin/signal-review/${id}/3"`));
  assert.match(taskHtml, /aria-label="审核候选 4"/);
  assert.doesNotMatch(taskHtml, new RegExp(`/admin/signal-review/${id}/0`));
  for (const status of ['pending', 'running', 'failed', 'unknown', 'cancelled'])
    assert.doesNotMatch(render({ id, status }), /aria-label="审核候选/);
  for (const index of [undefined, -1, 5, 0.5, '3'])
    assert.doesNotMatch(
      render({ id, status: 'completed' }, { ...result, candidates: [{ ...candidate, index }] }),
      /aria-label="审核候选/,
    );
  assert.doesNotMatch(render(undefined), /aria-label="审核候选/);
  assert.doesNotMatch(render({ id: '../invalid', status: 'completed' }), /aria-label="审核候选/);
});
