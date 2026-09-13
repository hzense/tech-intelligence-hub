import { describe, it, expect, vi } from 'vitest';
import {
  parseAiConnectionCreate,
  parseAiConnectionUpdate,
  parseAiProfileSave,
  parseAiProbeRequest,
} from '../src/ai-config-contract.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const hosts = ['example.com'];
const settings = {
  timeout_ms: 10000,
  max_concurrency: 1,
  daily_budget_microusd: 1000000,
  input_price_microusd_per_million: 1000000,
  output_price_microusd_per_million: 1000000,
};
const create = () => ({
  id,
  name: 'Test',
  protocol: 'openai-compatible',
  base_url: 'https://example.com/v1/',
  enabled: true,
  settings: { ...settings },
  api_key: 'synthetic-test-key',
});
const stage = () => ({
  connection_id: id,
  connection_revision: 1,
  model_id: 'test/model',
  prompt: 'A bounded test',
  temperature: 0,
  max_output_tokens: 128,
  require_tools: false,
});
describe('AI configuration request boundary', () => {
  it('canonicalizes an approved HTTPS endpoint and accepts a complete profile', () => {
    expect(parseAiConnectionCreate(create(), hosts).base_url).toBe('https://example.com/v1');
    expect(
      parseAiProfileSave({
        name: 'Test',
        stages: { extract: stage(), verify: stage(), analyze: stage() },
      }).stages.verify.model_id,
    ).toBe('test/model');
  });
  it.each([
    'http://example.com/v1',
    'https://other.example/v1',
    'https://example.com@127.0.0.1/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://example.com:444/v1',
    'https://example.com/v1?secret=x',
    'https://example.com/v1#secret',
    'https://example.com/%2fadmin',
  ])('rejects non-approved endpoint %s', (base_url) => {
    expect(() => parseAiConnectionCreate({ ...create(), base_url }, hosts)).toThrow();
  });
  it.each([
    'timeout_ms',
    'max_concurrency',
    'daily_budget_microusd',
    'input_price_microusd_per_million',
    'output_price_microusd_per_million',
  ])('rejects nonnumeric %s', (field) => {
    expect(() =>
      parseAiConnectionCreate({ ...create(), settings: { ...settings, [field]: '100' } }, hosts),
    ).toThrow();
  });
  it.each(['apiKey', 'encrypted_key', 'verified', 'capabilities', 'models', 'headers'])(
    'rejects untrusted %s',
    (field) => {
      expect(() => parseAiConnectionCreate({ ...create(), [field]: true }, hosts)).toThrow();
    },
  );
  it.each([
    'short',
    '1234567',
    '1234 5678',
    '12345678\n',
    '12345678\t',
    '密钥12345678',
    '12345678' + String.fromCharCode(127),
    'x'.repeat(4097),
  ])('rejects a key incompatible with the bounded provider Authorization header', (api_key) => {
    expect(() => parseAiConnectionCreate({ ...create(), api_key }, hosts)).toThrow();
  });
  it('rejects getters and proxies without execution', () => {
    const getter = vi.fn();
    const request = create();
    Object.defineProperty(request, 'api_key', { get: getter });
    expect(() => parseAiConnectionCreate(request, hosts)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const ownKeys = vi.fn();
    expect(() => parseAiConnectionCreate(new Proxy(create(), { ownKeys }), hosts)).toThrow();
    expect(ownKeys).not.toHaveBeenCalled();
  });
  it('requires CAS for updates and rejects contradictory revocation', () => {
    expect(() => parseAiConnectionUpdate({ id, name: 'Next' }, hosts)).toThrow();
    expect(() => parseAiConnectionUpdate({ id, expected_revision: 1 }, hosts)).toThrow();
    expect(() =>
      parseAiConnectionUpdate(
        { id, expected_revision: 1, revoke_key: true, api_key: 'other' },
        hosts,
      ),
    ).toThrow();
    expect(() =>
      parseAiConnectionUpdate({ id, expected_revision: 1, revoke_key: true, enabled: true }, hosts),
    ).toThrow();
    expect(
      parseAiConnectionUpdate({ id, expected_revision: 1, revoke_key: true }, hosts).revoke_key,
    ).toBe(true);
  });
  it.each([{ id }, { expected_revision: 1 }, { id: '', expected_revision: 1 }])(
    'requires profile identity and revision together %j',
    (identity) => {
      expect(() =>
        parseAiProfileSave({
          ...identity,
          name: 'Test',
          stages: { extract: stage(), verify: stage(), analyze: stage() },
        }),
      ).toThrow();
    },
  );
  it.each([
    { temperature: 3 },
    { max_output_tokens: 127 },
    { require_tools: 'true' },
    { connection_revision: 0 },
    { verified: true },
    { prompt: '' },
  ])('rejects invalid stage %j', (patch) => {
    expect(() =>
      parseAiProfileSave({
        name: 'Test',
        stages: { extract: { ...stage(), ...patch }, verify: stage(), analyze: stage() },
      }),
    ).toThrow();
  });
  it('requires explicit models for paid probes and forbids a model for model-list reads', () => {
    const request = { id, connection_id: id, connection_revision: 1, kind: 'connection' };
    expect(() => parseAiProbeRequest(request)).toThrow();
    expect(parseAiProbeRequest({ ...request, model_id: 'provider/model' }).model_id).toBe(
      'provider/model',
    );
    expect(() =>
      parseAiProbeRequest({ ...request, kind: 'models', model_id: 'provider/model' }),
    ).toThrow();
    expect(parseAiProbeRequest({ ...request, kind: 'models' }).kind).toBe('models');
  });
  it.each(['model\nheader', 'model name', '<script>', 'model?token=secret', '../model', ''])(
    'rejects noncanonical model ID %j',
    (model_id) => {
      expect(() =>
        parseAiProbeRequest({
          id,
          connection_id: id,
          connection_revision: 1,
          kind: 'connection',
          model_id,
        }),
      ).toThrow();
    },
  );
});
