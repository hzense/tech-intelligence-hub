import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchNeonUsage, sampleNeonUsage } from '../lib/neon-usage-service.ts';
import { NeonUsageError } from '../lib/neon-usage-core.ts';
import { createNeonUsageLocalStore } from '../lib/neon-usage-local.ts';

const { Response, AbortSignal, structuredClone } = globalThis;

const projectId = 'synthetic-project-123';
const apiKey = 'synthetic-neon-key-never-store';
const now = new Date('2026-11-02T12:00:00Z');
const receipt = (bytes = 123) => ({
  project: {
    id: projectId,
    data_transfer_bytes: bytes,
    consumption_period_start: '2026-11-01T00:00:00Z',
    consumption_period_end: '2026-12-01T00:00:00Z',
    owner: { email: 'private@example.invalid' },
  },
});
const sample = {
  sampledAt: now.toISOString(),
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  bytes: 123,
};
function memoryStore() {
  let saved = null;
  let serial = 0;
  return {
    reads: 0,
    writes: 0,
    async read() {
      this.reads++;
      return structuredClone(saved);
    },
    async compareAndSwap(history, version) {
      this.writes++;
      if ((saved?.version ?? null) !== version) return false;
      saved = { history: structuredClone(history), version: String(++serial) };
      return true;
    },
  };
}

async function localStore(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'neon-usage-service-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, '.hzense-local');
  await mkdir(directory, { mode: 0o700 });
  return createNeonUsageLocalStore(projectId, directory);
}

test('provider request has fixed HTTPS origin, refuses redirects and keeps credentials out of sample', async () => {
  const calls = [];
  const result = await fetchNeonUsage(projectId, apiKey, now, async (url, options) => {
    calls.push({ url, options });
    return Response.json(receipt());
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://console.neon.tech/api/v2/projects/${projectId}`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${apiKey}`);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(result, sample);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-neon-key|owner|private@example/);
});

test('provider errors and malformed or oversized response become fixed safe codes', async () => {
  for (const [status, code] of [
    [401, 'provider_unauthorized'],
    [403, 'provider_unauthorized'],
    [404, 'project_not_found'],
    [429, 'provider_rate_limited'],
    [500, 'provider_unavailable'],
  ]) {
    await assert.rejects(
      fetchNeonUsage(
        projectId,
        apiKey,
        now,
        async () => new Response(`private ${apiKey}`, { status }),
      ),
      { code, message: code },
    );
  }
  await assert.rejects(
    fetchNeonUsage(projectId, apiKey, now, async () => {
      throw new Error(apiKey);
    }),
    { code: 'provider_unavailable', message: 'provider_unavailable' },
  );
  for (const body of [
    'not-json',
    JSON.stringify({ project: { ...receipt().project, id: 'wrong' } }),
    'x'.repeat(262145),
    JSON.stringify({ project: { id: projectId } }),
  ]) {
    await assert.rejects(
      fetchNeonUsage(projectId, apiKey, now, async () => new Response(body)),
      { code: 'invalid_metrics', message: 'invalid_metrics' },
    );
  }
});

test('recent sample avoids provider calls and history writes until minimum interval elapsed', async () => {
  const store = memoryStore();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json(receipt());
  };
  const options = { projectId, apiKey, store, now: () => now, fetcher };
  assert.equal(await sampleNeonUsage(options), 'sampled');
  assert.equal(
    await sampleNeonUsage({ ...options, now: () => new Date(now.getTime() + 14 * 60_000) }),
    'recent',
  );
  assert.equal(calls, 1);
  assert.equal(store.writes, 1);
  assert.equal(
    await sampleNeonUsage({ ...options, now: () => new Date(now.getTime() + 15 * 60_000) }),
    'sampled',
  );
  assert.equal(calls, 2);
  assert.equal((await store.read()).history.samples.length, 2);
});

test('simultaneous first samplers use CAS and preserve only one slot without lost history', async () => {
  const store = memoryStore();
  let entered = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const fetcher = async () => {
    entered++;
    if (entered === 2) release();
    await barrier;
    return Response.json(receipt());
  };
  const options = { projectId, apiKey, store, now: () => now, fetcher };
  const results = await Promise.all([sampleNeonUsage(options), sampleNeonUsage(options)]);
  assert.deepEqual(results.sort(), ['recent', 'sampled']);
  const saved = await store.read();
  assert.equal(saved.history.samples.length, 1);
  assert.deepEqual(saved.history.samples[0], sample);
});

test('later-starting local sampler can win the same slot without making earlier request conflict', async (t) => {
  const store = await localStore(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const earlier = sampleNeonUsage({
    projectId,
    apiKey,
    store,
    now: () => now,
    fetcher: async () => {
      entered.resolve();
      await release.promise;
      return Response.json(receipt(111));
    },
  });
  await entered.promise;
  const laterTime = new Date(now.getTime() + 100);
  try {
    assert.equal(
      await sampleNeonUsage({
        projectId,
        apiKey,
        store,
        now: () => laterTime,
        fetcher: async () => Response.json(receipt(222)),
      }),
      'sampled',
    );
  } finally {
    release.resolve();
  }
  assert.equal(await earlier, 'recent');
  assert.deepEqual((await store.read()).history.samples, [
    { ...sample, sampledAt: laterTime.toISOString(), bytes: 222 },
  ]);
});

test('future local samples outside the fetched slot do not suppress current sampling', async (t) => {
  const store = await localStore(t);
  const future = { ...sample, sampledAt: '2026-11-02T13:00:00.000Z', bytes: 456 };
  await store.compareAndSwap({ version: 1, projectId, samples: [future] }, null);
  let calls = 0;
  assert.equal(
    await sampleNeonUsage({
      projectId,
      apiKey,
      store,
      now: () => now,
      fetcher: async () => {
        calls++;
        return Response.json(receipt());
      },
    }),
    'sampled',
  );
  assert.equal(calls, 1);
  assert.deepEqual((await store.read()).history.samples, [sample, future]);
});

test('read failures do not overwrite history and CAS retries are bounded', async () => {
  let providerCalls = 0,
    writes = 0;
  const fetcher = async () => {
    providerCalls++;
    return Response.json(receipt());
  };
  await assert.rejects(
    sampleNeonUsage({
      projectId,
      apiKey,
      now: () => now,
      fetcher,
      store: {
        read: async () => {
          throw new NeonUsageError('storage_unavailable');
        },
        compareAndSwap: async () => {
          writes++;
          return true;
        },
      },
    }),
    { code: 'storage_unavailable' },
  );
  assert.equal(providerCalls, 0);
  assert.equal(writes, 0);
  await assert.rejects(
    sampleNeonUsage({
      projectId,
      apiKey,
      now: () => now,
      fetcher,
      store: {
        read: async () => null,
        compareAndSwap: async () => {
          writes++;
          return false;
        },
      },
    }),
    { code: 'storage_conflict' },
  );
  assert.equal(providerCalls, 1);
  assert.equal(writes, 3);
});

test('provider failure leaves previous snapshot intact rather than saving zero usage', async () => {
  const store = memoryStore();
  await store.compareAndSwap({ version: 1, projectId, samples: [sample] }, null);
  const previous = await store.read();
  await assert.rejects(
    sampleNeonUsage({
      projectId,
      apiKey,
      store,
      now: () => new Date('2026-11-02T13:00:00Z'),
      fetcher: async () => new Response('', { status: 503 }),
    }),
    { code: 'provider_unavailable' },
  );
  assert.deepEqual(await store.read(), previous);
});

test('cost sampling recognizes a confirmed Free plan without reading consumption or leaking organization fields', async () => {
  const calls = [];
  const result = await fetchNeonUsage(projectId, apiKey, now, async (url) => {
    calls.push(url);
    if (url.endsWith(`/projects/${projectId}`))
      return Response.json({ project: { ...receipt().project, org_id: 'org-synthetic' } });
    assert.equal(url, 'https://console.neon.tech/api/v2/organizations/org-synthetic');
    return Response.json({ id: 'org-synthetic', plan: 'free', name: 'private-name' });
  });
  assert.equal(result.bytes, 123);
  assert.equal(result.costs.status, 'free');
  assert.equal(result.costs.totalMicrousd, 0);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-name|org-synthetic|synthetic-neon-key/);
});

test('cost provider failure leaves a valid traffic sample and never invents zero cost', async () => {
  const result = await fetchNeonUsage(projectId, apiKey, now, async (url) => {
    if (url.endsWith(`/projects/${projectId}`))
      return Response.json({ project: { ...receipt().project, org_id: 'org-synthetic' } });
    return new Response('private provider error', { status: 403 });
  });
  assert.equal(result.bytes, 123);
  assert.equal(result.costs.status, 'unavailable');
  assert.equal(result.costs.totalMicrousd, null);
  assert.doesNotMatch(JSON.stringify(result), /private provider error/);
});
