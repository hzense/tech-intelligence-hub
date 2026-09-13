import { Buffer } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';
import { encryptAiKey, decryptAiKey, readAiKeyring } from '../src/ai-config-crypto.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ring = { active: 'v1', keys: { v1: Buffer.alloc(32, 1).toString('base64') } };
describe('AI envelope encryption', () => {
  it.each([
    ['short', id],
    ['synthetic-api-key', 'invalid-id'],
  ])('reports invalid key or identity as an invalid request', (apiKey, connectionId) => {
    expect(() => encryptAiKey(apiKey, connectionId, ring)).toThrow('invalid_request');
    expect(() => encryptAiKey(apiKey, connectionId, undefined)).toThrow('invalid_request');
  });
  it('reports keyring failures only after validating the request', () => {
    expect(() => encryptAiKey('synthetic-api-key', id, undefined)).toThrow('keyring_unavailable');
  });
  it('uses independent random keys/IVs without returning plaintext or tail', () => {
    const first = encryptAiKey('synthetic-api-key', id, ring),
      second = encryptAiKey('synthetic-api-key', id, ring);
    expect(first).not.toEqual(second);
    expect(first.iv).not.toBe(first.wrap_iv);
    expect(JSON.stringify(first)).not.toContain('synthetic');
    expect(decryptAiKey(first, id, ring)).toBe('synthetic-api-key');
  });
  it('binds data and wrapped DEK to the connection ID', () => {
    const encrypted = encryptAiKey('synthetic-api-key', id, ring);
    expect(() => decryptAiKey(encrypted, other, ring)).toThrow('key_unavailable');
  });
  it.each(['ciphertext', 'tag', 'iv', 'wrapped_key', 'wrap_iv', 'wrap_tag'])(
    'rejects modified %s',
    (field) => {
      const encrypted = encryptAiKey('synthetic-api-key', id, ring);
      encrypted[field] = (encrypted[field][0] === 'A' ? 'B' : 'A') + encrypted[field].slice(1);
      expect(() => decryptAiKey(encrypted, id, ring)).toThrow('key_unavailable');
    },
  );
  it('decrypts old key IDs while every new encryption uses active', () => {
    const old = encryptAiKey('synthetic-api-key', id, ring);
    const rotated = {
      active: 'v2',
      keys: { ...ring.keys, v2: Buffer.alloc(32, 2).toString('base64') },
    };
    expect(decryptAiKey(old, id, rotated)).toBe('synthetic-api-key');
    expect(encryptAiKey('new-synthetic', id, rotated).key_id).toBe('v2');
    expect(() => decryptAiKey(old, id, { active: 'v2', keys: { v2: rotated.keys.v2 } })).toThrow(
      'key_unavailable',
    );
  });
  it.each([
    undefined,
    '{}',
    'bad json',
    { active: 'missing', keys: ring.keys },
    { ...ring, debug: true },
    { active: 'v1', keys: { v1: 'a'.repeat(44) } },
  ])('fails closed on invalid keyring %j', (value) => {
    expect(() => readAiKeyring(value)).toThrow('keyring_unavailable');
  });
  it('does not evaluate hostile keyring accessors or proxy traps', () => {
    const get = vi.fn();
    const keys = {};
    Object.defineProperty(keys, 'v1', { get });
    expect(() => readAiKeyring({ active: 'v1', keys })).toThrow('keyring_unavailable');
    expect(get).not.toHaveBeenCalled();
    const ownKeys = vi.fn();
    expect(() => readAiKeyring({ active: 'v1', keys: new Proxy({}, { ownKeys }) })).toThrow(
      'keyring_unavailable',
    );
    expect(ownKeys).not.toHaveBeenCalled();
  });
});
