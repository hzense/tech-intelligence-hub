import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  pendingAiProbeStorageKey,
  readPendingAiProbe,
  persistPendingAiProbe,
  clearPendingAiProbe,
} from '../lib/admin-ai-pending.ts';

const fixture = (kind = 'connection') => ({
  id: '00000000-0000-4000-8000-000000000001',
  connection_id: '00000000-0000-4000-8000-000000000002',
  connection_revision: 3,
  kind,
  ...(kind === 'models' ? {} : { model_id: 'provider/fixture-model' }),
});
const memory = () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  return { values, storage, factory: () => storage };
};

test('pending request persists only safe original request fields and survives remount/reload', () => {
  const first = memory();
  assert.deepEqual(readPendingAiProbe(first.factory), { available: true, request: null });
  for (const kind of ['models', 'connection', 'structured_output', 'tool_calling']) {
    assert.equal(persistPendingAiProbe(fixture(kind), first.factory), true);
    // A fresh helper call is independent of React state and does not allocate an ID.
    const restored = readPendingAiProbe(() => first.storage);
    assert.deepEqual(restored, { available: true, request: fixture(kind) });
    assert.deepEqual([...first.values.keys()], [pendingAiProbeStorageKey]);
    assert.deepEqual(Object.keys(JSON.parse(first.values.get(pendingAiProbeStorageKey))), [
      'version',
      'request',
    ]);
    assert.equal(clearPendingAiProbe(first.factory), true);
    assert.deepEqual(readPendingAiProbe(first.factory), { available: true, request: null });
  }
});

test('unavailable, corrupt and unrecognized storage always fails closed', () => {
  const first = memory();
  for (const raw of [
    '',
    'not-json',
    'null',
    '[]',
    'x'.repeat(1025),
    JSON.stringify({ version: 2, request: fixture() }),
    JSON.stringify({ version: 1, request: fixture(), extra: true }),
  ]) {
    first.values.set(pendingAiProbeStorageKey, raw);
    assert.deepEqual(readPendingAiProbe(first.factory), { available: false, request: null });
  }
  const denied = () => {
    throw new Error('storage denied');
  };
  assert.deepEqual(readPendingAiProbe(denied), { available: false, request: null });
  assert.equal(persistPendingAiProbe(fixture(), denied), false);
  assert.equal(clearPendingAiProbe(denied), false);
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    const storage = {
      ...first.storage,
      [method]: () => {
        throw new Error('storage denied');
      },
    };
    if (method === 'getItem')
      assert.deepEqual(
        readPendingAiProbe(() => storage),
        { available: false, request: null },
      );
    if (method !== 'removeItem')
      assert.equal(
        persistPendingAiProbe(fixture(), () => storage),
        false,
      );
    if (method !== 'setItem')
      assert.equal(
        clearPendingAiProbe(() => storage),
        false,
      );
  }
});

test('model aliases keep their exact ID when a pending test is saved and restored', () => {
  for (const kind of ['connection', 'structured_output', 'tool_calling']) {
    const first = memory();
    const request = { ...fixture(kind), model_id: '~provider/fixture-latest' };
    assert.equal(persistPendingAiProbe(request, first.factory), true);
    assert.deepEqual(readPendingAiProbe(first.factory), { available: true, request });
    assert.equal(persistPendingAiProbe(request, first.factory), true);
    assert.equal(
      persistPendingAiProbe({ ...request, model_id: 'provider/fixture-latest' }, first.factory),
      false,
    );
  }
});

test('unknown/private fields, malformed identities and invalid models are never stored or restored', () => {
  for (const invalid of [
    { ...fixture(), api_key: 'synthetic-secret' },
    { ...fixture(), connection: { api_key: 'synthetic-secret' } },
    { ...fixture(), id: 'invalid' },
    { ...fixture(), id: fixture().id + '\n' },
    { ...fixture(), connection_revision: 0 },
    { ...fixture(), connection_revision: 1.5 },
    { ...fixture(), connection_revision: 2147483648 },
    { ...fixture(), kind: 'execute' },
    { ...fixture(), model_id: 'model\n' },
    ...[
      '~',
      '~~provider/model',
      'provider/~model',
      '~provider/model\n',
      '~provider/model?key=x',
      '~provider/model#x',
      '~provider model',
      '~' + 'x'.repeat(200),
    ].map((model_id) => ({ ...fixture(), model_id })),
    { ...fixture(), model_id: 'x'.repeat(201) },
    { ...fixture('models'), model_id: 'provider/model' },
    { ...fixture(), model_id: undefined },
    { ...fixture(), [Symbol('secret')]: 'synthetic-secret' },
  ]) {
    const first = memory();
    assert.equal(persistPendingAiProbe(invalid, first.factory), false);
    assert.equal(first.values.size, 0);
    // Symbol/undefined are not JSON fields; all serializable malformed rows stay blocked.
    if (Object.getOwnPropertySymbols(invalid).length) continue;
    first.values.set(pendingAiProbeStorageKey, JSON.stringify({ version: 1, request: invalid }));
    assert.deepEqual(readPendingAiProbe(first.factory), { available: false, request: null });
  }
  const getters = { ...fixture() };
  Object.defineProperty(getters, 'api_key', {
    get: () => {
      throw Error('must not read');
    },
  });
  assert.equal(persistPendingAiProbe(getters, memory().factory), false);
});

test('silent failed writes and removals do not reopen paid controls', () => {
  const first = memory();
  assert.equal(
    persistPendingAiProbe(fixture(), () => ({ ...first.storage, setItem: () => {} })),
    false,
  );
  assert.equal(persistPendingAiProbe(fixture(), first.factory), true);
  assert.equal(
    clearPendingAiProbe(() => ({ ...first.storage, removeItem: () => {} })),
    false,
  );
  assert.deepEqual(readPendingAiProbe(first.factory), { available: true, request: fixture() });
});

test('an unresolved original request cannot be overwritten by a new ID or edited request', () => {
  const first = memory();
  assert.equal(persistPendingAiProbe(fixture(), first.factory), true);
  assert.equal(persistPendingAiProbe(fixture(), first.factory), true);
  assert.equal(
    persistPendingAiProbe(
      { ...fixture(), id: '00000000-0000-4000-8000-000000000003' },
      first.factory,
    ),
    false,
  );
  assert.equal(
    persistPendingAiProbe({ ...fixture(), model_id: 'provider/another-model' }, first.factory),
    false,
  );
  assert.deepEqual(readPendingAiProbe(first.factory), { available: true, request: fixture() });
  assert.equal(clearPendingAiProbe(first.factory), true);
  assert.equal(persistPendingAiProbe(fixture('models'), first.factory), true);
});

test('browser helper has no Node, credential or automatic networking dependency', async () => {
  const source = await readFile(new URL('../lib/admin-ai-pending.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('node:'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('randomUUID'), false);
  assert.equal(source.includes('localStorage'), false);
});
