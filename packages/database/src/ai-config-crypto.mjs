import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { types } from 'node:util';
import { Buffer } from 'node:buffer';
import { aiObject, aiFail, aiUuid, parseAiApiKey } from './ai-config-contract.mjs';

function bytes(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    aiFail('keyring_unavailable');
  const out = Buffer.from(value, 'base64');
  if (out.toString('base64') !== value || (length !== undefined && out.length !== length))
    aiFail('keyring_unavailable');
  return out;
}
export function readAiKeyring(raw) {
  try {
    const v = aiObject(typeof raw === 'string' ? JSON.parse(raw) : raw, ['active', 'keys']);
    if (typeof v.active !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(v.active)) aiFail();
    if (!v.keys || typeof v.keys !== 'object' || types.isProxy(v.keys)) aiFail();
    const names = Reflect.ownKeys(v.keys);
    const keys = aiObject(v.keys, [], names);
    if (names.length < 1 || names.length > 16 || !names.includes(v.active)) aiFail();
    for (const name of names) {
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) aiFail();
      bytes(keys[name], 32);
    }
    return Object.freeze({ active: v.active, keys: Object.freeze({ ...keys }) });
  } catch {
    aiFail('keyring_unavailable');
  }
}
function seal(plaintext, key, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
function open(value, key, aad) {
  const iv = bytes(value.iv, 12),
    tag = bytes(value.tag, 16),
    ciphertext = bytes(value.ciphertext);
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]);
}
export function encryptAiKey(apiKey, connectionId, keyring) {
  try {
    parseAiApiKey(apiKey);
    aiUuid(connectionId);
    const ring = readAiKeyring(keyring),
      aad = Buffer.from(`hzense:ai-connection:${connectionId}:v1`);
    const dek = randomBytes(32);
    try {
      const body = seal(Buffer.from(apiKey), dek, aad);
      const wrap = seal(
        dek,
        bytes(ring.keys[ring.active], 32),
        Buffer.concat([aad, Buffer.from(':dek')]),
      );
      return {
        v: 1,
        key_id: ring.active,
        ...body,
        wrapped_key: wrap.ciphertext,
        wrap_iv: wrap.iv,
        wrap_tag: wrap.tag,
      };
    } finally {
      dek.fill(0);
    }
  } catch {
    aiFail('keyring_unavailable');
  }
}
export function decryptAiKey(envelope, connectionId, keyring) {
  try {
    aiUuid(connectionId);
    const v = aiObject(envelope, [
      'v',
      'key_id',
      'ciphertext',
      'iv',
      'tag',
      'wrapped_key',
      'wrap_iv',
      'wrap_tag',
    ]);
    if (v.v !== 1) aiFail();
    const ring = readAiKeyring(keyring);
    const aad = Buffer.from(`hzense:ai-connection:${connectionId}:v1`);
    const dek = open(
      { ciphertext: v.wrapped_key, iv: v.wrap_iv, tag: v.wrap_tag },
      bytes(ring.keys[v.key_id], 32),
      Buffer.concat([aad, Buffer.from(':dek')]),
    );
    try {
      if (dek.length !== 32) aiFail();
      return parseAiApiKey(open(v, dek, aad).toString('utf8'));
    } finally {
      dek.fill(0);
    }
  } catch {
    aiFail('key_unavailable');
  }
}
