import 'server-only';
import pg from 'pg';
import {
  readCandidateReviews,
  saveCandidateReview,
  CandidateReviewError,
} from '../../../../packages/database/src/candidate-review-store.mjs';
import { assertCandidateReviewRole } from '../../../../packages/database/src/candidate-review-role.mjs';
import {
  readReviewDatabaseConfiguration,
  ReviewConfigurationError,
} from '../candidate-review-config';
import { generationRecord } from './signal-generation';
import { prepareCandidateReview, publicPreparation } from '../candidate-review-preparation';
import { buildCandidateReview, buildEnrichedCandidateReview } from '../candidate-review';
import { listCandidateEnrichmentDtos } from './candidate-enrichment';

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
async function prepareReview(
  client: pg.PoolClient,
  packet: ReturnType<typeof buildCandidateReview>,
) {
  const candidate = packet.candidate;
  const names = [
    ...candidate.persons.map((person) => person.name),
    ...candidate.organizations,
    ...candidate.persons.flatMap((person) => (person.organization ? [person.organization] : [])),
  ].map((name) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US'));
  const quotes = [
    ...new Set(candidate.claims.flatMap((claim) => claim.evidence.map((row) => row.quote.trim()))),
  ];
  const entities = names.length
    ? (
        await client.query(
          `SELECT e.id,e.name,e.aliases,e.type FROM public.entities e
           WHERE e.status='active' AND (
             lower(btrim(e.name))=ANY($1::text[]) OR
             EXISTS(SELECT 1 FROM unnest(e.aliases) alias WHERE lower(btrim(alias))=ANY($1::text[]))
           ) ORDER BY e.id`,
          [names],
        )
      ).rows
    : [];
  const [profiles, topics, evidence] = await Promise.all([
    client.query(
      `SELECT p.entity_id,'person'::text AS kind FROM public.person_profiles p WHERE p.entity_id=ANY($1::text[])
       UNION ALL
       SELECT o.entity_id,'organization'::text AS kind FROM public.organization_profiles o WHERE o.entity_id=ANY($1::text[])`,
      [entities.map((row) => row.id)],
    ),
    client.query(
      "SELECT id,title AS name FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY id LIMIT 200",
    ),
    quotes.length
      ? client.query(
          `SELECT e.id,e.source_url,e.excerpt FROM public.public_source_evidence e
           JOIN public.sources s ON s.id=e.source_id
           WHERE e.verification_status='verified' AND s.active IS TRUE
             AND EXISTS(SELECT 1 FROM unnest($1::text[]) quote WHERE strpos(e.excerpt,quote)>0)
           ORDER BY e.id LIMIT 500`,
          [quotes],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const kinds = new Map<string, Set<string>>();
  for (const row of profiles.rows) {
    const current = kinds.get(row.entity_id) ?? new Set<string>();
    current.add(row.kind);
    kinds.set(row.entity_id, current);
  }
  return prepareCandidateReview(candidate, {
    people: entities.filter((row) => kinds.get(row.id)?.has('person')),
    organizations: entities.filter((row) => kinds.get(row.id)?.has('organization')),
    topics: topics.rows,
    evidence: evidence.rows,
  });
}

async function currentReviewPacket(owner: string, runId: string, candidateIndex: number) {
  const run = await generationRecord(owner, runId);
  const original = buildCandidateReview(run, candidateIndex);
  const enrichments = await listCandidateEnrichmentDtos(owner, runId, candidateIndex).catch(
    () => [],
  );
  const completed = enrichments.find(
    (item) =>
      item.status === 'completed' && item.material_hash === original.materialHash && item.result,
  );
  if (!completed?.result?.candidate)
    return { packet: original, originalMaterialHash: original.materialHash, enrichments };
  try {
    const proposed = completed.result.candidate as Record<string, unknown>;
    return {
      packet: buildEnrichedCandidateReview(run, candidateIndex, proposed),
      originalMaterialHash: original.materialHash,
      enrichments,
    };
  } catch {
    return { packet: original, originalMaterialHash: original.materialHash, enrichments };
  }
}
export async function reviewDashboard(owner: string, runId: string, candidateIndex: number) {
  // Authenticate ownership even when review persistence has not been enabled yet.
  const { packet, originalMaterialHash, enrichments } = await currentReviewPacket(
    owner,
    runId,
    candidateIndex,
  );
  if (!reviewConfigured())
    return {
      configured: false,
      reviews: [],
      material_hash: packet.materialHash,
      original_material_hash: originalMaterialHash,
      enrichments,
      preparation: { ready: false, blockers: ['审核与发布存储尚未配置。'] },
    };
  const reviews = await readCandidateReviews({
    pool: candidateReviewPool,
    owner,
    runId,
    candidateIndex,
  });
  const client = await candidateReviewPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const preparation = await prepareReview(client, packet);
    await client.query('COMMIT');
    return {
      configured: process.env.HZENSE_REVIEW_ENABLED === '1',
      reviews,
      material_hash: packet.materialHash,
      original_material_hash: originalMaterialHash,
      enrichments,
      preparation: publicPreparation(preparation),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function confirmation(value: unknown) {
  const keys = ['candidateIndex', 'expectedReviewRevision', 'materialHash', 'requestKey', 'runId'];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
  )
    throw new CandidateReviewError('invalid_request');
  const request = value as Record<string, unknown>;
  if (
    typeof request.runId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.runId) ||
    !Number.isInteger(request.candidateIndex) ||
    Number(request.candidateIndex) < 0 ||
    Number(request.candidateIndex) > 4 ||
    !Number.isSafeInteger(request.expectedReviewRevision) ||
    Number(request.expectedReviewRevision) < 0 ||
    typeof request.materialHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.materialHash) ||
    typeof request.requestKey !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.requestKey)
  )
    throw new CandidateReviewError('invalid_request');
  return request as {
    runId: string;
    candidateIndex: number;
    expectedReviewRevision: number;
    materialHash: string;
    requestKey: string;
  };
}
export async function confirmPreparedReview(owner: string, value: unknown) {
  requireReviewWrites();
  const request = confirmation(value);
  const { packet } = await currentReviewPacket(owner, request.runId, request.candidateIndex);
  if (packet.materialHash !== request.materialHash)
    throw new CandidateReviewError('material_changed');
  const client = await candidateReviewPool.connect();
  let preparation;
  try {
    await client.query('BEGIN READ ONLY');
    preparation = await prepareReview(client, packet);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (!preparation.ready) throw new CandidateReviewError('review_incomplete');
  return saveCandidateReview({
    pool: candidateReviewPool,
    owner,
    materialHash: packet.materialHash,
    request: {
      requestId: request.requestKey,
      runId: request.runId,
      candidateIndex: request.candidateIndex,
      materialHash: request.materialHash,
      expectedRevision: request.expectedReviewRevision,
      decision: 'submit_verification',
      note: '',
      draft: preparation.draft,
    },
  });
}
