import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL('../components/candidate-review-editor.tsx', import.meta.url)),
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
const {
  CandidateReviewEditor,
  reviewLines,
  parseReviewClaims,
  reviewChangedFields,
  reviewRequestIdentity,
  reviewCodePoints,
} = module.exports;

test('candidate editor exposes edit and decisions without presenting approval as verified', () => {
  const html = renderToStaticMarkup(
    createElement(CandidateReviewEditor, {
      runId: 'fixture',
      candidateIndex: 0,
      materialHash: 'hash',
      initialDraft: { title: '<script>bad</script>', summary: '摘要', eventDate: null },
    }),
  );
  for (const label of [
    '保存草稿',
    '标记待补证',
    '拒绝候选',
    '保存并送核验',
    '审核历史与修订对比',
    '事件发生日期',
    '正式人物 ID',
  ])
    assert.ok(html.includes(label));
  assert.doesNotMatch(html, /maxLength="(?:80|500)"/);
  assert.match(html, /fieldset disabled=""/);
  assert.match(html, /送核验不是正式发布/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|核验已通过|立即发布/);
});
test('title and summary limits count Unicode code points, including supplementary Han characters', () => {
  for (const limit of [80, 500]) {
    const text = '𠀀'.repeat(limit);
    assert.equal(reviewCodePoints(text, limit), text);
    assert.equal(reviewCodePoints(text + '多', limit), text);
  }
});
test('review multiline parsing retains exact claims and rejects missing evidence binding', () => {
  assert.deepEqual(reviewLines(' a\r\n\n b '), ['a', 'b']);
  assert.deepEqual(parseReviewClaims('事件 A | evidence-1\n事件 B | evidence-2'), [
    { text: '事件 A', evidenceId: 'evidence-1' },
    { text: '事件 B', evidenceId: 'evidence-2' },
  ]);
  for (const value of ['只有文本', ' | evidence', 'text | '])
    assert.throws(() => parseReviewClaims(value));
  assert.deepEqual(parseReviewClaims(''), []);
});
test('review diff compares all material fields, including removal', () => {
  const before = { title: '原题', summary: '原摘要', personIds: ['a'], eventDate: null };
  assert.deepEqual(reviewChangedFields(before, { ...before, title: '新题', personIds: [] }), [
    'title',
    'personIds',
  ]);
});
test('uncertain save reuses original request identity, changed payload receives new identity', () => {
  let calls = 0;
  const nextId = () => `id-${++calls}`;
  const first = reviewRequestIdentity(null, 'revision=0;draft=a', nextId);
  assert.equal(reviewRequestIdentity(first, 'revision=0;draft=a', nextId), first);
  assert.equal(calls, 1);
  assert.equal(reviewRequestIdentity(first, 'revision=0;draft=b', nextId).requestId, 'id-2');
  assert.equal(reviewRequestIdentity(first, 'revision=1;draft=a', nextId).requestId, 'id-3');
});
