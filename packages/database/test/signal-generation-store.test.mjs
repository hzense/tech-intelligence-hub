import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSignalGeneration,
  getSignalGeneration,
  listSignalGenerations,
  finishSignalGeneration,
  signalGenerationSourceHash,
} from '../src/signal-generation-store.mjs';

const source = {
  classification: 'private',
  fragments: [{ index: 0, text: 'safe source', locator: { paragraph: 1 } }],
  warnings: [],
};
const connection = {
  id: randomUUID(),
  revision: 1,
  protocol: 'openai-compatible',
  base_url: 'https://provider.example/v1',
  settings: {},
};
const profile = {
  id: randomUUID(),
  revision: 1,
  stages: { extract: { connection_id: connection.id, connection_revision: 1 } },
};
function input() {
  return {
    pool: {
      connect: () => {
        throw new Error('Database must not be reached');
      },
    },
    owner: 'owner',
    request: {
      id: randomUUID(),
      batchId: randomUUID(),
      itemId: randomUUID(),
      sourceFence: 1,
      sourceHash: signalGenerationSourceHash(source),
      profileId: profile.id,
      profileRevision: 1,
    },
    snapshot: {
      source: JSON.parse(JSON.stringify(source)),
      profile: JSON.parse(JSON.stringify(profile)),
      connection: JSON.parse(JSON.stringify(connection)),
    },
    configuration: {
      version: 'v1',
      reserveMicrousd: 10,
      batchLimitMicrousd: 100,
      dailyLimitMicrousd: 100,
    },
  };
}
describe('private generation input boundaries', () => {
  it('hashes objects without depending on JSON property order', () => {
    expect(signalGenerationSourceHash({ a: 1, b: 2 })).toBe(
      signalGenerationSourceHash({ b: 2, a: 1 }),
    );
    expect(signalGenerationSourceHash({ a: 1 })).not.toBe(signalGenerationSourceHash({ a: 2 }));
  });
  it.each(['api_key', 'apiKey', 'encrypted_key', 'authorization'])(
    'rejects %s in a frozen snapshot',
    async (key) => {
      const value = input();
      value.snapshot.connection[key] = 'never persist';
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'invalid_snapshot',
      });
    },
  );
  it('binds the parsed hash and profile/connection revisions before writing', async () => {
    for (const change of [
      (v) => {
        v.snapshot.source.fragments[0].text = 'changed';
      },
      (v) => {
        v.snapshot.profile.revision = 2;
      },
      (v) => {
        v.snapshot.connection.revision = 2;
      },
      (v) => {
        v.snapshot.source.classification = 'public';
      },
    ]) {
      const value = input();
      change(value);
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'invalid_snapshot',
      });
    }
  });
  it('rejects unsafe, zero or over-limit reservations before contacting the DB', async () => {
    for (const reserveMicrousd of [0, -1, 101, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const value = input();
      value.configuration.reserveMicrousd = reserveMicrousd;
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'invalid_configuration',
      });
    }
  });
  it('rejects invalid recovery owners and selectors before contacting the DB', async () => {
    const pool = input().pool;
    for (const operation of [
      () => getSignalGeneration({ pool, owner: '', id: randomUUID() }),
      () => getSignalGeneration({ pool, owner: 'owner', id: 'invalid' }),
      () => listSignalGenerations({ pool, owner: 'owner\n' }),
      () => listSignalGenerations({ pool, owner: 'owner', batchId: 'invalid' }),
      () => listSignalGenerations({ pool, owner: 'owner', itemId: 'invalid' }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('refuses unclassified/public/credential-bearing or huge outputs', async () => {
    for (const result of [
      {},
      { classification: 'public' },
      { classification: 'private', api_key: 'bad' },
      { classification: 'private', text: 'x'.repeat(512001) },
    ])
      await expect(
        finishSignalGeneration({
          pool: input().pool,
          owner: 'owner',
          id: randomUUID(),
          token: randomUUID(),
          outcome: 'completed',
          result,
        }),
      ).rejects.toMatchObject({ code: 'invalid_result' });
  });
});
