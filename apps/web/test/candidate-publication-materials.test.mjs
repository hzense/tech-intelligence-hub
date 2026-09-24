import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPublicationMaterials } from '../lib/candidate-publication-materials.ts';

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL('../components/candidate-publication-materials.tsx', import.meta.url)),
  ],
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
const render = (materials) =>
  renderToStaticMarkup(createElement(module.exports.CandidatePublicationMaterials, { materials }));

test('material presentation is confirmation-only, escapes private evidence, and distinguishes matching from verification', () => {
  const materials = buildPublicationMaterials(
    {
      title: '<script>bad()</script>',
      summary: '私有材料摘要',
      event_date: null,
      persons: [],
      organizations: [],
      claims: [
        {
          text: '私有主张',
          evidence: [{ fragment_id: 'fragment-1', quote: '<img src=x onerror=bad()>' }],
        },
      ],
    },
    { people: [], organizations: [], topics: [], evidence: [] },
    [],
  );
  const html = render(materials);
  assert.match(html, /正式发布材料/);
  assert.match(html, /已关联不等于事实核验通过/);
  assert.match(html, /至少需要一位有事件原文依据的人物/);
  assert.match(html, /私有上传内容不能直接转为公开证据/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img|<input|<textarea|<select/);
});

test('only safe public source links are rendered, and identifiers stay optional details', () => {
  const materials = {
    title: '标题',
    summary: '摘要',
    items: [
      {
        key: 'claim:0',
        label: '主张',
        proposed: '已登记证据',
        status: 'matched',
        references: [],
        matches: [{ id: 'e1', name: '证据', sourceUrl: 'https://example.com/source' }],
        nextStep: '仍须核验',
      },
    ],
  };
  const html = render(materials);
  assert.match(html, /href="https:\/\/example.com\/source"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /<summary>关联记录<\/summary>/);
  for (const sourceUrl of [
    'javascript:bad()',
    'https://user:secret@example.com/source',
    'https://example.com/source#fragment',
  ]) {
    materials.items[0].matches[0].sourceUrl = sourceUrl;
    const bad = render(materials);
    assert.doesNotMatch(bad, /href=|user:secret/);
    assert.match(bad, /来源地址无效/);
  }
});
