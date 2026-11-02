import assert from 'node:assert/strict';
import test from 'node:test';
import {
  link,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createNeonUsageLocalStore } from '../lib/neon-usage-local.ts';
import { createNeonUsageBlobStore } from '../lib/neon-usage-blob.ts';

const project = 'synthetic-project';
const history = {
  version: 1,
  projectId: project,
  samples: [
    {
      sampledAt: '2026-11-02T09:00:00.000Z',
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      bytes: 12345,
    },
  ],
};
const slotName = (sample) => `${Math.floor(Date.parse(sample.sampledAt) / 900000)}.json`;
const nextSample = (hour) => ({
  ...history.samples[0],
  sampledAt: `2026-11-02T${hour}:00:00.000Z`,
  bytes: 12345 + Number(hour),
});

async function local(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'neon-usage-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, '.hzense-local');
  await mkdir(root, { mode: 0o700 });
  return {
    root,
    directory: join(root, 'neon-usage', project),
    store: createNeonUsageLocalStore(project, root),
  };
}

test('immutable local slots survive reopening, reject stale writers and never overwrite counters', async (t) => {
  const { root, directory, store } = await local(t);
  assert.equal(await store.read(), null);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  const results = await Promise.all([
    store.compareAndSwap(history, null),
    store.compareAndSwap(history, null),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const reopened = createNeonUsageLocalStore(project, root);
  const saved = await reopened.read();
  assert.deepEqual(saved.history, history);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, slotName(history.samples[0])))).mode & 0o777, 0o600);
  const changed = { ...history, samples: [{ ...history.samples[0], bytes: 54321 }] };
  assert.equal(await reopened.compareAndSwap(changed, 'old-version'), false);
  assert.equal(await reopened.compareAndSwap(changed, saved.version), false);
  assert.deepEqual((await store.read()).history, history);
  const extended = { ...history, samples: [...history.samples, nextSample('10')] };
  assert.equal(await reopened.compareAndSwap(extended, saved.version), true);
  assert.deepEqual((await store.read()).history, extended);
});

test('concurrent distinct slots merge rather than replacing another writer history', async (t) => {
  const { store } = await local(t);
  await store.compareAndSwap(history, null);
  const saved = await store.read();
  const a = nextSample('10'),
    b = nextSample('11');
  const results = await Promise.all(
    [a, b].map((sample) =>
      store.compareAndSwap({ ...history, samples: [...history.samples, sample] }, saved.version),
    ),
  );
  for (const [index, success] of results.entries()) {
    if (success) continue;
    const current = await store.read();
    const added = [a, b][index];
    if (!current.history.samples.some((sample) => sample.sampledAt === added.sampledAt)) {
      assert.equal(
        await store.compareAndSwap(
          { ...history, samples: [...current.history.samples, added] },
          current.version,
        ),
        true,
      );
    }
  }
  assert.deepEqual((await store.read()).history.samples, [...history.samples, a, b]);
});

test('orphan temporary writes or publish hardlinks do not block sampling after process restart', async (t) => {
  const { root, directory, store } = await local(t);
  await store.compareAndSwap(history, null);
  await writeFile(join(directory, '.pending-crashed-before-publish'), '{incomplete', {
    mode: 0o600,
  });
  await writeFile(join(directory, 'unrelated-notes.txt'), 'keep me', { mode: 0o600 });
  const target = join(directory, slotName(history.samples[0]));
  await link(target, join(directory, '.pending-crashed-after-publish'));
  assert.equal((await stat(target)).nlink, 2);
  const reopened = createNeonUsageLocalStore(project, root);
  const saved = await reopened.read();
  assert.deepEqual(saved.history, history);
  const extended = { ...history, samples: [...history.samples, nextSample('10')] };
  assert.equal(await reopened.compareAndSwap(extended, saved.version), true);
  assert.deepEqual((await reopened.read()).history, extended);
  const names = await readdir(directory);
  assert.ok(names.includes('.pending-crashed-before-publish'));
  assert.ok(names.includes('.pending-crashed-after-publish'));
  assert.ok(names.includes('unrelated-notes.txt'));
  assert.ok(!names.some((name) => name.endsWith('.lock')));
});

test('successful local append prunes only validated expired slots and keeps unknown files', async (t) => {
  const { directory, store } = await local(t);
  await store.compareAndSwap(history, null);
  await writeFile(join(directory, '.pending-untouched'), 'keep', { mode: 0o600 });
  const saved = await store.read();
  const sample = {
    sampledAt: '2027-01-05T10:00:00.000Z',
    periodStart: '2027-01-01T00:00:00.000Z',
    periodEnd: '2027-02-01T00:00:00.000Z',
    bytes: 500,
  };
  assert.equal(await store.compareAndSwap({ ...history, samples: [sample] }, saved.version), true);
  assert.deepEqual((await store.read()).history.samples, [sample]);
  const names = await readdir(directory);
  assert.ok(names.includes('.pending-untouched'));
  assert.ok(!names.includes(slotName(history.samples[0])));
});

test('local reads reject symlinks and corrupt slots instead of resetting the baseline', async (t) => {
  const { root, directory, store } = await local(t);
  await store.compareAndSwap(history, null);
  const path = join(directory, slotName(history.samples[0]));
  await writeFile(path, '{bad');
  await assert.rejects(store.read(), { code: 'storage_unavailable' });
  await assert.rejects(store.compareAndSwap(history, null), { code: 'storage_unavailable' });
  await rm(path);
  const target = join(root, 'other');
  await writeFile(target, JSON.stringify(history), { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(store.read(), { code: 'storage_unavailable' });
  assert.throws(() => createNeonUsageLocalStore('../escape', root), { code: 'not_configured' });
});

test('slot filename, size and project identity are checked before using local counters', async (t) => {
  const { directory, store } = await local(t);
  await store.compareAndSwap(history, null);
  const path = join(directory, slotName(history.samples[0]));
  for (const invalid of [
    { ...history, projectId: 'different-project' },
    { ...history, samples: [nextSample('10')] },
    { ...history, ignored: 'x'.repeat(4096) },
  ]) {
    await writeFile(path, JSON.stringify(invalid));
    await assert.rejects(store.read(), { code: 'storage_unavailable' });
  }
});

test('installed Blob SDK reads uncached private JSON and sends conditional writes', async (t) => {
  const require = createRequire(import.meta.url);
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
    require.resolve('@vercel/blob'),
  )('undici');
  const previous = getGlobalDispatcher(),
    agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });
  const token = 'vercel_blob_rw_synthetic_store_secret';
  const path = `neon-usage/${project}/history-v1.json`;
  const store = createNeonUsageBlobStore(project, token);
  agent
    .get('https://synthetic.private.blob.vercel-storage.com')
    .intercept({
      path: `/${path}?cache=0`,
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' },
    })
    .reply(200, JSON.stringify(history), {
      headers: { etag: '"v1"', 'content-type': 'application/json' },
    });
  const saved = await store.read();
  assert.deepEqual(saved, { history, version: '"v1"' });
  agent
    .get('https://vercel.com')
    .intercept({
      path: `/api/blob/?pathname=${encodeURIComponent(path)}`,
      method: 'PUT',
      headers: {
        'x-if-match': '"v1"',
        'x-vercel-blob-access': 'private',
        'x-add-random-suffix': '0',
      },
      body: JSON.stringify(history),
    })
    .reply(
      200,
      JSON.stringify({
        url: `https://synthetic.private.blob.vercel-storage.com/${path}`,
        pathname: path,
        etag: '"v2"',
      }),
    );
  assert.equal(await store.compareAndSwap(history, '"v1"'), true);
  agent.assertNoPendingInterceptors();
});
