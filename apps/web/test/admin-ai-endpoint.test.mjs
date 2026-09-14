import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiProviderPresets,
  aiPresetForEndpoint,
  aiEndpointChanged,
  inspectAiEndpoint,
  aiEndpointMessage,
} from '../lib/admin-ai-endpoint.ts';

const allowedHosts = ['ai-gateway.vercel.sh', 'openrouter.ai', 'example.com'];

test('provider presets fill exact base paths without conferring server authorization', () => {
  assert.deepEqual(
    aiProviderPresets.map(({ id, baseUrl }) => [id, baseUrl]),
    [
      ['vercel-ai-gateway', 'https://ai-gateway.vercel.sh/v1'],
      ['openrouter', 'https://openrouter.ai/api/v1'],
    ],
  );
  for (const preset of aiProviderPresets) {
    assert.deepEqual(inspectAiEndpoint(preset.baseUrl, []), {
      valid: false,
      issue: 'unapproved_host',
    });
    assert.deepEqual(inspectAiEndpoint(preset.baseUrl, allowedHosts), { valid: true });
  }
});

test('canonical same endpoint preserves keys while real host or path changes require new keys', () => {
  for (const [previous, next] of [
    ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/'],
    ['https://openrouter.ai/api/v1', 'https://OPENROUTER.AI:443/api/v1'],
    ['invalid', 'invalid'],
  ])
    assert.equal(aiEndpointChanged(previous, next), false);
  for (const [previous, next] of [
    ['https://openrouter.ai/api/v1', 'https://ai-gateway.vercel.sh/v1'],
    ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v2'],
    ['https://openrouter.ai/api/v1', 'invalid'],
    ['https://openrouter.ai/api/v1', ''],
  ])
    assert.equal(aiEndpointChanged(previous, next), true);
});

test('manual endpoints identify matching presets but preserve custom paths', () => {
  assert.equal(aiPresetForEndpoint('https://openrouter.ai/api/v1/'), 'openrouter');
  assert.equal(aiPresetForEndpoint('https://ai-gateway.vercel.sh:443/v1'), 'vercel-ai-gateway');
  assert.equal(aiPresetForEndpoint('https://example.com/custom/v1'), 'custom');
  assert.equal(aiPresetForEndpoint('https://openrouter.ai/api/v2'), 'custom');
  assert.equal(aiPresetForEndpoint('not a URL'), 'custom');
});

test('stored endpoints are not normalized twice when detecting edits and matching presets', () => {
  const stored = 'https://openrouter.ai/api/v1/';
  assert.equal(aiEndpointChanged(stored, stored, stored), false);
  assert.equal(aiEndpointChanged(stored, `${stored}/`, stored), false);
  assert.equal(aiEndpointChanged(stored, 'https://openrouter.ai/api/v1', stored), true);
  assert.equal(aiEndpointChanged(stored, 'https://ai-gateway.vercel.sh/v1', stored), true);
  assert.equal(aiPresetForEndpoint(stored, stored), 'custom');
  assert.equal(aiPresetForEndpoint('https://openrouter.ai/api/v1', stored), 'openrouter');
  // A return to the unchanged stored value is a destination change from the preset too.
  assert.equal(aiEndpointChanged('https://openrouter.ai/api/v1', stored, stored), true);
  // Raw new-connection input still follows the server's one-time normalization.
  assert.equal(aiEndpointChanged(stored, 'https://openrouter.ai/api/v1'), false);
});

for (const [name, value, issue] of [
  ['empty', '', 'required'],
  ['missing scheme', 'openrouter.ai/api/v1', 'invalid_url'],
  ['space', ' https://openrouter.ai/api/v1', 'invalid_url'],
  ['newline', 'https://openrouter.ai/api/v1\n', 'invalid_url'],
  ['control', 'https://openrouter.ai/api/\u0000v1', 'invalid_url'],
  ['backslash', 'https://openrouter.ai\\api\\v1', 'invalid_url'],
  ['oversized', `https://example.com/${'a'.repeat(2048)}`, 'invalid_url'],
  ['http', 'http://openrouter.ai/api/v1', 'https_required'],
  ['userinfo', 'https://synthetic-user:synthetic-secret@openrouter.ai/api/v1', 'private_fields'],
  ['query', 'https://openrouter.ai/api/v1?key=synthetic-secret', 'private_fields'],
  ['empty query', 'https://openrouter.ai/api/v1?', 'private_fields'],
  ['fragment', 'https://openrouter.ai/api/v1#synthetic-secret', 'private_fields'],
  ['other port', 'https://openrouter.ai:8443/api/v1', 'invalid_port'],
  ['IPv4', 'https://127.0.0.1/v1', 'invalid_host'],
  ['abbreviated IPv4', 'https://127.1/v1', 'invalid_host'],
  ['IPv6', 'https://[::1]/v1', 'invalid_host'],
  ['localhost', 'https://localhost/v1', 'invalid_host'],
  ['localhost suffix', 'https://api.localhost/v1', 'invalid_host'],
  ['local suffix', 'https://api.local/v1', 'invalid_host'],
  ['encoded slash', 'https://openrouter.ai/api%2fv1', 'encoded_path'],
  ['encoded backslash', 'https://openrouter.ai/api%5Cv1', 'encoded_path'],
  ['encoded null', 'https://openrouter.ai/api%00v1', 'encoded_path'],
  ['unapproved host', 'https://other.example/v1', 'unapproved_host'],
  ['unapproved subdomain', 'https://api.openrouter.ai/api/v1', 'unapproved_host'],
]) {
  test(`browser URL guidance rejects ${name} without echoing input`, () => {
    const guidance = inspectAiEndpoint(value, allowedHosts);
    assert.deepEqual(guidance, { valid: false, issue });
    const message = aiEndpointMessage(guidance);
    assert.ok(message.length > 0);
    assert.equal(message.includes('synthetic-secret'), false);
    assert.equal(message.includes('synthetic-user'), false);
    assert.equal(message.includes('key='), false);
    assert.equal(message.includes(value) && value.length > 0, false);
  });
}

for (const [value, suggestion] of [
  ['https://openrouter.ai/api/v1/chat/completions', 'https://openrouter.ai/api/v1'],
  ['https://openrouter.ai/api/v1/models/', 'https://openrouter.ai/api/v1'],
  ['https://ai-gateway.vercel.sh/v1/models', 'https://ai-gateway.vercel.sh/v1'],
  ['https://example.com/custom/v2/chat/completions/', 'https://example.com/custom/v2'],
  ['https://example.com/models', 'https://example.com'],
]) {
  test(`full request endpoint has an explicit base-path suggestion: ${value}`, () => {
    const guidance = inspectAiEndpoint(value, allowedHosts);
    assert.deepEqual(guidance, {
      valid: false,
      issue: 'request_endpoint',
      suggestedBaseUrl: suggestion,
    });
    assert.match(aiEndpointMessage(guidance), /\/chat\/completions.*\/models/);
    assert.match(aiEndpointMessage(guidance), /未自动更改/);
    assert.equal(aiEndpointMessage(guidance).includes(value), false);
    assert.deepEqual(inspectAiEndpoint(suggestion, allowedHosts), { valid: true });
  });
}

test('query/userinfo rejection never offers a suggested URL carrying secrets', () => {
  for (const value of [
    'https://synthetic-user:synthetic-secret@openrouter.ai/api/v1/models',
    'https://openrouter.ai/api/v1/models?key=synthetic-secret',
  ]) {
    const guidance = inspectAiEndpoint(value, allowedHosts);
    assert.deepEqual(guidance, { valid: false, issue: 'private_fields' });
    assert.equal(JSON.stringify(guidance).includes('synthetic-secret'), false);
  }
});

test('custom authorized bases are not silently changed and the guidance is not a provider probe', () => {
  for (const value of [
    'https://example.com',
    'https://example.com/private/v2',
    'https://openrouter.ai/api/v1',
    'https://example.com/models-alternative',
  ]) {
    const guidance = inspectAiEndpoint(value, allowedHosts);
    assert.deepEqual(guidance, { valid: true });
    assert.equal(aiEndpointMessage(guidance), '');
  }
  assert.match(
    aiEndpointMessage(inspectAiEndpoint('https://example.com/v1', [])),
    /HZENSE_AI_ALLOWED_HOSTS/,
  );
  assert.match(aiEndpointMessage(inspectAiEndpoint('https://example.com/v1', [])), /重新部署/);
});
