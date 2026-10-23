import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createAiAdminExecutor } from '../lib/admin-ai-service.ts';
import {
  resolveAiGenerationAccess,
  resolveAiStageAccess,
} from '../../../packages/database/src/ai-config-store.mjs';

const keyring = { active: 'local', keys: { local: Buffer.alloc(32, 9).toString('base64') } };
const draft = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Offline draft',
  protocol: 'openai-compatible',
  base_url: 'https://example.com/v1',
  enabled: false,
  settings: {
    timeout_ms: 10000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 0,
    output_price_microusd_per_million: 0,
  },
};

function fixture(localConfigurationDrafts, localProfileDrafts) {
  const calls = [];
  return {
    calls,
    execute: createAiAdminExecutor({
      keyring,
      allowedHosts: ['example.com'],
      ...(localConfigurationDrafts === undefined ? {} : { localConfigurationDrafts }),
      ...(localProfileDrafts === undefined ? {} : { localProfileDrafts }),
      pool: {
        async connect() {
          calls.push('database');
          throw new Error('Synthetic unavailable database');
        },
      },
      async invoke() {
        calls.push('provider');
        throw new Error('Provider must not be called');
      },
    }),
  };
}

test('keyless drafts require the trusted executor dependency, never a command field', async () => {
  for (const enabled of [undefined, false]) {
    const f = fixture(enabled);
    await assert.rejects(f.execute('create-connection', draft), { code: 'invalid_request' });
    await assert.rejects(
      f.execute('create-connection', { ...draft, localConfigurationDrafts: true }),
      { code: 'invalid_request' },
    );
    assert.deepEqual(f.calls, []);
  }
  const local = fixture(true);
  await assert.rejects(local.execute('create-connection', draft), { code: 'database_unavailable' });
  assert.deepEqual(local.calls, ['database'], 'Local draft reaches only configuration persistence');
});

test('trusted local draft mode blocks all probes before storage or provider execution', async () => {
  for (const kind of ['models', 'connection', 'structured_output', 'tool_calling']) {
    const f = fixture(true);
    await assert.rejects(f.execute('run-probe', { kind }), { code: 'local_provider_disabled' });
    assert.deepEqual(f.calls, []);
  }
});

const profileDraft = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Local real AI profile draft',
  stages: Object.fromEntries(
    ['extract', 'verify', 'analyze'].map((stage) => [
      stage,
      {
        connection_id: draft.id,
        connection_revision: 1,
        model_id: 'provider/synthetic-model',
        prompt: `Synthetic ${stage} prompt`,
        temperature: 0.7,
        max_output_tokens: stage === 'extract' ? 50000 : 2048,
        require_tools: false,
      },
    ]),
  ),
};

// Exercise the real executor and profile store against synthetic persisted rows.
// This adapter opens no database connection and cannot invoke a real provider.
function profileFixture(localProfileDrafts) {
  const state = {
    connections: [{ ...draft, revision: 1, enabled: true, encrypted_key: { synthetic: true } }],
    profiles: [],
    history: [],
  };
  const calls = [];
  let snapshot;
  const client = {
    release() {},
    async query(sql, args = []) {
      if (sql.startsWith('BEGIN')) snapshot = globalThis.structuredClone(state);
      else if (sql === 'ROLLBACK') Object.assign(state, snapshot);
      const tag = sql.match(/\/\* ai:([^ ]+) \*\//)?.[1];
      if (!tag) return { rows: [] };
      calls.push(tag);
      switch (tag) {
        case 'profile-create-lock':
          return { rows: [] };
        case 'profile':
          return { rows: state.profiles.filter((row) => row.id === args[0]) };
        case 'profiles':
          return { rows: state.profiles };
        case 'profile-reference-connection':
        case 'profile-connection':
          return { rows: state.connections.filter((row) => row.id === args[0]) };
        case 'profile-probes':
          return { rows: [] };
        case 'profile-create':
        case 'profile-update': {
          const row = {
            id: args[0],
            revision: args[1],
            name: args[2],
            stages: JSON.parse(args[3]),
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          };
          state.profiles = [...state.profiles.filter((item) => item.id !== row.id), row];
          return { rows: [row] };
        }
        case 'profile-history-insert':
          state.history.push(JSON.parse(args[2]));
          return { rows: [] };
        default:
          throw new Error(`Unexpected synthetic query: ${tag}`);
      }
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const execute = createAiAdminExecutor({
    pool,
    keyring,
    allowedHosts: ['example.com'],
    ...(localProfileDrafts === undefined ? {} : { localProfileDrafts }),
    async invoke() {
      calls.push('provider');
      throw new Error('Provider must not be called');
    },
  });
  return { execute, pool, state, calls };
}

test('local real AI can save and read unready profile revisions without provider calls', async () => {
  const f = profileFixture(true);
  const created = await f.execute('save-profile', profileDraft);
  assert.equal(created.profile.revision, 1);
  assert.equal(created.profile.readiness.ready, false);
  assert.deepEqual(created.profile.readiness.reasons, [
    'extract:connection_required',
    'extract:structured_output_required',
    'verify:connection_required',
    'verify:structured_output_required',
    'analyze:connection_required',
    'analyze:structured_output_required',
  ]);
  assert.deepEqual(await f.execute('list-profiles', {}), { profiles: [created.profile] });
  const revised = await f.execute('save-profile', {
    ...profileDraft,
    expected_revision: 1,
    name: 'Revised local draft',
  });
  assert.equal(revised.profile.revision, 2);
  assert.equal(revised.profile.readiness.ready, false);
  assert.equal(f.state.history.length, 2);
  assert.equal(f.calls.includes('provider'), false);
  for (const stageName of ['extract', 'verify', 'analyze']) {
    const input = {
      pool: f.pool,
      id: profileDraft.id,
      revision: 2,
      stageName,
      allowedHosts: ['example.com'],
    };
    await assert.rejects(
      stageName === 'extract' ? resolveAiGenerationAccess(input) : resolveAiStageAccess(input),
      { code: 'profile_not_ready' },
    );
  }
});

test('local profile drafts retain existing connection references and revision checks', async () => {
  const f = profileFixture(true);
  f.state.connections[0].revision = 2;
  await assert.rejects(f.execute('save-profile', profileDraft), { code: 'revision_conflict' });
  f.state.connections.length = 0;
  await assert.rejects(f.execute('save-profile', profileDraft), { code: 'connection_unavailable' });
  assert.deepEqual(f.state.profiles, []);
  assert.deepEqual(f.state.history, []);
  assert.equal(f.calls.includes('provider'), false);
});

test('production saves still require capability proofs and payload flags cannot bypass them', async () => {
  for (const enabled of [undefined, false]) {
    const f = profileFixture(enabled);
    await assert.rejects(f.execute('save-profile', profileDraft), { code: 'profile_not_ready' });
    for (const flag of ['localProfileDrafts', 'localConfigurationDrafts']) {
      await assert.rejects(f.execute('save-profile', { ...profileDraft, [flag]: true }), {
        code: 'invalid_request',
      });
    }
    assert.deepEqual(f.state.profiles, []);
    assert.deepEqual(f.state.history, []);
    assert.equal(f.calls.includes('provider'), false);
  }
});

test('local profile drafts do not permit keyless connections or unapproved hosts', async () => {
  const f = fixture(false, true);
  await assert.rejects(f.execute('create-connection', draft), { code: 'invalid_request' });
  await assert.rejects(
    f.execute('create-connection', {
      ...draft,
      api_key: 'synthetic-test-key',
      base_url: 'https://unapproved.example/v1',
    }),
    { code: 'invalid_configuration' },
  );
  assert.deepEqual(f.calls, []);
});

test('local profile drafts keep real-mode probe admission enabled', async () => {
  for (const kind of ['models', 'connection', 'structured_output', 'tool_calling']) {
    const f = fixture(false, true);
    await assert.rejects(
      f.execute('run-probe', {
        id: '33333333-3333-4333-8333-333333333333',
        connection_id: draft.id,
        connection_revision: 1,
        kind,
        ...(kind === 'models' ? {} : { model_id: 'provider/synthetic-model' }),
      }),
      { code: 'database_unavailable' },
    );
    assert.deepEqual(f.calls, ['database'], 'Probe reaches its existing storage admission');
  }
});
