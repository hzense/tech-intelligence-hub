import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createAiAdminExecutor } from '../lib/admin-ai-service.ts';

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

function fixture(localConfigurationDrafts) {
  const calls = [];
  return {
    calls,
    execute: createAiAdminExecutor({
      keyring,
      allowedHosts: ['example.com'],
      ...(localConfigurationDrafts === undefined ? {} : { localConfigurationDrafts }),
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
