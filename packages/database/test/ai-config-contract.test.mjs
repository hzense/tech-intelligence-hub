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
  it('canonicalizes negative zero consistently with JSON persistence', () => {
    const connection = parseAiConnectionCreate(
      {
        ...create(),
        settings: {
          ...settings,
          input_price_microusd_per_million: -0,
          output_price_microusd_per_million: -0,
        },
      },
      hosts,
    );
    const profile = parseAiProfileSave({
      name: 'Test',
      stages: { extract: { ...stage(), temperature: -0 }, verify: stage(), analyze: stage() },
    });
    expect(connection.settings.input_price_microusd_per_million).toBe(0);
    expect(connection.settings.output_price_microusd_per_million).toBe(0);
    expect(profile.stages.extract.temperature).toBe(0);
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
  it('accepts a stable client ID for creation and requires revisions only for updates', () => {
    const value = {
      id,
      name: 'Test',
      stages: { extract: stage(), verify: stage(), analyze: stage() },
    };
    expect(parseAiProfileSave(value)).toEqual(value);
    expect(parseAiProfileSave({ ...value, expected_revision: 1 })).toEqual({
      ...value,
      expected_revision: 1,
    });
  });
  it.each([
    { expected_revision: 1 },
    { id: '', expected_revision: 1 },
    { id: '' },
    { id, expected_revision: undefined },
    { id, expected_revision: 0 },
  ])('rejects invalid profile create/update identity %j', (identity) => {
    expect(() =>
      parseAiProfileSave({
        ...identity,
        name: 'Test',
        stages: { extract: stage(), verify: stage(), analyze: stage() },
      }),
    ).toThrow();
  });
  it('accepts 50000 output tokens and preserves existing 8192 revisions', () => {
    for (const max_output_tokens of [8192, 50000]) {
      const value = parseAiProfileSave({
        name: 'Test',
        stages: {
          extract: { ...stage(), max_output_tokens },
          verify: stage(),
          analyze: stage(),
        },
      });
      expect(value.stages.extract.max_output_tokens).toBe(max_output_tokens);
    }
  });
  it.each(['verify', 'analyze'])('retains the 8192 cap for %s', (name) => {
    const stages = { extract: stage(), verify: stage(), analyze: stage() };
    stages[name].max_output_tokens = 8192;
    expect(parseAiProfileSave({ name: 'Test', stages }).stages[name].max_output_tokens).toBe(8192);
    for (const limit of [8193, 50000]) {
      stages[name].max_output_tokens = limit;
      expect(() => parseAiProfileSave({ name: 'Test', stages })).toThrow();
    }
  });
  it.each([
    { temperature: 3 },
    { max_output_tokens: 127 },
    { max_output_tokens: 50001 },
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
  it.each([
    '~openai/gpt-astra-latest',
    '~openai/gpt-sol-latest',
    '~openai/gpt-terra-latest',
    '~openai/gpt-luna-latest',
  ])('preserves an exact alias in probe requests and all profile stages: %s', (model_id) => {
    const request = { id, connection_id: id, connection_revision: 1, kind: 'connection', model_id };
    expect(parseAiProbeRequest(request).model_id).toBe(model_id);
    const stages = Object.fromEntries(
      ['extract', 'verify', 'analyze'].map((name) => [name, { ...stage(), model_id }]),
    );
    const profile = parseAiProfileSave({ name: 'Alias profile', stages });
    for (const value of Object.values(profile.stages)) expect(value.model_id).toBe(model_id);
  });
  it.each([
    'model\nheader',
    'model name',
    '<script>',
    'model?token=secret',
    '../model',
    '',
    '~',
    '~~provider/model',
    '~provider/~model',
    '~provider/model+variant',
    '~provider/model@version',
    '~provider/model\n',
  ])('rejects noncanonical model ID %j', (model_id) => {
    expect(() =>
      parseAiProbeRequest({
        id,
        connection_id: id,
        connection_revision: 1,
        kind: 'connection',
        model_id,
      }),
    ).toThrow();
    expect(() =>
      parseAiProfileSave({
        name: 'Invalid alias profile',
        stages: { extract: { ...stage(), model_id }, verify: stage(), analyze: stage() },
      }),
    ).toThrow();
  });
});
