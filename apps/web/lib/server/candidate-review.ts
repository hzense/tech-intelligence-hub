import 'server-only';
import pg from 'pg';
import {
  readCandidateReviews,
  saveCandidateReview,
  type CandidateReviewRequest,
} from '../../../../packages/database/src/candidate-review-store.mjs';
import { assertCandidateReviewRole } from '../../../../packages/database/src/candidate-review-role.mjs';
import {
  readReviewDatabaseConfiguration,
  ReviewConfigurationError,
} from '../candidate-review-config';
import { candidateReviewDetail } from './signal-generation';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
export const candidateReviewPool = {
  async connect() {
    const connectionString = readReviewDatabaseConfiguration(process.env);
    if (poolUrl && connectionString !== poolUrl) throw new ReviewConfigurationError();
    if (!pool) {
      poolUrl = connectionString;
      pool = new pg.Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 15000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-candidate-review',
      });
      pool.on('error', () => console.error('candidate_review_pool_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertCandidateReviewRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
export function reviewConfigured() {
  try {
    readReviewDatabaseConfiguration(process.env);
    return true;
  } catch {
    return false;
  }
}
export function requireReviewWrites() {
  if (process.env.HZENSE_REVIEW_ENABLED !== '1') throw new ReviewConfigurationError();
}
export async function reviewDashboard(owner: string, runId: string, candidateIndex: number) {
  // Authenticate ownership even when review persistence has not been enabled yet.
  await candidateReviewDetail(owner, runId, candidateIndex);
  if (!reviewConfigured()) return { configured: false, reviews: [] };
  const reviews = await readCandidateReviews({
    pool: candidateReviewPool,
    owner,
    runId,
    candidateIndex,
  });
  const client = await candidateReviewPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const people = (
      await client.query(
        "SELECT e.id,e.name FROM public.entities e JOIN public.person_profiles p ON p.entity_id=e.id WHERE e.type='person' AND e.status='active' ORDER BY e.id LIMIT 200",
      )
    ).rows;
    const organizations = (
      await client.query(
        "SELECT e.id,e.name FROM public.entities e JOIN public.organization_profiles p ON p.entity_id=e.id AND p.entity_type=e.type WHERE e.type IN ('company','institution') AND e.status='active' ORDER BY e.id LIMIT 200",
      )
    ).rows;
    const topics = (
      await client.query(
        "SELECT id,title AS name FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY id LIMIT 200",
      )
    ).rows;
    const evidence = (
      await client.query(
        "SELECT e.id,e.source_url,e.excerpt FROM public.public_source_evidence e JOIN public.sources s ON s.id=e.source_id WHERE e.verification_status='verified' AND s.active IS TRUE ORDER BY e.id LIMIT 200",
      )
    ).rows;
    await client.query('COMMIT');
    return {
      configured: process.env.HZENSE_REVIEW_ENABLED === '1',
      reviews,
      catalog: { people, organizations, topics, evidence },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function saveReview(owner: string, value: unknown) {
  requireReviewWrites();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error(), { code: 'invalid_request' });
  const request = value as CandidateReviewRequest;
  const packet = await candidateReviewDetail(owner, request.runId, request.candidateIndex);
  return saveCandidateReview({
    pool: candidateReviewPool,
    owner,
    request,
    materialHash: packet.materialHash,
  });
}
