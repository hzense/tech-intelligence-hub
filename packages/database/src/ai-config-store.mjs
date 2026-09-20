import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import {
  AiConfigError,
  aiFail,
  aiObject,
  aiUuid,
  aiModelId,
  aiInteger,
  parseAiConnectionCreate,
  parseAiConnectionUpdate,
  parseAiProbeRequest,
  parseAiProfileSave,
  validateAiBaseUrl,
} from './ai-config-contract.mjs';
import { encryptAiKey, decryptAiKey } from './ai-config-crypto.mjs';

const connectionColumns =
  'id,revision,name,protocol,base_url,enabled,settings,encrypted_key,created_at,updated_at';
const profileColumns = 'id,revision,name,stages,created_at,updated_at';
const probeColumns = `id,connection_id,connection_revision,kind,model_id,fingerprint,status,configuration,
 reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,created_at,finished_at`;
const iso = (value) => (value === null ? null : new Date(value).toISOString());
const one = (result) => {
  if (result.rows.length !== 1) aiFail('not_found');
  return result.rows[0];
};
function safeError(error) {
  return error instanceof AiConfigError ? error : new AiConfigError('database_unavailable');
}
async function transaction(pool, operation, { commitErrorCode = 'database_unavailable' } = {}) {
  let client;
  let started = false;
  let committing = false;
  let discard;
  try {
    if (!pool || typeof pool.connect !== 'function') aiFail('database_unavailable');
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    started = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result = await operation(client);
    committing = true;
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    discard = error;
    if (started) await client?.query('ROLLBACK').catch(() => undefined);
    throw committing ? new AiConfigError(commitErrorCode) : safeError(error);
  } finally {
    client?.release(discard);
  }
}
function connectionDto(row) {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    protocol: row.protocol,
    base_url: row.base_url,
    enabled: row.enabled,
    settings: row.settings,
    has_key: row.encrypted_key != null,
    key_mask: row.encrypted_key != null ? '••••••••' : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
function connectionSnapshotDto(row) {
  return connectionDto({ ...row, encrypted_key: row.has_key ? {} : null });
}
function profileDto(row, readiness) {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    stages: row.stages,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    ...(readiness ? { readiness } : {}),
  };
}
function probeDto(row) {
  return {
    id: row.id,
    connection_id: row.connection_id,
    connection_revision: row.connection_revision,
    kind: row.kind,
    model_id: row.model_id,
    status: row.status,
    reserved_microusd: String(row.reserved_microusd),
    charged_microusd: String(row.charged_microusd),
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    result: row.result,
    error_code: row.error_code,
    created_at: iso(row.created_at),
    finished_at: iso(row.finished_at),
  };
}
async function connection(client, id, lock = false) {
  return one(
    await client.query(
      `/* ai:connection */ SELECT ${connectionColumns} FROM public.ai_connections WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    ),
  );
}
async function probe(client, id) {
  return (
    await client.query(
      `/* ai:probe */ SELECT ${probeColumns} FROM public.ai_probe_runs WHERE id=$1`,
      [id],
    )
  ).rows[0];
}
async function connectionHistory(client, row) {
  await client.query(
    `/* ai:connection-history-insert */ INSERT INTO public.ai_connection_versions(connection_id,revision,snapshot) VALUES($1,$2,$3::jsonb)`,
    [row.id, row.revision, JSON.stringify(connectionDto(row))],
  );
}
function matchesConnectionCreate(row, request, keyring) {
  if (
    row.revision !== 1 ||
    !row.encrypted_key ||
    ['name', 'protocol', 'base_url', 'enabled', 'settings'].some(
      (field) => !isDeepStrictEqual(row[field], request[field]),
    )
  )
    return false;
  const actual = Buffer.from(decryptAiKey(row.encrypted_key, row.id, keyring));
  const expected = Buffer.from(request.api_key);
  try {
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } finally {
    actual.fill(0);
    expected.fill(0);
  }
}
export async function createAiConnection({ pool, request, keyring, allowedHosts }) {
  const v = parseAiConnectionCreate(request, allowedHosts);
  const id = v.id ?? randomUUID();
  return transaction(pool, async (client) => {
    await client.query(
      '/* ai:connection-create-lock */ SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`hzense:ai-connection-create:${id}`],
    );
    const old = (
      await client.query(
        `/* ai:connection */ SELECT ${connectionColumns} FROM public.ai_connections WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (old) {
      if (!matchesConnectionCreate(old, v, keyring)) aiFail('request_id_conflict');
      return connectionDto(old);
    }
    const encrypted = encryptAiKey(v.api_key, id, keyring);
    const row = (
      await client.query(
        `/* ai:connection-create */ INSERT INTO public.ai_connections(id,revision,name,protocol,base_url,enabled,settings,encrypted_key)
  VALUES($1,1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(id) DO NOTHING RETURNING ${connectionColumns}`,
        [
          id,
          v.name,
          v.protocol,
          v.base_url,
          v.enabled,
          JSON.stringify(v.settings),
          JSON.stringify(encrypted),
        ],
      )
    ).rows[0];
    if (!row) aiFail('request_id_conflict');
    await connectionHistory(client, row);
    return connectionDto(row);
  });
}
export async function updateAiConnection({ pool, request, keyring, allowedHosts }) {
  const v = parseAiConnectionUpdate(request, allowedHosts);
  return transaction(pool, async (client) => {
    const old = await connection(client, v.id, true);
    if (old.revision !== v.expected_revision) aiFail('revision_conflict');
    const endpointChanged =
      (v.base_url !== undefined && v.base_url !== old.base_url) ||
      (v.protocol !== undefined && v.protocol !== old.protocol);
    if (endpointChanged && !v.api_key) aiFail('endpoint_key_required');
    const next = { ...old, ...v, revision: old.revision + 1 };
    // A removed endpoint must not prevent emergency disable/key revocation.
    // New endpoints are always validated by the request parser, and an enabled
    // connection is checked again immediately before every network attempt.
    if (!v.revoke_key && next.enabled) validateAiBaseUrl(next.base_url, allowedHosts);
    if (v.revoke_key) {
      next.encrypted_key = null;
      next.enabled = false;
    } else if (v.api_key) next.encrypted_key = encryptAiKey(v.api_key, v.id, keyring);
    if (next.enabled && !next.encrypted_key) aiFail('key_unavailable');
    const row = one(
      await client.query(
        `/* ai:connection-update */ UPDATE public.ai_connections SET revision=$2,name=$3,protocol=$4,base_url=$5,enabled=$6,settings=$7::jsonb,encrypted_key=$8::jsonb,updated_at=clock_timestamp()
    WHERE id=$1 AND revision=$9 RETURNING ${connectionColumns}`,
        [
          v.id,
          next.revision,
          next.name,
          next.protocol,
          next.base_url,
          next.enabled,
          JSON.stringify(next.settings),
          next.encrypted_key ? JSON.stringify(next.encrypted_key) : null,
          v.expected_revision,
        ],
      ),
    );
    await connectionHistory(client, row);
    return connectionDto(row);
  });
}
export async function listAiConnections({ pool }) {
  return transaction(pool, async (client) =>
    (
      await client.query(
        `/* ai:connections */ SELECT ${connectionColumns} FROM public.ai_connections ORDER BY created_at,id LIMIT 501`,
      )
    ).rows.map(connectionDto),
  );
}
export async function getAiConnectionHistory({ pool, id }) {
  aiUuid(id);
  return transaction(pool, async (client) => {
    await connection(client, id);
    return (
      await client.query(
        '/* ai:connection-history */ SELECT revision,snapshot,created_at FROM public.ai_connection_versions WHERE connection_id=$1 ORDER BY revision DESC LIMIT 500',
        [id],
      )
    ).rows.map((row) => ({
      revision: row.revision,
      snapshot: connectionSnapshotDto(row.snapshot),
      created_at: iso(row.created_at),
    }));
  });
}

async function readiness(client, stages, locking = false) {
  const reasons = [];
  const warnings = [];
  const connections = new Map();
  // Stable row order matches configuration mutation. Never lock model APIs.
  for (const id of [...new Set(Object.values(stages).map((stage) => stage.connection_id))].sort()) {
    const result = await client.query(
      `/* ai:profile-connection */ SELECT ${connectionColumns} FROM public.ai_connections WHERE id=$1${locking ? ' FOR SHARE' : ''}`,
      [id],
    );
    connections.set(id, result.rows[0]);
  }
  for (const [name, stage] of Object.entries(stages)) {
    const row = connections.get(stage.connection_id);
    if (!row || !row.enabled || !row.encrypted_key || row.revision !== stage.connection_revision) {
      reasons.push(`${name}:connection_unavailable`);
      continue;
    }
    const passed = new Map(
      (
        await client.query(
          `/* ai:profile-probes */ SELECT kind,
      max(finished_at)>clock_timestamp()-interval '24 hours' AS recent
      FROM public.ai_probe_runs
      WHERE connection_id=$1 AND connection_revision=$2 AND model_id=$3 AND status='succeeded'
      AND finished_at<=clock_timestamp() GROUP BY kind`,
          [stage.connection_id, stage.connection_revision, stage.model_id],
        )
      ).rows.map((item) => [item.kind, item.recent]),
    );
    for (const kind of [
      'connection',
      'structured_output',
      ...(stage.require_tools ? ['tool_calling'] : []),
    ]) {
      if (!passed.has(kind)) reasons.push(`${name}:${kind}_required`);
      else if (passed.get(kind) !== true) warnings.push(`${name}:${kind}_test_old`);
    }
  }
  return { ready: reasons.length === 0, reasons, warnings };
}
export async function saveAiProfile({ pool, request }) {
  const v = parseAiProfileSave(request);
  const id = v.id ?? randomUUID();
  const updating = 'expected_revision' in v;
  return transaction(pool, async (client) => {
    let revision = 1;
    if (!updating)
      await client.query(
        '/* ai:profile-create-lock */ SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`hzense:ai-profile-create:${id}`],
      );
    const old = (
      await client.query(
        `/* ai:profile */ SELECT ${profileColumns} FROM public.ai_profiles WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (updating) {
      if (!old) aiFail('not_found');
      if (old.revision !== v.expected_revision) aiFail('revision_conflict');
      revision = old.revision + 1;
    } else if (old) {
      if (old.revision !== 1 || old.name !== v.name || !isDeepStrictEqual(old.stages, v.stages))
        aiFail('request_id_conflict');
      return profileDto(old, await readiness(client, old.stages, true));
    }
    const ready = await readiness(client, v.stages, true);
    if (!ready.ready) aiFail('profile_not_ready');
    const row = one(
      await client.query(
        updating
          ? `/* ai:profile-update */ UPDATE public.ai_profiles SET revision=$2,name=$3,stages=$4::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${profileColumns}`
          : `/* ai:profile-create */ INSERT INTO public.ai_profiles(id,revision,name,stages) VALUES($1,$2,$3,$4::jsonb) RETURNING ${profileColumns}`,
        [id, revision, v.name, JSON.stringify(v.stages)],
      ),
    );
    await client.query(
      '/* ai:profile-history-insert */ INSERT INTO public.ai_profile_versions(profile_id,revision,snapshot) VALUES($1,$2,$3::jsonb)',
      [id, revision, JSON.stringify(profileDto(row))],
    );
    return profileDto(row, ready);
  });
}
export async function listAiProfiles({ pool }) {
  return transaction(pool, async (client) => {
    const rows = (
      await client.query(
        `/* ai:profiles */ SELECT ${profileColumns} FROM public.ai_profiles ORDER BY created_at,id LIMIT 501`,
      )
    ).rows;
    const result = [];
    for (const row of rows) result.push(profileDto(row, await readiness(client, row.stages)));
    return result;
  });
}
export async function getAiProfileHistory({ pool, id }) {
  aiUuid(id);
  return transaction(pool, async (client) => {
    one(
      await client.query('/* ai:profile-exists */ SELECT id FROM public.ai_profiles WHERE id=$1', [
        id,
      ]),
    );
    return (
      await client.query(
        '/* ai:profile-history */ SELECT revision,snapshot,created_at FROM public.ai_profile_versions WHERE profile_id=$1 ORDER BY revision DESC LIMIT 500',
        [id],
      )
    ).rows.map((row) => ({
      revision: row.revision,
      snapshot: profileDto(row.snapshot),
      created_at: iso(row.created_at),
    }));
  });
}
export async function resolveAiProfileForExecution({ pool, id }) {
  aiUuid(id);
  return transaction(pool, async (client) => {
    const row = one(
      await client.query(
        `/* ai:profile */ SELECT ${profileColumns} FROM public.ai_profiles WHERE id=$1 FOR SHARE`,
        [id],
      ),
    );
    const ready = await readiness(client, row.stages, true);
    if (!ready.ready) aiFail('profile_not_ready');
    return profileDto(row, ready);
  });
}
/** Trusted server-only adapter. Never expose its optional apiKey in an HTTP DTO or snapshot.
 * Resolves current capability proofs and pins both Profile and connection revisions.
 * Generation admission/ledger is separate from the capability-probe ledger.
 */
export async function resolveAiGenerationAccess({ pool, id, revision, allowedHosts, keyring }) {
  aiUuid(id);
  aiInteger(revision, 1, 2147483647);
  return transaction(pool, async (client) => {
    const row = one(
      await client.query(
        `/* ai:profile */ SELECT ${profileColumns} FROM public.ai_profiles WHERE id=$1 FOR SHARE`,
        [id],
      ),
    );
    if (row.revision !== revision) aiFail('revision_conflict');
    const ready = await readiness(client, row.stages, true);
    if (!ready.ready) aiFail('profile_not_ready');
    const current = await connection(client, row.stages.extract.connection_id);
    validateAiBaseUrl(current.base_url, allowedHosts);
    if (
      !current.enabled ||
      !current.encrypted_key ||
      current.revision !== row.stages.extract.connection_revision
    )
      aiFail('connection_unavailable');
    return {
      profile: profileDto(row, ready),
      connection: {
        id: current.id,
        revision: current.revision,
        protocol: current.protocol,
        base_url: current.base_url,
        settings: current.settings,
      },
      ...(keyring ? { apiKey: decryptAiKey(current.encrypted_key, current.id, keyring) } : {}),
    };
  });
}
export async function getAiProbe({ pool, id }) {
  aiUuid(id);
  return transaction(pool, async (client) => {
    const row = await probe(client, id);
    if (!row) aiFail('not_found');
    if (!['pending', 'running'].includes(row.status)) return probeDto(row);
    await connection(client, row.connection_id, true);
    await sweep(client, row.connection_id);
    return probeDto(await probe(client, id));
  });
}
export async function listAiProbes({ pool }) {
  return transaction(pool, async (client) => {
    const sql = `/* ai:probes */ SELECT ${probeColumns} FROM public.ai_probe_runs ORDER BY created_at DESC,id LIMIT 500`;
    const rows = (await client.query(sql)).rows;
    const ids = [
      ...new Set(
        rows
          .filter((row) => ['pending', 'running'].includes(row.status))
          .map((row) => row.connection_id),
      ),
    ].sort();
    for (const id of ids) {
      await connection(client, id, true);
      await sweep(client, id);
    }
    return (ids.length ? (await client.query(sql)).rows : rows).map(probeDto);
  });
}

const providerErrors = new Set([
  'invalid_configuration',
  'invalid_model',
  'blocked_target',
  'dns_failed',
  'timeout',
  'network_error',
  'response_too_large',
  'redirect_blocked',
  'provider_rejected',
  'invalid_response',
  'capability_failed',
]);
function safeProviderResult(value, kind, modelId) {
  try {
    const v = aiObject(
      value,
      ['success', 'model_id', 'input_tokens', 'output_tokens', 'result'],
      ['error_code'],
    );
    if (typeof v.success !== 'boolean' || v.model_id !== (modelId ?? null)) throw Error();
    for (const key of ['input_tokens', 'output_tokens'])
      if (v[key] !== null) aiInteger(v[key], 0, 2147483647);
    if (!v.success)
      return {
        ...v,
        result: {},
        error_code: providerErrors.has(v.error_code) ? v.error_code : 'invalid_response',
      };
    let result;
    if (kind === 'models') {
      const r = aiObject(v.result, ['models', 'count', 'truncated']);
      if (
        !Array.isArray(r.models) ||
        r.models.length > 200 ||
        r.count !== r.models.length ||
        typeof r.truncated !== 'boolean'
      )
        throw Error();
      result = {
        models: r.models.map((model) => ({ id: aiModelId(aiObject(model, ['id']).id) })),
        count: r.count,
        truncated: r.truncated,
      };
    } else {
      const required =
        kind === 'connection'
          ? ['sentinel_matched']
          : kind === 'structured_output'
            ? ['schema_valid', 'sentinel_matched']
            : ['tool_called', 'arguments_valid'];
      const r = aiObject(v.result, required);
      if (required.some((key) => r[key] !== true)) throw Error();
      result = r;
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 16384) throw Error();
    return { ...v, result, error_code: null };
  } catch {
    return {
      success: false,
      model_id: modelId ?? null,
      input_tokens: null,
      output_tokens: null,
      result: {},
      error_code: 'invalid_response',
    };
  }
}
const cost = (input, output, settings) =>
  (BigInt(input) * BigInt(settings.input_price_microusd_per_million) +
    BigInt(output) * BigInt(settings.output_price_microusd_per_million) +
    999999n) /
  1000000n;
const probeFingerprint = (v) =>
  createHash('sha256')
    .update(
      JSON.stringify([v.id, v.connection_id, v.connection_revision, v.kind, v.model_id ?? null]),
    )
    .digest('hex');
async function sweep(client, connectionId) {
  await client.query(
    `/* ai:probe-sweep */ UPDATE public.ai_probe_runs SET status='unknown',error_code='probe_outcome_unknown',finished_at=clock_timestamp()
  WHERE connection_id=$1 AND status IN ('pending','running') AND created_at<clock_timestamp()-interval '60 seconds'`,
    [connectionId],
  );
}
export async function runAiProbe({ pool, request, keyring, allowedHosts, invoke }) {
  const v = parseAiProbeRequest(request);
  if (typeof invoke !== 'function') aiFail('invalid_configuration');
  const fingerprint = probeFingerprint(v);
  const reserved = await transaction(
    pool,
    async (client) => {
      await client.query(
        '/* ai:probe-lock */ SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`hzense:ai-probe:${v.id}`],
      );
      const old = await probe(client, v.id);
      if (old) {
        if (old.fingerprint !== fingerprint) aiFail('request_id_conflict');
        await connection(client, old.connection_id, true);
        await sweep(client, old.connection_id);
        return { replay: await probe(client, v.id) };
      }
      const row = await connection(client, v.connection_id, true);
      validateAiBaseUrl(row.base_url, allowedHosts);
      if (row.revision !== v.connection_revision) aiFail('revision_conflict');
      if (!row.enabled || !row.encrypted_key) aiFail('connection_unavailable');
      await sweep(client, v.connection_id);
      const usage = one(
        await client.query(
          `/* ai:probe-budget */ SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today_count,
      COALESCE(sum(GREATEST(reserved_microusd,charged_microusd)) FILTER(WHERE created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS today_cost,
      count(*) FILTER(WHERE status IN ('pending','running')) AS active FROM public.ai_probe_runs WHERE connection_id=$1`,
          [v.connection_id],
        ),
      );
      if (Number(usage.today_count) >= 100) aiFail('daily_probe_limit');
      if (Number(usage.active) >= row.settings.max_concurrency) aiFail('concurrency_limit');
      const amount = v.kind === 'models' ? 0n : cost(8192, 128, row.settings);
      if (BigInt(usage.today_cost) + amount > BigInt(row.settings.daily_budget_microusd))
        aiFail('daily_budget_exceeded');
      const configuration = {
        protocol: row.protocol,
        base_url: row.base_url,
        settings: row.settings,
        max_output_tokens: 128,
        reserved_input_tokens: 8192,
      };
      const saved = one(
        await client.query(
          `/* ai:probe-reserve */ INSERT INTO public.ai_probe_runs(id,connection_id,connection_revision,kind,model_id,fingerprint,status,configuration,reserved_microusd,charged_microusd,result)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7::jsonb,$8,$8,'{}'::jsonb) RETURNING ${probeColumns}`,
          [
            v.id,
            v.connection_id,
            v.connection_revision,
            v.kind,
            v.model_id ?? null,
            fingerprint,
            JSON.stringify(configuration),
            amount.toString(),
          ],
        ),
      );
      return { saved };
    },
    { commitErrorCode: 'probe_outcome_unknown' },
  );
  if (reserved.replay) return probeDto(reserved.replay);
  // A pending reservation was committed before any credentials are decrypted
  // or network is attempted. An uncertain commit must not cause an API retry.
  let prepared;
  try {
    prepared = await transaction(pool, async (client) => {
      const row = await connection(client, v.connection_id, true);
      await sweep(client, v.connection_id);
      const current = await probe(client, v.id);
      if (current.status !== 'pending') return { receipt: current };
      if (row.revision !== v.connection_revision || !row.enabled || !row.encrypted_key) {
        const stale = one(
          await client.query(
            `/* ai:probe-stale */ UPDATE public.ai_probe_runs SET status='stale',error_code='connection_unavailable',finished_at=clock_timestamp() WHERE id=$1 RETURNING ${probeColumns}`,
            [v.id],
          ),
        );
        return { receipt: stale };
      }
      validateAiBaseUrl(row.base_url, allowedHosts);
      const apiKey = decryptAiKey(row.encrypted_key, row.id, keyring);
      await client.query(
        "/* ai:probe-running */ UPDATE public.ai_probe_runs SET status='running' WHERE id=$1 AND status='pending'",
        [v.id],
      );
      return {
        connection: {
          id: row.id,
          revision: row.revision,
          protocol: row.protocol,
          base_url: row.base_url,
          settings: row.settings,
        },
        apiKey,
      };
    });
  } catch (error) {
    if (error instanceof AiConfigError && error.code !== 'database_unavailable') throw error;
    aiFail('probe_outcome_unknown');
  }
  if (prepared.receipt) return probeDto(prepared.receipt);
  let outcome;
  try {
    outcome = safeProviderResult(
      await invoke({
        connection: prepared.connection,
        apiKey: prepared.apiKey,
        kind: v.kind,
        modelId: v.model_id,
        allowedHosts,
      }),
      v.kind,
      v.model_id,
    );
  } catch {
    outcome = {
      success: false,
      model_id: v.model_id ?? null,
      input_tokens: null,
      output_tokens: null,
      result: {},
      error_code: 'network_error',
    };
  }
  // Even trusted adapters cannot return credential-bearing model names.
  if (JSON.stringify(outcome.result).includes(prepared.apiKey))
    outcome = {
      success: false,
      model_id: v.model_id ?? null,
      input_tokens: null,
      output_tokens: null,
      result: {},
      error_code: 'invalid_response',
    };
  prepared.apiKey = undefined;
  try {
    return await transaction(pool, async (client) => {
      const row = await connection(client, v.connection_id, true);
      await sweep(client, v.connection_id);
      const current = await probe(client, v.id);
      if (current.status !== 'running') return probeDto(current);
      const stale = row.revision !== v.connection_revision || !row.enabled || !row.encrypted_key;
      const measured =
        outcome.input_tokens === null || outcome.output_tokens === null
          ? 0n
          : cost(outcome.input_tokens, outcome.output_tokens, prepared.connection.settings);
      const charged =
        measured > BigInt(current.reserved_microusd) ? measured : BigInt(current.reserved_microusd);
      const saved = one(
        await client.query(
          `/* ai:probe-finish */ UPDATE public.ai_probe_runs SET status=$2,charged_microusd=$3,input_tokens=$4,output_tokens=$5,result=$6::jsonb,error_code=$7,finished_at=clock_timestamp()
      WHERE id=$1 AND status='running' RETURNING ${probeColumns}`,
          [
            v.id,
            stale ? 'stale' : outcome.success ? 'succeeded' : 'failed',
            charged.toString(),
            outcome.input_tokens,
            outcome.output_tokens,
            JSON.stringify(stale ? {} : outcome.result),
            stale ? 'connection_unavailable' : outcome.error_code,
          ],
        ),
      );
      return probeDto(saved);
    });
  } catch {
    aiFail('probe_outcome_unknown');
  }
}
