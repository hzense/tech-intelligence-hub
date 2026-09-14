import { types } from 'node:util';
import { isIP } from 'node:net';
import { URL } from 'node:url';
import { isValidAiModelId } from './ai-model-id.mjs';

export const aiConfigErrorCodes = Object.freeze([
  'invalid_request',
  'invalid_configuration',
  'not_found',
  'revision_conflict',
  'request_id_conflict',
  'connection_unavailable',
  'key_unavailable',
  'keyring_unavailable',
  'endpoint_key_required',
  'profile_not_ready',
  'daily_budget_exceeded',
  'daily_probe_limit',
  'concurrency_limit',
  'database_unavailable',
  'probe_outcome_unknown',
]);
export class AiConfigError extends Error {
  constructor(code) {
    const safe = aiConfigErrorCodes.includes(code) ? code : 'invalid_request';
    super(safe);
    this.name = 'AiConfigError';
    this.code = safe;
  }
}
export const aiFail = (code = 'invalid_request') => {
  throw new AiConfigError(code);
};
export function aiObject(value, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    aiFail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    aiFail();
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value')) aiFail();
    out[key] = d.value;
  }
  return out;
}
export function aiText(value, max = 200, { empty = false } = {}) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    [...value].some((char) => {
      const c = char.charCodeAt(0);
      return c === 127 || (c < 32 && ![9, 10, 13].includes(c));
    })
  )
    aiFail();
  return value;
}
export function aiUuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    aiFail();
  return value.toLowerCase();
}
export function aiModelId(value) {
  if (!isValidAiModelId(value)) aiFail();
  return value;
}
export function aiInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) aiFail();
  return value === 0 ? 0 : value;
}
const bool = (value) => {
  if (typeof value !== 'boolean') aiFail();
  return value;
};
export function parseAiSettings(value) {
  const v = aiObject(value, [
    'timeout_ms',
    'max_concurrency',
    'daily_budget_microusd',
    'input_price_microusd_per_million',
    'output_price_microusd_per_million',
  ]);
  return {
    timeout_ms: aiInteger(v.timeout_ms, 3000, 20000),
    max_concurrency: aiInteger(v.max_concurrency, 1, 3),
    daily_budget_microusd: aiInteger(v.daily_budget_microusd, 1, 100000000),
    input_price_microusd_per_million: aiInteger(v.input_price_microusd_per_million, 0, 1e12),
    output_price_microusd_per_million: aiInteger(v.output_price_microusd_per_million, 0, 1e12),
  };
}
export function validateAiBaseUrl(value, allowedHosts) {
  aiText(value, 2048);
  let url;
  try {
    url = new URL(value);
  } catch {
    aiFail('invalid_configuration');
  }
  const hosts = allowedHosts instanceof Set ? [...allowedHosts] : allowedHosts;
  if (
    !Array.isArray(hosts) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.local') ||
    !hosts.includes(url.hostname) ||
    /%2f|%5c|%00/i.test(url.pathname)
  )
    aiFail('invalid_configuration');
  return url.toString().replace(/\/$/, '');
}
export function parseAiApiKey(value) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 4096 ||
    [...value].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126)
  )
    aiFail();
  return value;
}
function connectionFields(v, hosts) {
  const out = { ...v };
  if ('name' in v) out.name = aiText(v.name, 120);
  if ('protocol' in v && v.protocol !== 'openai-compatible') aiFail();
  if ('base_url' in v) out.base_url = validateAiBaseUrl(v.base_url, hosts);
  if ('enabled' in v) out.enabled = bool(v.enabled);
  if ('settings' in v) out.settings = parseAiSettings(v.settings);
  if ('api_key' in v) out.api_key = parseAiApiKey(v.api_key);
  return out;
}
export function parseAiConnectionCreate(input, hosts) {
  const v = connectionFields(
    aiObject(input, ['name', 'protocol', 'base_url', 'enabled', 'settings', 'api_key'], ['id']),
    hosts,
  );
  if ('id' in v) v.id = aiUuid(v.id);
  return v;
}
export function parseAiConnectionUpdate(input, hosts) {
  const v = connectionFields(
    aiObject(
      input,
      ['id', 'expected_revision'],
      ['name', 'protocol', 'base_url', 'enabled', 'settings', 'api_key', 'revoke_key'],
    ),
    hosts,
  );
  v.id = aiUuid(v.id);
  v.expected_revision = aiInteger(v.expected_revision, 1, 2147483646);
  if (Object.keys(v).length === 2) aiFail();
  if ('revoke_key' in v && (v.revoke_key !== true || 'api_key' in v || v.enabled === true))
    aiFail();
  return v;
}
export const aiProbeKinds = Object.freeze([
  'models',
  'connection',
  'structured_output',
  'tool_calling',
]);
export function parseAiProbeRequest(input) {
  const v = aiObject(input, ['id', 'connection_id', 'connection_revision', 'kind'], ['model_id']);
  v.id = aiUuid(v.id);
  v.connection_id = aiUuid(v.connection_id);
  v.connection_revision = aiInteger(v.connection_revision, 1, 2147483647);
  if (!aiProbeKinds.includes(v.kind)) aiFail();
  if (v.kind === 'models') {
    if ('model_id' in v) aiFail();
  } else v.model_id = aiModelId(v.model_id);
  return v;
}
export function parseAiProfileSave(input) {
  const v = aiObject(input, ['name', 'stages'], ['id', 'expected_revision']);
  if ('id' in v) v.id = aiUuid(v.id);
  if ('expected_revision' in v) {
    if (!('id' in v)) aiFail();
    v.expected_revision = aiInteger(v.expected_revision, 1, 2147483646);
  }
  v.name = aiText(v.name, 120);
  const stages = aiObject(v.stages, ['extract', 'verify', 'analyze']);
  for (const name of Object.keys(stages)) {
    const s = aiObject(stages[name], [
      'connection_id',
      'connection_revision',
      'model_id',
      'prompt',
      'temperature',
      'max_output_tokens',
      'require_tools',
    ]);
    s.connection_id = aiUuid(s.connection_id);
    s.connection_revision = aiInteger(s.connection_revision, 1, 2147483647);
    s.model_id = aiModelId(s.model_id);
    s.prompt = aiText(s.prompt, 16000);
    if (
      typeof s.temperature !== 'number' ||
      !Number.isFinite(s.temperature) ||
      s.temperature < 0 ||
      s.temperature > 2
    )
      aiFail();
    // JSON and jsonb store negative zero as zero; compare canonical requests on replay.
    if (s.temperature === 0) s.temperature = 0;
    s.max_output_tokens = aiInteger(s.max_output_tokens, 128, 8192);
    s.require_tools = bool(s.require_tools);
    stages[name] = s;
  }
  v.stages = stages;
  return v;
}
