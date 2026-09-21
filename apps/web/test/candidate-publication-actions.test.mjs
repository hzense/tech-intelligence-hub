import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL('../components/candidate-publication-actions.tsx', import.meta.url)),
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
  CandidatePublicationActions,
  latestReview,
  latestSubmittedReview,
  latestPublishedReview,
  automaticPublicationExtra,
  unreviewedPublicationReadiness,
  applyReviewPreparationGate,
} = module.exports;
test('publication controls require confirmation without operator-entered protocol fields', () => {
  const html = renderToStaticMarkup(
    createElement(CandidatePublicationActions, {
      runId: 'fixture',
      candidateIndex: 0,
      materialHash: 'hash',
    }),
  );
  assert.match(html, /刷新发布状态/);
  assert.match(html, /管理员无需复制 ID、填写 JSON 或选择技术原因/);
  for (const label of ['签名核验报告', '核验记录 UUID', '当前发布版本号', '发布 / 撤回原因'])
    assert.doesNotMatch(html, new RegExp(label));
});
test('latest review must be submitted and bind the current material', () => {
  const good = { revision: 1, decision: 'submit_verification', material_hash: 'hash' };
  assert.equal(latestSubmittedReview([good], 'hash'), good);
  assert.throws(() =>
    latestSubmittedReview([good, { ...good, revision: 2, decision: 'rejected' }], 'hash'),
  );
  assert.throws(() => latestSubmittedReview([good], 'changed'));
  assert.throws(() => latestSubmittedReview([], 'hash'));
});
test('inspection uses latest review while withdrawal selects latest submitted history', () => {
  const original = { revision: 1, decision: 'submit_verification', material_hash: 'hash' };
  const rejected = { ...original, revision: 2, decision: 'rejected' };
  assert.equal(latestReview([original, rejected], 'hash'), rejected);
  assert.equal(latestPublishedReview([rejected, original], 'hash'), original);
  assert.throws(() => latestPublishedReview([rejected], 'hash'));
  assert.throws(() => latestPublishedReview([original], 'other'));
});
test('protocol fields are derived from trusted stored state instead of operator input', () => {
  const verificationId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(
    automaticPublicationExtra('assemble', { verification: { verification_id: verificationId } }),
    { verificationId },
  );
  assert.throws(() => automaticPublicationExtra('assemble', {}));
  assert.deepEqual(automaticPublicationExtra('publish'), {
    expectedPublicationRevision: 0,
    reasonCode: 'initial_publication',
  });
  assert.deepEqual(
    automaticPublicationExtra('publish', { publication: { publication_revision: 4 } }),
    { expectedPublicationRevision: 4, reasonCode: 'republication' },
  );
  assert.deepEqual(
    automaticPublicationExtra('withdraw', { publication: { publication_revision: 4 } }),
    { expectedPublicationRevision: 4, reasonCode: 'operator_request' },
  );
  assert.throws(() => automaticPublicationExtra('withdraw'));
});
test('first review exposes only confirmation when server preparation is complete', () => {
  assert.deepEqual(
    unreviewedPublicationReadiness({
      configured: true,
      preparation: { ready: true, blockers: [], counts: { people: 1 } },
    }),
    { ready: true, status: 'review_confirmation_required', blocked: [] },
  );
  assert.deepEqual(
    unreviewedPublicationReadiness({
      configured: true,
      preparation: { ready: false, blockers: ['缺少公开证据'] },
    }),
    { ready: false, status: 'review_preparation_blocked', blocked: ['缺少公开证据'] },
  );
  assert.deepEqual(
    unreviewedPublicationReadiness({
      configured: false,
      preparation: { ready: true, blockers: [] },
    }),
    {
      ready: false,
      status: 'review_preparation_blocked',
      blocked: ['审核与发布写入尚未启用，当前只能查看候选和证据。'],
    },
  );
});
test('republication remains blocked until the server can prepare a new review revision', () => {
  const state = { ready: false, status: 'not_currently_public', blocked: ['历史发布已撤回'] };
  assert.equal(
    applyReviewPreparationGate(state, {
      configured: true,
      preparation: { ready: true, blockers: [] },
    }),
    state,
  );
  assert.deepEqual(
    applyReviewPreparationGate(state, {
      configured: true,
      preparation: { ready: false, blockers: ['公开证据已失效'] },
    }),
    {
      ready: false,
      status: 'review_preparation_blocked',
      blocked: ['公开证据已失效'],
    },
  );
});
