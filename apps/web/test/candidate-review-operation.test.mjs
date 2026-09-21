import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';

// Run the real server dispatcher with isolated service boundaries and environment.
// No database, provider, global environment mutation or production credentials.
const built = await build({
  entryPoints: [
    fileURLToPath(new URL('../lib/server/candidate-review-publication.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'isolated-review-services',
      setup(builder) {
        builder.onResolve({ filter: /candidate-review-publication\.mjs$/ }, () => ({
          path: 'fixture:publication',
          external: true,
        }));
        builder.onResolve({ filter: /candidate-pipeline-role\.mjs$/ }, () => ({
          path: 'fixture:role',
          external: true,
        }));
        builder.onResolve({ filter: /candidate-review-config$/ }, () => ({
          path: 'fixture:config',
          external: true,
        }));
        builder.onResolve({ filter: /^\.\/candidate-review$/ }, () => ({
          path: 'fixture:review',
          external: true,
        }));
      },
    },
  ],
});
const realRequire = createRequire(import.meta.url);
const owner = 'authenticated-admin-subject';
const principalId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
function request(extra = {}) {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    candidateIndex: 0,
    expectedReviewRevision: 1,
    materialHash: 'a'.repeat(64),
    requestKey: 'review-operation-test',
    ...extra,
  };
}
function fixture(overrides = {}) {
  const env = {
    HZENSE_CANDIDATE_PIPELINE_ENABLED: '1',
    HZENSE_REVIEW_ENABLED: '1',
    HZENSE_SIGNAL_READ_MODE: 'database',
    HZENSE_REVIEW_PUBLICATION_TASK_ID: taskId,
    HZENSE_REVIEW_PUBLISHER_PRINCIPALS: JSON.stringify({ [owner]: principalId }),
    HZENSE_VERIFIER_PUBLIC_KEYS: '{}',
    ...overrides,
  };
  const calls = [];
  let writeChecks = 0;
  class ReviewConfigurationError extends Error {
    constructor() {
      super('not_configured');
      this.code = 'not_configured';
    }
  }
  const publication = Object.fromEntries(
    [
      'inspectReviewedCandidate',
      'prepareReviewedSignalCandidate',
      'readReviewedPublicationMaterial',
      'recordReviewedVerification',
      'assembleReviewedVerifiedCandidate',
      'publishReviewedSignal',
      'withdrawReviewedSignal',
    ].map((name) => [
      name,
      async (args) => {
        calls.push({ name, args });
        if (name === 'inspectReviewedCandidate')
          return {
            readiness: 'published',
            publication: { status: 'published', publication_revision: 1 },
          };
        if (name === 'readReviewedPublicationMaterial')
          return {
            bundle: { snapshot: { content_hash: 'b'.repeat(64) } },
            bundle_fingerprint: 'c'.repeat(64),
          };
        return { outcome: 'fixture', signal_id: 'review-fixture', source_version: 1 };
      },
    ]),
  );
  const require = (name) => {
    if (name === 'server-only') return {};
    if (name === 'pg')
      return {
        Pool: class {
          constructor() {
            throw new Error('Unexpected database construction');
          }
        },
      };
    if (name === 'fixture:publication') return publication;
    if (name === 'fixture:role')
      return {
        assertCandidatePipelineRole: () => {
          throw new Error('Unexpected database role probe');
        },
      };
    if (name === 'fixture:config')
      return {
        ReviewConfigurationError,
        readCandidateRoleConfiguration: () => {
          throw new Error('Unexpected database configuration read');
        },
      };
    if (name === 'fixture:review')
      return {
        requireReviewWrites: () => {
          writeChecks++;
          if (env.HZENSE_REVIEW_ENABLED !== '1') throw new ReviewConfigurationError();
        },
      };
    return realRequire(name);
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', built.outputFiles[0].text)(
    require,
    module,
    module.exports,
    { env },
  );
  return {
    operate: module.exports.operateCandidateReview,
    calls,
    get writeChecks() {
      return writeChecks;
    },
  };
}
test('inspect fetches actual receipts while both write switches are disabled', async () => {
  for (const disabled of [undefined, '0']) {
    const f = fixture({
      HZENSE_CANDIDATE_PIPELINE_ENABLED: disabled,
      HZENSE_REVIEW_ENABLED: disabled,
    });
    const response = await f.operate(owner, 'inspect', request());
    assert.equal(response.readiness.status, 'published');
    assert.equal(response.readiness.receipt.publication.publication_revision, 1);
    assert.deepEqual(
      f.calls.map((c) => c.name),
      ['inspectReviewedCandidate'],
    );
    assert.equal(f.calls[0].args.owner, owner);
    assert.equal(f.writeChecks, 0);
  }
});
test('historical withdrawal bypasses enable switches, database read mode and publisher mapping but retains server owner', async () => {
  const f = fixture({
    HZENSE_CANDIDATE_PIPELINE_ENABLED: '0',
    HZENSE_REVIEW_ENABLED: '0',
    HZENSE_SIGNAL_READ_MODE: 'seed',
    HZENSE_REVIEW_PUBLISHER_PRINCIPALS: undefined,
    HZENSE_REVIEW_PUBLICATION_TASK_ID: undefined,
  });
  await f.operate(
    owner,
    'withdraw',
    request({ expectedPublicationRevision: 2, reasonCode: 'operator_request' }),
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['withdrawReviewedSignal'],
  );
  assert.equal(f.calls[0].args.owner, owner);
  assert.equal(f.calls[0].args.request.expectedReviewRevision, 1);
  assert.equal(f.writeChecks, 0);
});
test('publication requires both enable gates and database public read mode before any business write', async () => {
  for (const env of [
    { HZENSE_CANDIDATE_PIPELINE_ENABLED: '0' },
    { HZENSE_REVIEW_ENABLED: '0' },
    { HZENSE_SIGNAL_READ_MODE: 'seed' },
  ]) {
    const f = fixture(env);
    await assert.rejects(
      f.operate(
        owner,
        'publish',
        request({ expectedPublicationRevision: 0, reasonCode: 'initial_publication' }),
      ),
      { code: 'not_configured' },
    );
    assert.equal(f.calls.length, 0);
  }
});
test('publication derives trusted control exclusively from deployment owner mapping', async () => {
  const f = fixture();
  await f.operate(
    owner,
    'publish',
    request({ expectedPublicationRevision: 0, reasonCode: 'initial_publication' }),
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['publishReviewedSignal'],
  );
  assert.deepEqual(f.calls[0].args.trustedControl, { taskId, principalId });
  assert.equal(f.calls[0].args.owner, owner);
  assert.equal(f.writeChecks, 1);
  assert.notEqual(f.calls[0].args.pool, f.calls[0].args.publisherPool);
  assert.notEqual(f.calls[0].args.controlPool, f.calls[0].args.publisherPool);
  for (const mapping of [
    'null',
    '[]',
    '{}',
    '{"someone-else":"' + principalId + '"}',
    '{"' + owner + '":false}',
  ]) {
    const blocked = fixture({ HZENSE_REVIEW_PUBLISHER_PRINCIPALS: mapping });
    await assert.rejects(
      blocked.operate(
        owner,
        'publish',
        request({ expectedPublicationRevision: 0, reasonCode: 'initial_publication' }),
      ),
      { code: 'not_configured' },
    );
    assert.equal(blocked.calls.length, 0);
  }
});
test('extra owner, principal, task, pool or trusted-control fields are rejected before dispatch', async () => {
  for (const action of ['inspect', 'prepare', 'withdraw', 'publish'])
    for (const extra of [
      { owner: 'attacker' },
      { principalId },
      { taskId },
      { trustedControl: { taskId, principalId } },
      { pool: {} },
    ]) {
      const f = fixture();
      const input = request({
        ...(['withdraw', 'publish'].includes(action)
          ? { expectedPublicationRevision: 1, reasonCode: 'operator_request' }
          : {}),
        ...extra,
      });
      await assert.rejects(f.operate(owner, action, input), { code: 'invalid_request' });
      assert.equal(f.calls.length, 0);
      assert.equal(f.writeChecks, 0);
    }
});
test('invalid or untrusted verifier signatures never reach verification persistence', async () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const trusted = fixture({
    HZENSE_VERIFIER_PUBLIC_KEYS: JSON.stringify({
      trusted: {
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        verifierId: 'fixture-verifier',
      },
    }),
  });
  await assert.rejects(
    trusted.operate(
      owner,
      'verify',
      request({
        envelope: {
          keyId: 'trusted',
          payload: 'e30=',
          signature: Buffer.alloc(64).toString('base64'),
        },
      }),
    ),
    { code: 'verification_invalid' },
  );
  assert.equal(trusted.calls.length, 0);
  for (const envelope of [
    { keyId: 'unknown', payload: 'e30=', signature: 'AAAA' },
    null,
    { verified: true },
  ]) {
    const f = fixture();
    await assert.rejects(f.operate(owner, 'verify', request({ envelope })), {
      code: 'verification_invalid',
    });
    assert.equal(f.calls.length, 0);
  }
});
test('verification rejects browser report shortcuts and is blocked by either write gate', async () => {
  const f = fixture();
  await assert.rejects(
    f.operate(owner, 'verify', request({ envelope: {}, report: { decision: 'approved' } })),
    { code: 'invalid_request' },
  );
  assert.equal(f.calls.length, 0);
  for (const env of [{ HZENSE_CANDIDATE_PIPELINE_ENABLED: '0' }, { HZENSE_REVIEW_ENABLED: '0' }]) {
    const gated = fixture(env);
    await assert.rejects(gated.operate(owner, 'verify', request({ envelope: {} })), {
      code: 'not_configured',
    });
    assert.equal(gated.calls.length, 0);
  }
});
