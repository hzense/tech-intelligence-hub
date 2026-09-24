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
import { registeredMaterialForCandidate } from './material-registration';
import { materialPlanCandidate } from '../material-registration-binding';
import {
  materialPlanHash,
  type MaterialPlan,
} from '../../../../packages/database/src/material-registration-contract.mjs';

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
  registered: MaterialPlan | null = null,
) {
  const candidate = registered ? materialPlanCandidate(registered) : packet.candidate;
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
             lower(btrim(normalize(e.name,NFKC)))=ANY($1::text[]) OR
             EXISTS(SELECT 1 FROM unnest(e.aliases) alias WHERE lower(btrim(normalize(alias,NFKC)))=ANY($1::text[]))
           ) ORDER BY e.id`,
          [names],
        )
      ).rows
    : [];
  // One pg client runs queries serially. Do not overlap queries inside this transaction.
  const profiles = await client.query(
    `SELECT p.entity_id,'person'::text AS kind FROM public.person_profiles p WHERE p.entity_id=ANY($1::text[])
       UNION ALL
       SELECT o.entity_id,'organization'::text AS kind FROM public.organization_profiles o WHERE o.entity_id=ANY($1::text[])`,
    [entities.map((row) => row.id)],
  );
  const topics = await client.query(
    "SELECT id,title AS name FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY id LIMIT 200",
  );
  const evidence = quotes.length
    ? await client.query(
        `SELECT e.id,e.source_url,e.excerpt,s.allowed_hosts FROM public.public_source_evidence e
           JOIN public.sources s ON s.id=e.source_id
           WHERE e.verification_status='verified' AND s.active IS TRUE
             AND EXISTS(SELECT 1 FROM unnest($1::text[]) quote WHERE strpos(e.excerpt,quote)>0)
           ORDER BY e.id LIMIT 500`,
        [quotes],
      )
    : { rows: [] };
  // Never let a truncated evidence catalog turn an ambiguous match into a unique one.
  if (evidence.rows.length >= 500) throw new CandidateReviewError('review_incomplete');
  const kinds = new Map<string, Set<string>>();
  for (const row of profiles.rows) {
    const current = kinds.get(row.entity_id) ?? new Set<string>();
    current.add(row.kind);
    kinds.set(row.entity_id, current);
  }
  const result = prepareCandidateReview(
    candidate,
    {
      people: entities.filter((row) => kinds.get(row.id)?.has('person')),
      organizations: entities.filter((row) => kinds.get(row.id)?.has('organization')),
      topics: topics.rows,
      evidence: registered
        ? evidence.rows.filter((row) =>
            registered.evidence.some(
              (item) =>
                item.id === row.id &&
                item.excerpt === row.excerpt &&
                item.sourceUrl === row.source_url,
            ),
          )
        : evidence.rows,
    },
    registered
      ? { topicIds: registered.topicIds, planHash: materialPlanHash(registered) }
      : undefined,
  );
  if (registered && result.ready) {
    const same = (a: string[], b: string[]) =>
      JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
    if (
      !same(
        result.draft.personIds,
        registered.candidate.persons.map((p) => p.entityId),
      ) ||
      !same(result.draft.organizationIds, [
        ...registered.candidate.organizationIds,
        ...registered.candidate.persons.flatMap((p) =>
          p.organizationId ? [p.organizationId] : [],
        ),
      ]) ||
      result.draft.claims.some(
        (claim, index) => claim.evidenceId !== registered.candidate.claims[index]?.evidenceId,
      )
    )
      throw new CandidateReviewError('material_changed');
  }
  return result;
}

async function currentReviewPacket(owner: string, runId: string, candidateIndex: number) {
  const run = await generationRecord(owner, runId);
  const original = buildCandidateReview(run, candidateIndex);
  // A failed read is not proof that no newer proposal exists.
  const enrichments = await listCandidateEnrichmentDtos(owner, runId, candidateIndex);
  const registered = await registeredMaterialForCandidate(
    owner,
    runId,
    candidateIndex,
    original.materialHash,
  );
  if (registered)
    return {
      packet: original,
      originalMaterialHash: original.materialHash,
      enrichments,
      registered,
    };
  const completed = enrichments.find(
    (item) => item.status === 'completed' && item.material_hash === original.materialHash,
  );
  if (!completed)
    return {
      packet: original,
      originalMaterialHash: original.materialHash,
      enrichments,
      registered: null,
    };
  if (!completed.result?.candidate) throw new CandidateReviewError('material_changed');
  try {
    const proposed = completed.result.candidate as Record<string, unknown>;
    return {
      packet: buildEnrichedCandidateReview(run, candidateIndex, proposed),
      originalMaterialHash: original.materialHash,
      enrichments,
      registered: null,
    };
  } catch {
    throw new CandidateReviewError('material_changed');
  }
}
export async function reviewDashboard(owner: string, runId: string, candidateIndex: number) {
  // Authenticate ownership even when review persistence has not been enabled yet.
  const { packet, originalMaterialHash, enrichments, registered } = await currentReviewPacket(
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
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const preparation = await prepareReview(client, packet, registered);
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
  const keys = [
    'candidateIndex',
    'expectedReviewRevision',
    'materialHash',
    'preparationHash',
    'requestKey',
    'runId',
  ];
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
    typeof request.preparationHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.preparationHash) ||
    typeof request.requestKey !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.requestKey)
  )
    throw new CandidateReviewError('invalid_request');
  return request as {
    runId: string;
    candidateIndex: number;
    expectedReviewRevision: number;
    materialHash: string;
    preparationHash: string;
    requestKey: string;
  };
}
export async function confirmPreparedReview(owner: string, value: unknown) {
  requireReviewWrites();
  const request = confirmation(value);
  const { packet, registered } = await currentReviewPacket(
    owner,
    request.runId,
    request.candidateIndex,
  );
  if (packet.materialHash !== request.materialHash)
    throw new CandidateReviewError('material_changed');
  const client = await candidateReviewPool.connect();
  let preparation;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    preparation = await prepareReview(client, packet, registered);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (!preparation.ready) throw new CandidateReviewError('review_incomplete');
  if (preparation.preparationHash !== request.preparationHash)
    throw new CandidateReviewError('material_changed');
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
      note: `publication-materials-v1:${preparation.preparationHash}`,
      draft: preparation.draft,
    },
  });
}
