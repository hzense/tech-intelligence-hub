import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('review renders private evidence as text and cannot submit approval/publication', async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../components/candidate-review.tsx', import.meta.url))],
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
            contents: `import React from 'react'; export default function Link(props) { return React.createElement('a',props); }`,
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
  assert.match(html, /审核准备 · 未发布/);
  assert.match(html, /不保存审核决定/);
  assert.match(html, /候选 3/);
  assert.match(html, /disabled=""[^>]*aria-describedby="publish-blocked"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|<form|type="submit"/);
  assert.match(html, /\/admin\/signal-generation\/fixture-run/);
});
