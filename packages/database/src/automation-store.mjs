import { randomUUID } from 'node:crypto';
import { automationConfigDeletionAvailable } from './automation-role.mjs';
import {
  AutomationError,
  automationFail as fail,
  automationUuid,
  automationText,
  automationExact,
  normalizeAutomationConfig,
  automationSlot,
  nextAutomationTime,
  automationStableId,
} from './automation-contract.mjs';
export { AutomationError } from './automation-contract.mjs';
const configColumns = 'id,owner_id,revision,config,enabled,next_run_at,created_at,updated_at';
async function configShape(client) {
  const canDelete = await automationConfigDeletionAvailable(client);
  return {
    canDelete,
    columns: canDelete ? `${configColumns},deleted_at` : configColumns,
    active: canDelete ? ' AND deleted_at IS NULL' : '',
  };
}
const runColumns =
  'id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,frozen_inputs,error_code,lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,cost_source,publication_status,published_at,created_at,started_at,finished_at';
// Dashboard polling must not transfer worker snapshots or complete report/source
// results. Project small public metadata in PostgreSQL, before network transfer.
const publicRunColumns = `id,status,phase,error_code,created_at,finished_at,
  charged_microusd,cost_source,publication_status,
  jsonb_build_object('name',snapshot->'name','kind',snapshot->'kind',
    'publicationMode',CASE WHEN snapshot->>'publicationMode'='automatic'
      AND snapshot->>'kind'='source_collection' THEN 'automatic' ELSE 'manual' END) AS snapshot`;
const runSummaryResult = `CASE WHEN result IS NULL THEN NULL ELSE jsonb_build_object(
  'generationIds',COALESCE((
    SELECT jsonb_agg(ids.value ORDER BY ids.first_seen) FROM (
      SELECT value,min(ordinality) AS first_seen
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result->'generationIds')='array'
        THEN result->'generationIds' ELSE '[]'::jsonb END) WITH ORDINALITY
      WHERE jsonb_typeof(value)='string'
        AND value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY value ORDER BY first_seen LIMIT 8
    ) ids
  ),'[]'::jsonb),
  'failed',CASE WHEN jsonb_typeof(result->'failed')='number' THEN result->'failed' ELSE NULL END,
  'discovery',CASE WHEN jsonb_typeof(result->'discovery')='object' THEN jsonb_build_object(
    'articleCount',CASE WHEN jsonb_typeof(result->'discovery'->'articles')='array'
      THEN jsonb_array_length(result->'discovery'->'articles') ELSE NULL END,
    'duplicates',CASE WHEN jsonb_typeof(result->'discovery'->'duplicates')='number'
      THEN result->'discovery'->'duplicates' ELSE NULL END,
    'rejected',CASE WHEN jsonb_typeof(result->'discovery'->'rejected')='number'
      THEN result->'discovery'->'rejected' ELSE NULL END
  ) ELSE NULL END
) END AS result`;
const publicRunDto = (row) => ({ ...row, charged_microusd: Number(row.charged_microusd) });
const dto = (row) =>
  row
    ? {
        ...row,
        config_snapshot: row.snapshot,
        reserved_microusd: Number(row.reserved_microusd),
        charged_microusd: Number(row.charged_microusd),
      }
    : null;
// A source run can have an unknown downstream import/dispatch outcome even when
// its one fenced discovery call has a settled provider receipt. That uncertainty
// must not reserve discovery money again; imports/generation have separate ledgers.
// Keep the conservative reservation for every live or financially unknown run.
// JSONB equality avoids unsafe casts and accepts only the exact integer charge.
const automationBudgetUsageSql = `SELECT COALESCE(sum(CASE
  WHEN status='unknown' AND phase='source_failed'
    AND snapshot->>'kind'='source_collection'
    AND jsonb_typeof(snapshot->'discovery')='object'
    AND lease_token IS NULL AND lease_until IS NULL AND finished_at IS NOT NULL
    AND cost_source='provider'
    AND result->>'discoveryCostSource'='provider'
    AND jsonb_typeof(result->'discoveryCostMicrousd')='number'
    AND charged_microusd>=0
    AND result->'discoveryCostMicrousd'=to_jsonb(charged_microusd)
  THEN charged_microusd
  WHEN status IN ('running','unknown')
  THEN greatest(reserved_microusd,charged_microusd)
  ELSE charged_microusd END),0) AS used
  FROM public.automation_runs
  WHERE budget_day=(clock_timestamp() AT TIME ZONE 'UTC')::date`;
async function transaction(pool, work) {
  let client,
    committing = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    if (error instanceof AutomationError) throw error;
    fail(committing ? 'commit_unknown' : 'database_unavailable');
  } finally {
    client?.release();
  }
}
const lock = (client, id) =>
  client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`automation:${id}`]);
export async function saveAutomationConfig({ pool, owner, request }) {
  owner = automationText(owner);
  automationExact(request, ['id', 'expectedRevision', 'config', 'consent']);
  const id = automationUuid(request.id),
    config = normalizeAutomationConfig(request.config);
  if (
    request.consent !== true ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0
  )
    fail();
  // Enabling a schedule never runs it immediately. The first slot is the next UTC day/week.
  const nextRun = config.enabled ? nextAutomationTime(config.frequency, new Date()) : null;
  return transaction(pool, async (client) => {
    await lock(client, `owner:${owner}`);
    await lock(client, id);
    const shape = await configShape(client);
    const existing = (
      await client.query(`SELECT ${shape.columns} FROM public.automation_configs WHERE id=$1`, [id])
    ).rows[0];
    if (existing && (existing.owner_id !== owner || existing.deleted_at)) fail('not_found');
    if ((existing?.revision ?? 0) !== request.expectedRevision) fail('revision_conflict');
    if (!existing) {
      const count = (
        await client.query(
          `SELECT count(*)::integer AS count FROM public.automation_configs WHERE owner_id=$1${shape.active}`,
          [owner],
        )
      ).rows[0].count;
      if (count >= 50) fail('config_limit');
      return (
        await client.query(
          `INSERT INTO public.automation_configs(id,owner_id,revision,config,enabled,next_run_at) VALUES($1,$2,1,$3::jsonb,$4,$5::timestamptz) RETURNING ${shape.columns}`,
          [id, owner, JSON.stringify(config), config.enabled, nextRun],
        )
      ).rows[0];
    }
    return (
      await client.query(
        `UPDATE public.automation_configs SET revision=revision+1,config=$3::jsonb,enabled=$4,next_run_at=$5::timestamptz,updated_at=clock_timestamp() WHERE id=$1 AND owner_id=$2${shape.active} RETURNING ${shape.columns}`,
        [id, owner, JSON.stringify(config), config.enabled, nextRun],
      )
    ).rows[0];
  });
}
export async function deleteAutomationConfig({ pool, owner, request }) {
  owner = automationText(owner);
  automationExact(request, ['id', 'expectedRevision', 'consent']);
  const id = automationUuid(request.id);
  if (
    request.consent !== true ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1
  )
    fail();
  return transaction(pool, async (client) => {
    await lock(client, `owner:${owner}`);
    await lock(client, id);
    const shape = await configShape(client);
    if (!shape.canDelete) fail('config_deletion_unavailable');
    const existing = (
      await client.query(
        `SELECT ${shape.columns} FROM public.automation_configs WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [id, owner],
      )
    ).rows[0];
    if (!existing) fail('not_found');
    if (existing.deleted_at) {
      if (existing.revision !== request.expectedRevision + 1) fail('revision_conflict');
      return { id: existing.id, revision: existing.revision, deleted_at: existing.deleted_at };
    }
    if (existing.revision !== request.expectedRevision) fail('revision_conflict');
    // Finished, lease-free unknown outcomes remain in history for reconciliation;
    // hiding their configuration must not rewrite their status, results or costs.
    // Unfinished unknowns and even malformed/stale leases still block deletion.
    // Enqueue and scheduler use the same config lock, so no new task can race this check.
    if (
      (
        await client.query(
          "SELECT 1 FROM public.automation_runs WHERE config_id=$1 AND (status IN ('queued','running') OR (status='unknown' AND finished_at IS NULL) OR lease_token IS NOT NULL OR lease_until IS NOT NULL) LIMIT 1",
          [id],
        )
      ).rows.length
    )
      fail('config_in_use');
    return (
      await client.query(
        "UPDATE public.automation_configs SET deleted_at=clock_timestamp(),enabled=false,config=jsonb_set(config,'{enabled}','false'::jsonb),next_run_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL RETURNING id,revision,deleted_at",
        [id, owner],
      )
    ).rows[0];
  });
}
export async function readAutomationDashboard({ pool, owner }) {
  owner = automationText(owner);
  return transaction(pool, async (client) => {
    const shape = await configShape(client);
    return {
      configDeletionAvailable: shape.canDelete,
      configs: (
        await client.query(
          `SELECT ${shape.columns} FROM public.automation_configs WHERE owner_id=$1${shape.active} ORDER BY created_at DESC LIMIT 50`,
          [owner],
        )
      ).rows,
      runs: (
        await client.query(
          `SELECT ${publicRunColumns},${runSummaryResult} FROM public.automation_runs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`,
          [owner],
        )
      ).rows.map(publicRunDto),
    };
  });
}
export async function readAutomationRunDetail({ pool, owner, id }) {
  owner = automationText(owner);
  id = automationUuid(id);
  return transaction(pool, async (client) => {
    const row = (
      await client.query(
        `SELECT ${publicRunColumns},result FROM public.automation_runs WHERE id=$1 AND owner_id=$2`,
        [id, owner],
      )
    ).rows[0];
    if (!row) fail('not_found');
    return publicRunDto(row);
  });
}
async function enqueue(client, config, { id, slot, trigger }) {
  const existing = (
    await client.query(
      `SELECT ${runColumns} FROM public.automation_runs WHERE id=$1 OR (config_id=$2 AND slot=$3)`,
      [id, config.id, slot],
    )
  ).rows[0];
  if (existing) {
    if (
      existing.owner_id !== config.owner_id ||
      existing.config_id !== config.id ||
      existing.slot !== slot
    )
      fail('request_id_conflict');
    return { run: dto(existing), created: false };
  }
  await client.query(
    "UPDATE public.automation_runs SET status='unknown',phase='outcome_unknown',error_code='outcome_unknown',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE config_id=$1 AND ((status='running' AND lease_until<clock_timestamp()) OR (status='queued' AND created_at<clock_timestamp()-interval '2 hours'))",
    [config.id],
  );
  if (
    (
      await client.query(
        "SELECT 1 FROM public.automation_runs WHERE config_id=$1 AND status IN ('queued','running') LIMIT 1",
        [config.id],
      )
    ).rows.length
  )
    fail('task_active');
  const run = (
    await client.query(
      `INSERT INTO public.automation_runs(id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,'queued','queued') RETURNING ${runColumns}`,
      [
        id,
        config.id,
        config.owner_id,
        config.revision,
        JSON.stringify(config.config),
        slot,
        trigger,
      ],
    )
  ).rows[0];
  return { run: dto(run), created: true };
}
export async function enqueueAutomation({ pool, owner, request, beforeEnqueue }) {
  owner = automationText(owner);
  automationExact(request, ['configId', 'expectedRevision', 'requestId', 'consent']);
  automationUuid(request.configId);
  automationUuid(request.requestId);
  if (
    request.consent !== true ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1
  )
    fail();
  if (beforeEnqueue !== undefined && typeof beforeEnqueue !== 'function') fail();
  return transaction(pool, async (client) => {
    await lock(client, request.configId);
    const shape = await configShape(client);
    const config = (
      await client.query(
        `SELECT ${shape.columns} FROM public.automation_configs WHERE id=$1 AND owner_id=$2${shape.active}`,
        [request.configId, owner],
      )
    ).rows[0];
    if (!config) fail('not_found');
    // A lost response can be replayed even after the configuration was edited.
    const old = (
      await client.query(`SELECT ${runColumns} FROM public.automation_runs WHERE id=$1`, [
        request.requestId,
      ])
    ).rows[0];
    if (old) {
      if (
        old.owner_id !== owner ||
        old.config_id !== config.id ||
        old.config_revision !== request.expectedRevision ||
        old.trigger !== 'manual'
      )
        fail('request_id_conflict');
      return { run: dto(old), created: false };
    }
    if (config.revision !== request.expectedRevision) fail('revision_conflict');
    // Server-owned admission only, after an existing request has been replayed.
    // Configuration/readiness changes must not change old request semantics.
    if (beforeEnqueue) await beforeEnqueue(normalizeAutomationConfig(config.config));
    return enqueue(client, config, {
      id: request.requestId,
      slot: `manual:${request.requestId}`,
      trigger: 'manual',
    });
  });
}
export async function enqueueDueAutomations({
  pool,
  limit = 5,
  kinds,
  allowAutomaticPublication = false,
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) fail();
  if (typeof allowAutomaticPublication !== 'boolean') fail();
  if (
    kinds !== undefined &&
    (!Array.isArray(kinds) ||
      kinds.length > 2 ||
      new Set(kinds).size !== kinds.length ||
      Array.from(kinds).some((kind) => !['source_collection', 'topic_insight'].includes(kind)))
  )
    fail();
  // Missing service dependencies leave due schedules untouched. Filter before
  // LIMIT as well as under the per-config lock, so one kind cannot starve another.
  if (kinds?.length === 0) return [];
  const allowedKinds = kinds === undefined ? undefined : [...kinds];
  const kindFilter = allowedKinds ? " AND config->>'kind'=ANY($2::text[])" : '';
  // Do not enqueue or advance an automatic schedule while its publication
  // capability is off. Apply before LIMIT and again under the config lock.
  const publicationFilter = allowAutomaticPublication
    ? ''
    : " AND config->>'publicationMode' IS DISTINCT FROM 'automatic'";
  return transaction(pool, async (client) => {
    await lock(client, 'scheduler');
    const shape = await configShape(client);
    const configs = (
      await client.query(
        `SELECT ${shape.columns} FROM public.automation_configs WHERE enabled AND next_run_at<=clock_timestamp()${shape.active}${kindFilter}${publicationFilter} ORDER BY next_run_at,id LIMIT $1`,
        allowedKinds ? [limit, allowedKinds] : [limit],
      )
    ).rows;
    const result = [];
    for (const candidate of configs) {
      await lock(client, candidate.id);
      const config = (
        await client.query(
          `SELECT ${shape.columns} FROM public.automation_configs WHERE id=$1 AND enabled AND next_run_at<=clock_timestamp()${shape.active}${kindFilter}${publicationFilter} FOR UPDATE`,
          allowedKinds ? [candidate.id, allowedKinds] : [candidate.id],
        )
      ).rows[0];
      if (!config) continue;
      const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const frequency = normalizeAutomationConfig(config.config).frequency;
      if (frequency === 'manual') continue;
      const slot = automationSlot(frequency, now),
        id = automationStableId({ configId: config.id, slot });
      // The row lock serializes scheduler replicas; manual runs share advisory locking.
      try {
        result.push(await enqueue(client, config, { id, slot, trigger: 'scheduled' }));
      } catch (error) {
        if (error.code !== 'task_active') throw error;
      }
      await client.query('UPDATE public.automation_configs SET next_run_at=$2 WHERE id=$1', [
        config.id,
        nextAutomationTime(frequency, now),
      ]);
    }
    return result;
  });
}
export async function claimAutomationRun({ pool, owner, id, limits }) {
  owner = automationText(owner);
  automationUuid(id);
  return transaction(pool, async (client) => {
    await lock(client, 'budget-global');
    const run = (
      await client.query(
        `SELECT ${runColumns} FROM public.automation_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [id, owner],
      )
    ).rows[0];
    if (!run) fail('not_found');
    if (run.status !== 'queued') return null;
    const shape = await configShape(client);
    const config = (
      await client.query(
        `SELECT revision,enabled FROM public.automation_configs WHERE id=$1 AND owner_id=$2${shape.active}`,
        [run.config_id, owner],
      )
    ).rows[0];
    if (
      !config ||
      (run.trigger === 'scheduled' && (!config.enabled || config.revision !== run.config_revision))
    ) {
      await client.query(
        "UPDATE public.automation_runs SET status='cancelled',phase='configuration_changed',finished_at=clock_timestamp() WHERE id=$1",
        [id],
      );
      return null;
    }
    let reserve = 0;
    if (run.snapshot.kind === 'topic_insight' || run.snapshot.discovery) {
      if (
        !limits ||
        ['batch', 'daily', 'reserve'].some(
          (key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > 50000000,
        ) ||
        limits.batch > limits.daily ||
        limits.reserve > limits.batch
      ) {
        await client.query(
          "UPDATE public.automation_runs SET status='failed',phase='not_configured',error_code='not_configured',finished_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND status='queued'",
          [id, owner],
        );
        return null;
      }
      const usage = Number((await client.query(automationBudgetUsageSql)).rows[0].used);
      if (usage + limits.reserve > limits.daily) {
        await client.query(
          "UPDATE public.automation_runs SET status='failed',phase='budget_exceeded',error_code='budget_exceeded',finished_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND status='queued'",
          [id, owner],
        );
        return null;
      }
      reserve = limits.reserve;
    }
    return dto(
      (
        await client.query(
          `UPDATE public.automation_runs SET status='running',phase='preparing',lease_token=$2,lease_until=clock_timestamp()+interval '2 hours',started_at=clock_timestamp(),budget_day=(clock_timestamp() AT TIME ZONE 'UTC')::date,reserved_microusd=$3 WHERE id=$1 RETURNING ${runColumns}`,
          [id, randomUUID(), reserve],
        )
      ).rows[0],
    );
  });
}
export async function readAutomationRun({ pool, owner, id }) {
  automationText(owner);
  automationUuid(id);
  return transaction(pool, async (client) => {
    const row = (
      await client.query(
        `SELECT ${runColumns} FROM public.automation_runs WHERE id=$1 AND owner_id=$2`,
        [id, owner],
      )
    ).rows[0];
    if (!row) fail('not_found');
    return dto(row);
  });
}
/** Atomic one-way paid-call fence, including duplicate workflow starts/replays. */
export async function beginSourceDiscovery({ pool, owner, id, token }) {
  automationText(owner);
  automationUuid(id);
  automationUuid(token);
  return transaction(pool, async (client) => {
    const row = (
      await client.query(
        "UPDATE public.automation_runs SET phase='discovering' WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND status='running' AND phase='preparing' AND lease_until>clock_timestamp() AND snapshot->>'kind'='source_collection' AND snapshot ? 'discovery' RETURNING id",
        [id, owner, token],
      )
    ).rows[0];
    if (!row) fail('stale_attempt');
  });
}
/** A queued fallback covers both its actual source and the original event URL.
 * Failed/discovered-only sources remain retryable; only valid generation receipts count. */
export async function readCollectedSourceUrls({ pool, owner }) {
  automationText(owner);
  return transaction(pool, async (client) => {
    const rows = (
      await client.query(
        `SELECT DISTINCT source.value #>> '{}' AS url
         FROM public.automation_runs
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(result->'queuedSources')='array'
             THEN result->'queuedSources' ELSE '[]'::jsonb END
         ) AS entry
         CROSS JOIN LATERAL (VALUES (entry->'url'),(entry->'originalUrl')) AS source(value)
         WHERE owner_id=$1 AND snapshot->>'kind'='source_collection'
           AND jsonb_typeof(entry->'generationId')='string'
           AND entry->>'generationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND jsonb_typeof(source.value)='string'
           AND length(btrim(source.value #>> '{}')) BETWEEN 1 AND 2048
         ORDER BY url`,
        [owner],
      )
    ).rows;
    return rows.map((row) => row.url);
  });
}
export async function updateAutomationRun({
  pool,
  owner,
  id,
  token,
  phase,
  result,
  status = 'running',
  errorCode = null,
  costMicrousd,
  costSource,
}) {
  automationText(owner);
  automationUuid(id);
  automationUuid(token);
  automationText(phase, 60);
  if (
    !['running', 'completed', 'failed', 'unknown', 'cancelled'].includes(status) ||
    (errorCode !== null && !/^[a-z][a-z0-9_]{0,79}$/.test(errorCode))
  )
    fail();
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    JSON.stringify(result).length > 100000
  )
    fail();
  if (
    costMicrousd !== undefined &&
    (!Number.isSafeInteger(costMicrousd) || costMicrousd < 0 || costMicrousd > 50000000)
  )
    fail();
  if (costSource !== undefined && !['provider', 'estimate', 'reserve'].includes(costSource)) fail();
  return transaction(pool, async (client) => {
    const previous = (
      await client.query(
        "SELECT snapshot,frozen_inputs FROM public.automation_runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND status='running' FOR UPDATE",
        [id, owner, token],
      )
    ).rows[0];
    if (!previous) fail('stale_attempt');
    if (
      status === 'completed' &&
      previous.snapshot.kind === 'topic_insight' &&
      (!previous.frozen_inputs ||
        JSON.stringify(previous.frozen_inputs.inputs) !== JSON.stringify(result.inputs))
    )
      fail('inputs_mismatch');
    const row = (
      await client.query(
        `UPDATE public.automation_runs SET phase=$4,result=$5::jsonb,status=$6,error_code=$7,charged_microusd=CASE WHEN $6='running' THEN charged_microusd ELSE COALESCE($8,reserved_microusd) END,cost_source=CASE WHEN $6='running' THEN cost_source ELSE COALESCE($9,'reserve') END,finished_at=CASE WHEN $6='running' THEN NULL ELSE clock_timestamp() END,lease_token=CASE WHEN $6='running' THEN lease_token ELSE NULL END,lease_until=CASE WHEN $6='running' THEN lease_until ELSE NULL END WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND status='running' AND lease_until>clock_timestamp() RETURNING ${runColumns}`,
        [
          id,
          owner,
          token,
          phase,
          JSON.stringify(result),
          status,
          errorCode,
          costMicrousd ?? null,
          costSource ?? null,
        ],
      )
    ).rows[0];
    if (!row) fail('stale_attempt');
    return dto(row);
  });
}
export async function freezeAutomationInputs({ pool, owner, id, token, snapshot }) {
  automationText(owner);
  automationUuid(id);
  automationUuid(token);
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.inputs) ||
    !snapshot.inputs.length ||
    JSON.stringify(snapshot).length > 1000000
  )
    fail();
  return transaction(pool, async (client) => {
    const row = (
      await client.query(
        `UPDATE public.automation_runs SET frozen_inputs=$4::jsonb,phase='analyzing' WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND status='running' AND lease_until>clock_timestamp() AND snapshot->>'kind'='topic_insight' AND (frozen_inputs IS NULL OR frozen_inputs=$4::jsonb) RETURNING id`,
        [id, owner, token, JSON.stringify(snapshot)],
      )
    ).rows[0];
    if (!row) fail('stale_attempt');
  });
}
export async function publishAutomationInsight({ pool, owner, id, confirm }) {
  automationText(owner);
  automationUuid(id);
  if (typeof confirm !== 'boolean') fail();
  return transaction(pool, async (client) => {
    const row = (
      await client.query(
        `UPDATE public.automation_runs SET publication_status=$3,published_at=CASE WHEN $3='published' THEN COALESCE(published_at,clock_timestamp()) ELSE published_at END WHERE id=$1 AND owner_id=$2 AND status='completed' AND snapshot->>'kind'='topic_insight' AND result->>'kind'='topic_insight' RETURNING ${runColumns}`,
        [id, owner, confirm ? 'published' : 'withdrawn'],
      )
    ).rows[0];
    if (!row) fail('not_found');
    return dto(row);
  });
}
export async function failAutomationDispatch({ pool, owner, id }) {
  automationText(owner);
  automationUuid(id);
  return transaction(pool, (client) =>
    client.query(
      "UPDATE public.automation_runs SET status='unknown',phase='dispatch_unknown',error_code='dispatch_unknown',finished_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND status='queued'",
      [id, owner],
    ),
  );
}
/** A known capability refusal before claim is not an unknown paid outcome. */
export async function rejectAutomaticPublicationBeforeClaim({ pool, owner, id }) {
  owner = automationText(owner);
  automationUuid(id);
  return transaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE public.automation_runs SET status='failed',
        phase='automatic_publication_unavailable',error_code='automatic_publication_unavailable',
        finished_at=clock_timestamp()
      WHERE id=$1 AND owner_id=$2 AND status='queued' AND phase='queued'
        AND snapshot->>'kind'='source_collection' AND snapshot->>'publicationMode'='automatic'
        AND started_at IS NULL AND finished_at IS NULL
        AND lease_token IS NULL AND lease_until IS NULL
        AND budget_day IS NULL AND reserved_microusd=0 AND charged_microusd=0 AND cost_source IS NULL
        AND result IS NULL AND frozen_inputs IS NULL
        AND publication_status='private' AND published_at IS NULL
      RETURNING id`,
      [id, owner],
    );
    return result.rows.length === 1;
  });
}
