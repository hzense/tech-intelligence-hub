import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { encryptAiKey } from '../src/ai-config-crypto.mjs';
import {
  createAiConnection,
  updateAiConnection,
  listAiConnections,
  getAiConnectionHistory,
  saveAiProfile,
  listAiProfiles,
  getAiProfileHistory,
  resolveAiProfileForExecution,
  runAiProbe,
  getAiProbe,
  listAiProbes,
} from '../src/ai-config-store.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const key = 'synthetic-key-never-return';
const keyring = { active: 'v1', keys: { v1: Buffer.alloc(32, 8).toString('base64') } };
const allowedHosts = ['example.com', 'other.example'];
const settings = {
  timeout_ms: 10000,
  max_concurrency: 1,
  daily_budget_microusd: 1000000,
  input_price_microusd_per_million: 1000000,
  output_price_microusd_per_million: 2000000,
};
const timestamp = new Date('2026-09-13T12:00:00.000Z');
const initial = () => ({
  id,
  revision: 1,
  name: 'Synthetic',
  protocol: 'openai-compatible',
  base_url: 'https://example.com/v1',
  enabled: true,
  settings: { ...settings },
  encrypted_key: encryptAiKey(key, id, keyring),
  created_at: timestamp,
  updated_at: timestamp,
});
const request = () => ({
  id: randomUUID(),
  connection_id: id,
  connection_revision: 1,
  kind: 'connection',
  model_id: 'test/model',
});
const success = () => ({
  success: true,
  model_id: 'test/model',
  input_tokens: 12,
  output_tokens: 1,
  result: { sentinel_matched: true },
});
const stage = () => ({
  connection_id: id,
  connection_revision: 1,
  model_id: 'test/model',
  prompt: 'Synthetic prompt',
  temperature: 0,
  max_output_tokens: 128,
  require_tools: false,
});
const connectionCreate = () => ({
  id,
  name: 'Synthetic',
  protocol: 'openai-compatible',
  base_url: 'https://example.com/v1',
  enabled: true,
  settings: { ...settings },
  api_key: key,
});
const profileCreate = () => ({
  id: randomUUID(),
  name: 'Default',
  stages: { extract: stage(), verify: stage(), analyze: stage() },
});
function fake(options = {}) {
  let state = {
    connections: options.empty ? [] : [initial()],
    history: [],
    probes: [],
    profiles: [],
    profileHistory: [],
  };
  const calls = [];
  let backup;
  let commits = 0;
  let connectionReads = 0;
  const raw = new Error('SECRET raw pg diagnostic');
  const query = vi.fn(async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('BEGIN')) {
      backup = globalThis.structuredClone(state);
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      if (backup) state = backup;
      backup = undefined;
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      backup = undefined;
      commits++;
      if (options.failCommit === commits) throw raw;
      return { rows: [] };
    }
    const tag = sql.match(/\/\* ai:([^ ]+) \*\//)?.[1];
    if (options.failTag === tag && tag) throw raw;
    let rows = [];
    switch (tag) {
      case 'connection':
        if (options.reviseBeforePrepare && ++connectionReads === 2)
          state.connections[0].revision = 2;
        rows = state.connections.filter((r) => r.id === args[0]);
        break;
      case 'connections':
        rows = state.connections;
        break;
      case 'connection-create': {
        const [cid, name, protocol, base_url, enabled, json, encrypted] = args;
        if (!state.connections.some((r) => r.id === cid)) {
          const row = {
            id: cid,
            revision: 1,
            name,
            protocol,
            base_url,
            enabled,
            settings: JSON.parse(json),
            encrypted_key: JSON.parse(encrypted),
            created_at: timestamp,
            updated_at: timestamp,
          };
          state.connections.push(row);
          rows = [row];
        }
        break;
      }
      case 'connection-update': {
        const [cid, revision, name, protocol, base_url, enabled, json, encrypted] = args;
        const row = state.connections.find((r) => r.id === cid);
        Object.assign(row, {
          revision,
          name,
          protocol,
          base_url,
          enabled,
          settings: JSON.parse(json),
          encrypted_key: encrypted === null ? null : JSON.parse(encrypted),
          updated_at: timestamp,
        });
        rows = [row];
        break;
      }
      case 'connection-history-insert':
        state.history.push({
          connection_id: args[0],
          revision: args[1],
          snapshot: JSON.parse(args[2]),
          created_at: timestamp,
        });
        break;
      case 'connection-history':
        rows = state.history.filter((r) => r.connection_id === args[0]);
        break;
      case 'probe':
        rows = state.probes.filter((r) => r.id === args[0]);
        break;
      case 'probes':
        rows = state.probes;
        break;
      case 'probe-sweep':
        for (const row of state.probes) {
          if (
            row.connection_id === args[0] &&
            ['pending', 'running'].includes(row.status) &&
            +row.created_at < +timestamp - 60000
          )
            Object.assign(row, {
              status: 'unknown',
              error_code: 'probe_outcome_unknown',
              finished_at: timestamp,
            });
        }
        break;
      case 'probe-budget':
        rows = [
          {
            today_count: options.todayCount ?? String(state.probes.length),
            today_cost:
              options.todayCost ??
              state.probes.reduce((n, r) => n + BigInt(r.charged_microusd), 0n).toString(),
            active:
              options.active ??
              String(state.probes.filter((r) => ['pending', 'running'].includes(r.status)).length),
          },
        ];
        break;
      case 'probe-reserve': {
        const [
          pid,
          connection_id,
          connection_revision,
          kind,
          model_id,
          fingerprint,
          configuration,
          amount,
        ] = args;
        const row = {
          id: pid,
          connection_id,
          connection_revision,
          kind,
          model_id,
          fingerprint,
          configuration: JSON.parse(configuration),
          reserved_microusd: amount,
          charged_microusd: amount,
          status: 'pending',
          result: {},
          error_code: null,
          input_tokens: null,
          output_tokens: null,
          created_at: timestamp,
          finished_at: null,
        };
        state.probes.push(row);
        rows = [row];
        break;
      }
      case 'probe-running':
        state.probes.find((r) => r.id === args[0]).status = 'running';
        break;
      case 'probe-stale': {
        const row = state.probes.find((r) => r.id === args[0]);
        Object.assign(row, {
          status: 'stale',
          error_code: 'connection_unavailable',
          finished_at: timestamp,
        });
        rows = [row];
        break;
      }
      case 'probe-finish': {
        const [pid, status, charged_microusd, input_tokens, output_tokens, result, error_code] =
          args;
        const row = state.probes.find((r) => r.id === pid);
        Object.assign(row, {
          status,
          charged_microusd,
          input_tokens,
          output_tokens,
          result: JSON.parse(result),
          error_code,
          finished_at: timestamp,
        });
        rows = [row];
        break;
      }
      case 'profile-connection':
        rows = state.connections.filter((r) => r.id === args[0]);
        break;
      case 'profile-probes':
        rows = (options.passedKinds ?? ['connection', 'structured_output']).map((kind) => ({
          kind,
        }));
        break;
      case 'profile':
      case 'profile-exists':
        rows = state.profiles.filter((r) => r.id === args[0]);
        break;
      case 'profile-create': {
        const row = {
          id: args[0],
          revision: args[1],
          name: args[2],
          stages: JSON.parse(args[3]),
          created_at: timestamp,
          updated_at: timestamp,
        };
        state.profiles.push(row);
        rows = [row];
        break;
      }
      case 'profile-update': {
        const row = state.profiles.find((r) => r.id === args[0]);
        Object.assign(row, {
          revision: args[1],
          name: args[2],
          stages: JSON.parse(args[3]),
          updated_at: timestamp,
        });
        rows = [row];
        break;
      }
      case 'profile-history-insert':
        state.profileHistory.push({
          profile_id: args[0],
          revision: args[1],
          snapshot: JSON.parse(args[2]),
          created_at: timestamp,
        });
        break;
      case 'profile-history':
        rows = state.profileHistory.filter((r) => r.profile_id === args[0]);
        break;
      case 'profiles':
        rows = state.profiles;
        break;
    }
    return { rows: globalThis.structuredClone(rows), rowCount: rows.length };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  return {
    pool,
    calls,
    release,
    get state() {
      return state;
    },
    get commits() {
      return commits;
    },
  };
}
const run = (f, req, invoke) =>
  runAiProbe({ pool: f.pool, request: req, keyring, allowedHosts, invoke });
describe('AI connection versioned configuration', () => {
  it('replays negative-zero prices after the connection passes through JSON persistence', async () => {
    const f = fake({ empty: true });
    const input = {
      pool: f.pool,
      request: {
        ...connectionCreate(),
        settings: {
          ...settings,
          input_price_microusd_per_million: -0,
          output_price_microusd_per_million: -0,
        },
      },
      keyring,
      allowedHosts,
    };
    const created = await createAiConnection(input);
    expect(f.state.connections[0].settings.input_price_microusd_per_million).toBe(0);
    expect(f.state.connections[0].settings.output_price_microusd_per_million).toBe(0);
    await expect(createAiConnection(input)).resolves.toEqual(created);
    expect(f.state.connections).toHaveLength(1);
    expect(f.state.history).toHaveLength(1);
  });
  it('replays a client ID after a lost creation response without duplicating history or ciphertext', async () => {
    const options = { empty: true, failCommit: 1 };
    const f = fake(options);
    const input = { pool: f.pool, request: connectionCreate(), keyring, allowedHosts };
    await expect(createAiConnection(input)).rejects.toMatchObject({ code: 'database_unavailable' });
    const envelope = globalThis.structuredClone(f.state.connections[0].encrypted_key);
    options.failCommit = 0;
    const replay = await createAiConnection({
      ...input,
      request: {
        ...input.request,
        base_url: `${input.request.base_url}/`,
        settings: Object.fromEntries(Object.entries(settings).reverse()),
      },
    });
    expect(replay).toMatchObject({ id, revision: 1, has_key: true });
    expect(f.state.connections).toHaveLength(1);
    expect(f.state.history).toHaveLength(1);
    expect(f.state.connections[0].encrypted_key).toEqual(envelope);
    expect(JSON.stringify([replay, f.state.history, f.calls])).not.toContain(key);
    expect(JSON.stringify(f.state.history)).not.toMatch(/ciphertext|fingerprint/);
  });
  it.each([
    { name: 'Different' },
    { enabled: false },
    { base_url: 'https://other.example/v1' },
    { settings: { ...settings, timeout_ms: 3000 } },
    { api_key: 'synthetic-key-never-returo' },
    { api_key: 'a-longer-synthetic-replacement-key' },
  ])('rejects conflicting connection creation payload %j without mutation', async (patch) => {
    const f = fake();
    const before = globalThis.structuredClone(f.state);
    await expect(
      createAiConnection({
        pool: f.pool,
        request: { ...connectionCreate(), ...patch },
        keyring,
        allowedHosts,
      }),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
    expect(f.state).toEqual(before);
  });
  it.each([{ name: 'Synthetic' }, { revoke_key: true }])(
    'does not restore a connection already changed after creation %j',
    async (patch) => {
      const f = fake();
      await updateAiConnection({
        pool: f.pool,
        request: { id, expected_revision: 1, ...patch },
        keyring,
        allowedHosts,
      });
      const before = globalThis.structuredClone(f.state);
      await expect(
        createAiConnection({ pool: f.pool, request: connectionCreate(), keyring, allowedHosts }),
      ).rejects.toMatchObject({ code: 'request_id_conflict' });
      expect(f.state).toEqual(before);
    },
  );
  it('encrypts credentials once and only stores nonsecret connection snapshots', async () => {
    const f = fake({ empty: true });
    const created = await createAiConnection({
      pool: f.pool,
      request: {
        id,
        name: 'First',
        protocol: 'openai-compatible',
        base_url: 'https://example.com/v1',
        enabled: true,
        settings,
        api_key: key,
      },
      keyring,
      allowedHosts,
    });
    expect(created).toMatchObject({ id, revision: 1, has_key: true, key_mask: '••••••••' });
    expect(created).not.toHaveProperty('encrypted_key');
    const list = await listAiConnections({ pool: f.pool }),
      history = await getAiConnectionHistory({ pool: f.pool, id });
    expect(JSON.stringify([created, list, history, f.calls])).not.toContain(key);
    expect(JSON.stringify(history)).not.toContain('ciphertext');
    expect(history[0].snapshot.has_key).toBe(true);
  });
  it('requires a replacement key when the target changes and applies CAS', async () => {
    const f = fake();
    await expect(
      updateAiConnection({
        pool: f.pool,
        request: { id, expected_revision: 1, base_url: 'https://other.example/v1' },
        keyring,
        allowedHosts,
      }),
    ).rejects.toMatchObject({ code: 'endpoint_key_required' });
    await expect(
      updateAiConnection({
        pool: f.pool,
        request: { id, expected_revision: 2, name: 'Late' },
        keyring,
        allowedHosts,
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    const changed = await updateAiConnection({
      pool: f.pool,
      request: {
        id,
        expected_revision: 1,
        base_url: 'https://other.example/v1',
        api_key: 'new-synthetic-key',
      },
      keyring,
      allowedHosts,
    });
    expect(changed.revision).toBe(2);
    expect(changed.has_key).toBe(true);
  });
  it('revocation removes ciphertext and disables the connection without requiring a root key', async () => {
    const f = fake();
    const changed = await updateAiConnection({
      pool: f.pool,
      request: { id, expected_revision: 1, revoke_key: true },
      allowedHosts,
    });
    expect(changed).toMatchObject({ enabled: false, has_key: false, key_mask: null });
    expect(f.state.connections[0].encrypted_key).toBe(null);
  });
  it('allows emergency revocation even after the old endpoint leaves the server allowlist', async () => {
    const f = fake();
    await expect(
      updateAiConnection({
        pool: f.pool,
        request: { id, expected_revision: 1, revoke_key: true },
        allowedHosts: [],
      }),
    ).resolves.toMatchObject({ enabled: false, has_key: false });
  });
  it('rejects unsupported body fields before opening a pool', async () => {
    const f = fake();
    await expect(
      updateAiConnection({
        pool: f.pool,
        request: { id, expected_revision: 1, verified: true },
        keyring,
        allowedHosts,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
});
describe('AI probe reservation and exactly-once external attempt', () => {
  it('commits reservation and running state before network and returns only safe summary', async () => {
    const f = fake();
    const req = request();
    const invoke = vi.fn(async (input) => {
      expect(f.commits).toBe(2);
      expect(input.apiKey).toBe(key);
      expect(f.state.probes[0].status).toBe('running');
      return success();
    });
    const result = await run(f, req, invoke);
    expect(result).toMatchObject({
      status: 'succeeded',
      reserved_microusd: '8448',
      charged_microusd: '8448',
    });
    expect(JSON.stringify([result, f.calls])).not.toContain(key);
    expect(result).not.toHaveProperty('configuration');
    expect(result).not.toHaveProperty('fingerprint');
    await expect(run(f, req, invoke)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await getAiProbe({ pool: f.pool, id: req.id })).toEqual(result);
    expect(await listAiProbes({ pool: f.pool })).toEqual([result]);
  });
  it('rejects different meaning with the same probe ID without another call', async () => {
    const f = fake();
    const req = request();
    const invoke = vi.fn(async () => success());
    await run(f, req, invoke);
    await expect(run(f, { ...req, model_id: 'other' }, invoke)).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ todayCount: '100' }, 'daily_probe_limit'],
    [{ active: '1' }, 'concurrency_limit'],
    [{ todayCost: '999999' }, 'daily_budget_exceeded'],
  ])('respects budget/concurrency %j', async (options, code) => {
    const f = fake(options),
      invoke = vi.fn();
    await expect(run(f, request(), invoke)).rejects.toMatchObject({ code });
    expect(invoke).not.toHaveBeenCalled();
    expect(f.state.probes).toHaveLength(0);
  });
  it('counts models list probes while reserving no money', async () => {
    const f = fake();
    const req = request();
    req.kind = 'models';
    delete req.model_id;
    const result = await run(f, req, async () => ({
      success: true,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
      result: { models: [{ id: 'test/model' }], count: 1, truncated: false },
    }));
    expect(result.reserved_microusd).toBe('0');
    expect(result.status).toBe('succeeded');
  });
  it.each([1, 2])(
    'does not issue an external call after uncertain commit %s',
    async (failCommit) => {
      const options = { failCommit },
        f = fake(options),
        invoke = vi.fn(async () => success()),
        req = request();
      await expect(run(f, req, invoke)).rejects.toMatchObject({
        code: 'probe_outcome_unknown',
      });
      expect(invoke).not.toHaveBeenCalled();
      options.failCommit = 0;
      const old = await run(f, req, invoke);
      expect(['pending', 'running']).toContain(old.status);
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it('keeps definite reservation errors distinct from an uncertain commit', async () => {
    const f = fake({ failTag: 'probe-reserve' });
    const invoke = vi.fn();
    await expect(run(f, request(), invoke)).rejects.toMatchObject({ code: 'database_unavailable' });
    await expect(run(f, { ...request(), connection_revision: 0 }, invoke)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      run(fake(), { ...request(), connection_revision: 2 }, invoke),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
    });
    expect(f.state.probes).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('returns an unknown expired attempt and keeps its reservation without retrying', async () => {
    const options = { failCommit: 2 },
      f = fake(options),
      req = request(),
      invoke = vi.fn(async () => success());
    await expect(run(f, req, invoke)).rejects.toThrow();
    options.failCommit = 0;
    f.state.probes[0].created_at = new Date(+timestamp - 61000);
    const result = await run(f, req, invoke);
    expect(result).toMatchObject({ status: 'unknown', charged_microusd: '8448' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(['get', 'list'])(
    'reconciles abandoned attempts while administrators %s probe receipts',
    async (operation) => {
      const options = { failCommit: 2 },
        f = fake(options),
        req = request(),
        invoke = vi.fn(async () => success());
      await expect(run(f, req, invoke)).rejects.toThrow();
      options.failCommit = 0;
      f.state.probes[0].created_at = new Date(+timestamp - 61000);
      const result =
        operation === 'get'
          ? await getAiProbe({ pool: f.pool, id: req.id })
          : (await listAiProbes({ pool: f.pool }))[0];
      expect(result).toMatchObject({ status: 'unknown', charged_microusd: '8448' });
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it('detects changed connection after reservation before using credentials', async () => {
    const f = fake({ reviseBeforePrepare: true }),
      invoke = vi.fn();
    const result = await run(f, request(), invoke);
    expect(result.status).toBe('stale');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('does not treat successful old-configuration output as current capability', async () => {
    const f = fake();
    const result = await run(f, request(), async () => {
      f.state.connections[0].revision = 2;
      return success();
    });
    expect(result).toMatchObject({ status: 'stale', result: {} });
  });
  it('keeps reservation and safe errors when the provider throws sensitive data', async () => {
    const f = fake();
    const result = await run(f, request(), async () => {
      throw new Error(key);
    });
    expect(result).toMatchObject({
      status: 'failed',
      charged_microusd: '8448',
      error_code: 'network_error',
      result: {},
    });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it.each([
    {
      success: true,
      model_id: 'test/model',
      input_tokens: 1,
      output_tokens: 1,
      result: { sentinel_matched: true, body: key },
    },
    { ...success(), result: { sentinel_matched: false } },
    { ...success(), input_tokens: -1 },
  ])('rejects untrusted provider summary %j', async (output) => {
    const f = fake();
    const result = await run(f, request(), async () => output);
    expect(result).toMatchObject({ status: 'failed', error_code: 'invalid_response', result: {} });
  });
  it('never retries an external call after a final database failure', async () => {
    const options = { failTag: 'probe-finish' },
      f = fake(options),
      invoke = vi.fn(async () => success()),
      req = request();
    await expect(run(f, req, invoke)).rejects.toMatchObject({ code: 'probe_outcome_unknown' });
    options.failTag = null;
    await run(f, req, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
describe('AI profile capability readiness', () => {
  it('replays a negative-zero temperature after the profile passes through JSON persistence', async () => {
    const f = fake();
    const req = profileCreate();
    req.stages.extract.temperature = -0;
    const created = await saveAiProfile({ pool: f.pool, request: req });
    expect(f.state.profiles[0].stages.extract.temperature).toBe(0);
    await expect(saveAiProfile({ pool: f.pool, request: req })).resolves.toEqual(created);
    expect(f.state.profiles).toHaveLength(1);
    expect(f.state.profileHistory).toHaveLength(1);
  });
  it('creates with a client ID and replays a lost commit response without another profile version', async () => {
    const options = { failCommit: 1 };
    const f = fake(options);
    const req = profileCreate();
    await expect(saveAiProfile({ pool: f.pool, request: req })).rejects.toMatchObject({
      code: 'database_unavailable',
    });
    options.failCommit = 0;
    const replay = await saveAiProfile({
      pool: f.pool,
      request: { ...req, stages: Object.fromEntries(Object.entries(req.stages).reverse()) },
    });
    expect(replay).toMatchObject({ id: req.id, revision: 1, readiness: { ready: true } });
    expect(f.state.profiles).toHaveLength(1);
    expect(f.state.profileHistory).toHaveLength(1);
    options.passedKinds = [];
    const stale = await saveAiProfile({ pool: f.pool, request: req });
    expect(stale.readiness.ready).toBe(false);
    expect(f.state.profileHistory).toHaveLength(1);
  });
  it.each([
    { name: 'Changed' },
    { stages: { extract: { ...stage(), prompt: 'Other' }, verify: stage(), analyze: stage() } },
  ])('rejects conflicting profile creation payload %j without overwriting it', async (patch) => {
    const f = fake();
    const req = profileCreate();
    await saveAiProfile({ pool: f.pool, request: req });
    const before = globalThis.structuredClone(f.state);
    await expect(
      saveAiProfile({ pool: f.pool, request: { ...req, ...patch } }),
    ).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
    expect(f.state).toEqual(before);
  });
  it('keeps CAS updates separate from create replays and rejects an old create after any update', async () => {
    const f = fake();
    const req = profileCreate();
    await expect(
      saveAiProfile({ pool: f.pool, request: { ...req, expected_revision: 1 } }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await saveAiProfile({ pool: f.pool, request: req });
    await expect(
      saveAiProfile({ pool: f.pool, request: { ...req, expected_revision: 2 } }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    const changed = await saveAiProfile({
      pool: f.pool,
      request: { ...req, expected_revision: 1 },
    });
    expect(changed.revision).toBe(2);
    expect(f.state.profileHistory).toHaveLength(2);
    await expect(saveAiProfile({ pool: f.pool, request: req })).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
    expect(f.state.profileHistory).toHaveLength(2);
  });
  it('saves a profile and history only after matching successful fresh revision-bound probes', async () => {
    const f = fake();
    const saved = await saveAiProfile({
      pool: f.pool,
      request: { name: 'Default', stages: { extract: stage(), verify: stage(), analyze: stage() } },
    });
    expect(saved.readiness.ready).toBe(true);
    expect((await getAiProfileHistory({ pool: f.pool, id: saved.id }))[0].snapshot.name).toBe(
      'Default',
    );
    expect(
      (await resolveAiProfileForExecution({ pool: f.pool, id: saved.id })).readiness.ready,
    ).toBe(true);
    const sql = f.calls.find((c) => c.sql.includes('ai:profile-probes')).sql;
    expect(sql).toContain("status='succeeded'");
    expect(sql).toContain("interval '24 hours'");
    f.state.connections[0].revision = 2;
    expect((await listAiProfiles({ pool: f.pool }))[0].readiness.ready).toBe(false);
    await expect(
      resolveAiProfileForExecution({ pool: f.pool, id: saved.id }),
    ).rejects.toMatchObject({ code: 'profile_not_ready' });
  });
  it.each([[[]], [['connection']], [['structured_output']]])(
    'does not accept incomplete capability evidence %j',
    async (passedKinds) => {
      const f = fake({ passedKinds });
      await expect(
        saveAiProfile({
          pool: f.pool,
          request: {
            name: 'Default',
            stages: { extract: stage(), verify: stage(), analyze: stage() },
          },
        }),
      ).rejects.toMatchObject({ code: 'profile_not_ready' });
      expect(f.state.profiles).toHaveLength(0);
    },
  );
  it('requires a tool probe only for stages that require tools', async () => {
    const f = fake();
    await expect(
      saveAiProfile({
        pool: f.pool,
        request: {
          name: 'Tools',
          stages: {
            extract: { ...stage(), require_tools: true },
            verify: stage(),
            analyze: stage(),
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_not_ready' });
  });
  it('sanitizes database diagnostics', async () => {
    const f = fake({ failTag: 'connections' });
    await expect(listAiConnections({ pool: f.pool })).rejects.toMatchObject({
      code: 'database_unavailable',
      message: 'database_unavailable',
    });
  });
});
