import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  prepareReviewedSignalCandidate,
  readReviewedPublicationMaterial,
  recordReviewedVerification,
  assembleReviewedVerifiedCandidate,
  publishReviewedSignal,
  withdrawReviewedSignal,
} from '../src/candidate-review-publication.mjs';
const identity = () => ({
  runId: randomUUID(),
  candidateIndex: 0,
  expectedReviewRevision: 1,
  materialHash: 'a'.repeat(64),
});
const unopened = {
  connect() {
    throw new Error('Database must not be touched');
  },
};
describe('review publication server-only boundary', () => {
  it('rejects client lease/verified flags and invalid candidate indices before connecting', async () => {
    for (const extra of [
      { verified: true },
      { lease_owner: randomUUID() },
      { candidateIndex: 5 },
      { expectedReviewRevision: 0 },
      { materialHash: 'not-a-hash' },
    ])
      await expect(
        prepareReviewedSignalCandidate({
          pool: unopened,
          owner: 'owner',
          request: { ...identity(), requestKey: 'one', ...extra },
        }),
      ).rejects.toThrow('invalid_request');
  });
  it('rejects shared pools which would deadlock under the review lock', async () => {
    for (const call of [
      () =>
        readReviewedPublicationMaterial({
          pool: unopened,
          verificationPool: unopened,
          owner: 'owner',
          request: identity(),
        }),
      () =>
        recordReviewedVerification({
          pool: unopened,
          verificationPool: unopened,
          owner: 'owner',
          request: { ...identity(), report: {}, attestation: {} },
        }),
      () =>
        assembleReviewedVerifiedCandidate({
          pool: unopened,
          verificationPool: unopened,
          owner: 'owner',
          request: { ...identity(), requestKey: 'a', verificationId: randomUUID() },
        }),
      () =>
        publishReviewedSignal({
          pool: unopened,
          publisherPool: unopened,
          owner: 'owner',
          request: { ...identity(), requestKey: 'a' },
        }),
      () =>
        withdrawReviewedSignal({
          pool: unopened,
          publisherPool: unopened,
          owner: 'owner',
          request: { ...identity(), requestKey: 'a' },
        }),
    ])
      await expect(call()).rejects.toThrow('invalid_request');
  });
  it('requires an explicit matching initial publication revision and reason', async () => {
    for (const values of [
      { expectedPublicationRevision: 1, reasonCode: 'initial_publication' },
      { expectedPublicationRevision: 0, reasonCode: 'content_correction' },
    ])
      await expect(
        publishReviewedSignal({
          pool: unopened,
          publisherPool: {},
          controlPool: {},
          owner: 'owner',
          request: { ...identity(), requestKey: 'a', ...values },
        }),
      ).rejects.toThrow('invalid_request');
  });
  it('rejects invalid withdrawal revision or reason without creating any command', async () => {
    for (const values of [
      { expectedPublicationRevision: 0, reasonCode: 'operator_request' },
      { expectedPublicationRevision: 1, reasonCode: 'unknown' },
    ])
      await expect(
        withdrawReviewedSignal({
          pool: unopened,
          publisherPool: {},
          owner: 'owner',
          request: { ...identity(), requestKey: 'a', ...values },
        }),
      ).rejects.toThrow('invalid_request');
  });
});
