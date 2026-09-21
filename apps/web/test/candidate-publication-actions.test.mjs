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
  latestSubmittedReview,
  withdrawalReview,
  inspectionReview,
  publicationExtra,
} = module.exports;
const blank = { envelope: '', verificationId: '', publicationRevision: '', reasonCode: '' };
test('publication stages require explicit actions with only inspection initially enabled', () => {
  const html = renderToStaticMarkup(
    createElement(CandidatePublicationActions, {
      runId: 'fixture',
      candidateIndex: 0,
      materialHash: 'hash',
    }),
  );
  assert.match(html, /检查发布资格/);
  for (const label of [
    '转换为正式私有候选',
    '提交签名核验报告',
    '组装待发布版本',
    '正式发布',
    '撤回正式信号',
  ])
    assert.match(html, new RegExp(`disabled=""[^>]*>${label}</button>`));
  assert.match(html, /不触发 AI 生成/);
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
test('withdrawal selects original bound revision despite later rejection', () => {
  const original = { revision: 1, decision: 'submit_verification', material_hash: 'hash' };
  const rejected = { ...original, revision: 2, decision: 'rejected' };
  assert.equal(withdrawalReview([rejected, original], 'hash', '1'), original);
  assert.equal(inspectionReview([rejected, original], 'hash', '1'), original);
  assert.equal(inspectionReview([original, rejected], 'hash', ''), rejected);
  for (const revision of ['', '0', '-1', '1.5', '3'])
    assert.throws(() => withdrawalReview([original], 'hash', revision));
  assert.throws(() => withdrawalReview([original], 'other', '1'));
});
test('each action takes only its own bounded inputs', () => {
  assert.deepEqual(publicationExtra('prepare', { ...blank, envelope: 'bad' }), {});
  assert.deepEqual(publicationExtra('verify', { ...blank, envelope: '{"signature":"signed"}' }), {
    envelope: { signature: 'signed' },
  });
  for (const envelope of ['bad', 'null', '[]'])
    assert.throws(() => publicationExtra('verify', { ...blank, envelope }));
  const verificationId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(publicationExtra('assemble', { ...blank, verificationId }), { verificationId });
  assert.throws(() => publicationExtra('assemble', blank));
  for (const action of ['publish', 'withdraw']) {
    const reasonCode = action === 'publish' ? 'initial_publication' : 'operator_request';
    assert.deepEqual(publicationExtra(action, { ...blank, publicationRevision: '2', reasonCode }), {
      expectedPublicationRevision: 2,
      reasonCode,
    });
    assert.throws(() =>
      publicationExtra(action, {
        ...blank,
        publicationRevision: '2',
        reasonCode: 'free_form_reason',
      }),
    );
    assert.throws(() =>
      publicationExtra(action, {
        ...blank,
        publicationRevision: '2',
        reasonCode: action === 'publish' ? 'operator_request' : 'initial_publication',
      }),
    );
    for (const publicationRevision of ['', '-1', '1.5', '9007199254740993'])
      assert.throws(() =>
        publicationExtra(action, { ...blank, publicationRevision, reasonCode: 'approved' }),
      );
  }
});
