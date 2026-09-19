import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REJECTED_CANDIDATES_REASON } from '../../ingestion/src/signal-generation-contract.mjs';
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
  it('rejects malformed diagnostic shapes, fields, codes, indexes and usage before any DB access', async () => {
    const rejected = {
      index: 0,
      classification: 'private',
      status: 'rejected',
      errors: [{ field: 'title', code: 'title_too_long' }],
    };
    const base = {
      classification: 'private',
      validation_version: 1,
      candidates: [],
      rejected: [rejected],
      reason: REJECTED_CANDIDATES_REASON,
      usage: { input_tokens: 1, output_tokens: null },
    };
    const malformed = [
      { rejected: ['raw private candidate text'] },
      { rejected: [{ ...rejected, text: 'raw private candidate text' }] },
      {
        rejected: [
          { ...rejected, errors: [{ field: 'title', code: 'title_too_long', quote: 'raw' }] },
        ],
      },
      { rejected: [{ ...rejected, errors: [{ field: 'raw field', code: 'title_too_long' }] }] },
      { rejected: [{ ...rejected, errors: [{ field: 'title', code: 'raw reason' }] }] },
      { rejected: [{ ...rejected, errors: [{ field: 'title', code: 'invalid_event_date' }] }] },
      { rejected: [{ ...rejected, errors: [{ field: 'toString', code: 'invalid_field' }] }] },
      { rejected: [{ ...rejected, errors: [] }] },
      { rejected: [{ ...rejected, errors: [...rejected.errors, ...rejected.errors] }] },
      { rejected: [{ ...rejected, index: -1 }] },
      { rejected: [{ ...rejected, index: 5 }] },
      { rejected: [{ ...rejected, index: 1 }] },
      { rejected: [rejected, rejected] },
      { rejected: [{ ...rejected, classification: 'public' }] },
      { rejected: [{ ...rejected, status: 'needs_review' }] },
      { usage: { input_tokens: -1, output_tokens: null } },
      { usage: { input_tokens: 1, output_tokens: null, raw: 'text' } },
      { reason: 'x'.repeat(1001) },
      { reason: 'raw rejected candidate text' },
      { raw: 'raw output' },
      { validation_version: 2 },
    ];
    for (const change of malformed) {
      for (const outcome of ['failed', 'completed']) {
        await expect(
          finishSignalGeneration({
            pool: input().pool,
            owner: 'owner',
            id: randomUUID(),
            token: randomUUID(),
            outcome,
            errorCode: 'generation_invalid_output',
            result: { ...base, ...change },
          }),
        ).rejects.toMatchObject({ code: 'invalid_result' });
      }
    }
    await expect(
      finishSignalGeneration({
        pool: input().pool,
        owner: 'owner',
        id: randomUUID(),
        token: randomUUID(),
        outcome: 'completed',
        result: base,
      }),
    ).rejects.toMatchObject({ code: 'invalid_result' });
  });
  it('atomically retains failed validation diagnostics without reducing the reservation', async () => {
    const token = randomUUID();
    const id = randomUUID();
    const result = {
      classification: 'private',
      validation_version: 1,
      candidates: [],
      rejected: [
        {
          index: 0,
          classification: 'private',
          status: 'rejected',
          errors: [{ field: 'title', code: 'title_too_long' }],
        },
      ],
      reason: REJECTED_CANDIDATES_REASON,
      usage: { input_tokens: 200, output_tokens: 100 },
    };
    const writes = [];
    const row = {
      id,
      status: 'running',
      lease_token: token,
      reserved_microusd: '1000',
      snapshot: { source },
      lease_until: new Date(Date.now() + 60000),
    };
    const client = {
      release() {},
      async query(sql, values) {
        if (sql.includes('SELECT $1::timestamptz')) return { rows: [{ live: true }] };
        if (sql.includes('FROM public.signal_generation_runs')) return { rows: [row] };
        if (sql.startsWith('UPDATE public.signal_generation_runs SET status=$2,result=')) {
          writes.push(values);
          Object.assign(row, {
            status: values[1],
            result: JSON.parse(values[2]),
            error_code: values[3],
            charged_microusd: values[4],
          });
          return { rows: [row] };
        }
        return { rows: [] };
      },
    };
    const args = {
      pool: { connect: async () => client },
      owner: 'owner',
      id,
      token,
      outcome: 'failed',
      errorCode: 'generation_invalid_output',
      chargedMicrousd: 400,
      result,
    };
    const saved = await finishSignalGeneration(args);
    expect(saved.result).toEqual(result);
    expect(saved.charged_microusd).toBe('1000');
    await finishSignalGeneration(args);
    expect(writes).toHaveLength(1);
  });
  it('rejects invalid or credential-bearing failed validation records before the DB', async () => {
    for (const result of [
      { classification: 'public' },
      { classification: 'private', validation_version: 1, candidates: [{}], rejected: [{}] },
      { classification: 'private', validation_version: 1, candidates: [], rejected: [] },
      {
        classification: 'private',
        validation_version: 1,
        candidates: [],
        rejected: [{}],
        api_key: 'bad',
      },
    ])
      await expect(
        finishSignalGeneration({
          pool: input().pool,
          owner: 'owner',
          id: randomUUID(),
          token: randomUUID(),
          outcome: 'failed',
          errorCode: 'generation_invalid_output',
          result,
        }),
      ).rejects.toMatchObject({ code: 'invalid_result' });
  });
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
