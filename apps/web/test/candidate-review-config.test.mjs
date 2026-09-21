import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readReviewDatabaseConfiguration,
  readCandidateRoleConfiguration,
} from '../lib/candidate-review-config.ts';

const host = 'ep-review-test-pooler.us-east-1.aws.neon.tech';
const value = `postgresql://hzense_candidate_reviewer:synthetic-password@${host}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
const env = {
  HZENSE_REVIEW_DATABASE_URL: value,
  HZENSE_RUNTIME_EXPECTED_HOST: host,
  HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
  HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  VERCEL_ENV: 'production',
};
test('review connection keeps exact dedicated identity and validates production target', () => {
  assert.equal(readReviewDatabaseConfiguration(env), value);
  const assembler = value.replace('hzense_candidate_reviewer', 'hzense_candidate_assembler');
  assert.equal(
    readCandidateRoleConfiguration(
      { ...env, HZENSE_CANDIDATE_DATABASE_URL: assembler },
      'HZENSE_CANDIDATE_DATABASE_URL',
      'hzense_candidate_assembler',
    ),
    assembler,
  );
});
test('review connection never falls back and reports no credential details', () => {
  for (const patch of [
    { HZENSE_REVIEW_DATABASE_URL: undefined, DATABASE_URL: value },
    { HZENSE_REVIEW_DATABASE_URL: value.replace('hzense_candidate_reviewer', 'hzense_migrator') },
    { HZENSE_REVIEW_DATABASE_URL: value.replace('verify-full', 'disable') },
    { HZENSE_REVIEW_DATABASE_URL: value + '\n' },
    { HZENSE_RUNTIME_EXPECTED_NAME: 'other' },
    { VERCEL_ENV: 'preview' },
  ])
    assert.throws(
      () => readReviewDatabaseConfiguration({ ...env, ...patch }),
      (error) => error.code === 'not_configured' && !error.message.includes('synthetic-password'),
    );
});
