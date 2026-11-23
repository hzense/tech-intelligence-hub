import type { PoolClient } from 'pg';

export interface SignalGenerationStats {
  tasks: number;
  completed: number;
  failed: number;
  candidates: number;
  todayCandidates: number;
  publication: { pending: number; published: number; withdrawn: number } | null;
}

type ReadPool = { connect(): Promise<Pick<PoolClient, 'query' | 'release'>> };

async function readRow<T extends Record<string, unknown>>(
  pool: ReadPool,
  sql: string,
  values: unknown[],
) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<T>(sql, values);
    client.release();
    return rows[0];
  } catch (error) {
    client.release(true);
    throw error;
  }
}

// The two existing roles can read different tables. Only accepted candidate
// identities travel between the two reads, never source documents or results.
const generated = `
  WITH runs AS MATERIALIZED (
    SELECT id, status, finished_at, CASE WHEN status = 'completed'
      AND result->>'classification' = 'private'
      AND jsonb_typeof(result->'candidates') = 'array'
      THEN ARRAY(
        SELECT DISTINCT (c->'index')::int
        FROM jsonb_array_elements(result->'candidates') AS c
        WHERE c->>'classification' = 'private' AND c->>'status' = 'needs_review'
          AND c->'index' IN ('0'::jsonb,'1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb)
      ) ELSE '{}'::int[] END AS indexes
    FROM public.signal_generation_runs
    WHERE owner_id = $1 AND deleted_at IS NULL
  )
  SELECT count(*)::int AS tasks,
    (count(*) FILTER (WHERE status = 'completed'))::int AS completed,
    (count(*) FILTER (WHERE status = 'failed'))::int AS failed,
    coalesce(sum(cardinality(indexes)), 0)::int AS candidates,
    coalesce(sum(cardinality(indexes)) FILTER (WHERE
      (finished_at AT TIME ZONE 'Europe/Berlin')::date =
      (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date), 0)::int AS "todayCandidates",
    (jsonb_object_agg(id, indexes) FILTER (WHERE cardinality(indexes) > 0))::text AS identities
  FROM runs`;

const publication = `
  WITH accepted AS (
    SELECT g.id, idx::int AS candidate_index
    FROM jsonb_each($2::jsonb) AS batch(id, indexes)
    JOIN public.signal_generation_runs g ON g.id = batch.id::uuid
      AND g.owner_id = $1 AND g.status = 'completed' AND g.deleted_at IS NULL
    CROSS JOIN LATERAL jsonb_array_elements_text(batch.indexes) AS idx
  )
  SELECT count(*)::int AS matched,
    (count(*) FILTER (WHERE latest.action = 'publish'))::int AS published,
    (count(*) FILTER (WHERE latest.action = 'withdraw'))::int AS withdrawn,
    (count(*) FILTER (WHERE latest.action IS NULL OR latest.action = 'draft'))::int AS pending
  FROM accepted a
  LEFT JOIN LATERAL (
    SELECT r.action FROM public.editorial_signal_revisions r
    WHERE r.owner_id = $1 AND r.run_id = a.id AND r.candidate_index = a.candidate_index
    ORDER BY r.revision DESC LIMIT 1
  ) AS latest ON true`;

export async function readSignalGenerationStats(
  owner: string,
  generationPool: ReadPool,
  editorialPool: ReadPool,
): Promise<SignalGenerationStats | null> {
  type GenerationRow = Omit<SignalGenerationStats, 'publication'> & { identities: string | null };
  const row = await readRow<GenerationRow>(generationPool, generated, [owner]).catch(() => null);
  if (!row) return null;
  const { identities, ...stats } = row;
  if (stats.candidates === 0)
    return { ...stats, publication: { pending: 0, published: 0, withdrawn: 0 } };

  type PublicationRow = NonNullable<SignalGenerationStats['publication']> & { matched: number };
  const counts = await readRow<PublicationRow>(editorialPool, publication, [
    owner,
    identities,
  ]).catch(() => null);
  // If a task was removed between the reads, do not classify it as pending.
  if (!counts || counts.matched !== stats.candidates) return { ...stats, publication: null };
  const { pending, published, withdrawn } = counts;
  return { ...stats, publication: { pending, published, withdrawn } };
}
