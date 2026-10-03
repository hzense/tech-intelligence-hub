import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { describe, expect, it, vi } from 'vitest';
import {
  assessGeneratedCandidates,
  REJECTED_CANDIDATES_REASON,
  GENERATION_METADATA_CONTRACT,
} from '../../ingestion/src/signal-generation-contract.mjs';
import {
  createSignalGeneration,
  getSignalGeneration,
  listSignalGenerations,
  getSignalGenerationDailyUsage,
  finishSignalGeneration,
  signalGenerationSourceHash,
} from '../src/signal-generation-store.mjs';

it('daily usage reads the full owner ledger in UTC without excluding deleted tasks', async () => {
  const queries = [];
  const expected = { day: '2026-09-21', charged_microusd: '1234', budget_used_microusd: '5000' };
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: sql.startsWith('WITH today') ? [expected] : [] };
    },
    release: vi.fn(),
  };
  expect(
    await getSignalGenerationDailyUsage({ pool: { connect: async () => client }, owner: 'admin' }),
  ).toEqual(expected);
  const aggregate = queries.find((q) => q.sql.startsWith('WITH today'));
  expect(aggregate.params).toEqual(['admin']);
  expect(aggregate.sql).toContain("AT TIME ZONE 'UTC'");
  expect(aggregate.sql).not.toMatch(/LIMIT|deleted_at|created_at/);
  expect(queries[0].sql).toContain('READ ONLY');
  expect(client.release).toHaveBeenCalled();
});
it.each([undefined, 0, 1, 30])(
  'persists API amount %s without changing reservation',
  async (amount) => {
    const token = randomUUID();
    const id = randomUUID();
    let saved;
    const client = {
      query: async (sql, params) => {
        if (sql.includes('FOR UPDATE'))
          return {
            rows: [
              {
                id,
                lease_token: token,
                status: 'running',
                lease_until: new Date(Date.now() + 60000),
                reserved_microusd: '10',
              },
            ],
          };
        if (sql.includes(' AS live')) return { rows: [{ live: true }] };
        if (sql.startsWith('UPDATE public.signal_generation_runs')) {
          saved = params;
          return { rows: [{ charged_microusd: params[4] }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const row = await finishSignalGeneration({
      pool: { connect: async () => client },
      owner: 'admin',
      id,
      token,
      outcome: 'failed',
      chargedMicrousd: 3,
      ...(amount === undefined ? {} : { providerCostMicrousd: amount }),
    });
    expect(row.charged_microusd).toBe(String(amount ?? 10));
    expect(saved[4]).toBe(String(amount ?? 10));
  },
);
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
  it('rejects invalid topic snapshots before contacting the database', async () => {
    const topic = { id: 'topic-ai', title: 'Artificial Intelligence' };
    for (const topics of [
      undefined,
      null,
      {},
      [topic, topic],
      [{ ...topic, title: '' }],
      Array.from({ length: 1001 }, (_, index) => ({ id: `topic-${index}`, title: 'Topic' })),
    ]) {
      const value = input();
      value.snapshot.topics = topics;
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'invalid_snapshot',
      });
    }
  });

  it('rejects invalid metadata contracts before database access', async () => {
    for (const marker of [null, '', 'unknown', 1]) {
      const value = input();
      value.snapshot.topics = [];
      value.snapshot.output_contract = marker;
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'invalid_snapshot',
      });
    }
    const value = input();
    value.snapshot.output_contract = GENERATION_METADATA_CONTRACT;
    await expect(createSignalGeneration(value)).rejects.toMatchObject({ code: 'invalid_snapshot' });
  });

  it('persists the complete validated catalog with a new generation snapshot', async () => {
    const value = input();
    value.snapshot.topics = [{ id: 'topic-ai', title: 'Artificial Intelligence' }];
    value.snapshot.output_contract = GENERATION_METADATA_CONTRACT;
    let savedSnapshot;
    value.pool = {
      connect: async () => ({
        release() {},
        query: async (sql, params) => {
          if (sql.startsWith('INSERT INTO public.signal_generation_runs')) {
            savedSnapshot = JSON.parse(params[10]);
            return { rows: [{ id: value.request.id, snapshot: savedSnapshot }] };
          }
          return { rows: [] };
        },
      }),
    };
    const result = await createSignalGeneration(value);
    expect(result.snapshot.topics).toEqual(value.snapshot.topics);
    expect(savedSnapshot).toEqual(value.snapshot);
  });

  it.each([true, false])(
    'first admission pins catalog on same-ID (%s) or semantic replay, including legacy tasks',
    async (sameId) => {
      for (const [savedTopics, incomingTopics] of [
        [undefined, [{ id: 'topic-new', title: 'New topic' }]],
        [[{ id: 'topic-old', title: 'Old topic' }], [{ id: 'topic-new', title: 'New topic' }]],
        [[{ id: 'topic-old', title: 'Old topic' }], []],
        [[{ id: 'topic-old', title: 'Old topic' }], [{ id: 'topic-old', title: 'Old topic' }]],
      ]) {
        const value = input();
        const savedSnapshot = {
          ...value.snapshot,
          ...(savedTopics === undefined ? {} : { topics: savedTopics }),
        };
        const savedConfig = { ...value.configuration };
        const { id: requestId, ...requestIdentity } = value.request;
        const row = {
          id: sameId ? requestId : randomUUID(),
          owner_id: value.owner,
          batch_id: value.request.batchId,
          item_id: value.request.itemId,
          source_fence: value.request.sourceFence,
          source_hash: value.request.sourceHash,
          profile_id: value.request.profileId,
          profile_revision: value.request.profileRevision,
          snapshot: savedSnapshot,
          configuration: savedConfig,
          fingerprint: signalGenerationSourceHash({
            owner: value.owner,
            ...requestIdentity,
            snapshot: savedSnapshot,
            configuration: savedConfig,
          }),
        };
        const writes = [];
        value.pool = {
          connect: async () => ({
            query: async (sql) => {
              if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) writes.push(sql);
              if (sql.includes('FROM public.signal_generation_runs WHERE id='))
                return { rows: sameId ? [row] : [] };
              if (sql.includes('WHERE owner_id=$1 AND item_id=$2')) return { rows: [row] };
              return { rows: [] };
            },
            release() {},
          }),
        };
        value.snapshot.topics = incomingTopics;
        value.snapshot.output_contract = GENERATION_METADATA_CONTRACT;
        value.configuration.reserveMicrousd = 20;
        expect(await createSignalGeneration(value)).toEqual(row);
        expect(writes).toHaveLength(0);
        row.deleted_at = new Date();
        await expect(createSignalGeneration(value)).rejects.toMatchObject({
          code: 'task_deleted',
          previousId: row.id,
        });
        delete row.deleted_at;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          value.configuration.dailyLimitMicrousd = 101;
          await expect(createSignalGeneration(value)).rejects.toMatchObject({
            code: 'request_id_conflict',
          });
          value.configuration.dailyLimitMicrousd = 100;
          row.fingerprint = '0'.repeat(64);
          await expect(createSignalGeneration(value)).rejects.toMatchObject({
            code: 'request_id_conflict',
          });
        } finally {
          warn.mockRestore();
        }
      }
    },
  );

  it('validates saved topic suggestions against the immutable catalog before writing', async () => {
    const topics = [{ id: 'topic-ai', title: 'Artificial Intelligence' }];
    const generationSource = {
      classification: 'private',
      fragments: [{ id: 'fragment-1', text: 'safe source', locator: { paragraph: 1 } }],
    };
    const raw = {
      title: 'Synthetic',
      summary: 'Synthetic evidence',
      event_date: null,
      event_date_evidence: [],
      persons: [],
      organizations: [],
      claims: [
        { text: 'safe source', evidence: [{ fragment_id: 'fragment-1', quote: 'safe source' }] },
      ],
      topic_ids: ['topic-ai'],
    };
    const result = {
      ...assessGeneratedCandidates(
        { candidates: [raw], reason: 'Private candidate' },
        generationSource,
        topics,
      ),
      usage: { input_tokens: 5, output_tokens: 5 },
    };
    const token = randomUUID();
    const row = {
      id: randomUUID(),
      status: 'running',
      lease_token: token,
      reserved_microusd: '10',
      lease_until: new Date(Date.now() + 60000),
      snapshot: { source: generationSource, topics },
    };
    const writes = [];
    const pool = {
      connect: async () => ({
        release() {},
        query: async (sql, params) => {
          if (sql.includes('FROM public.signal_generation_runs')) return { rows: [row] };
          if (sql.includes(' AS live')) return { rows: [{ live: true }] };
          if (sql.startsWith('UPDATE public.signal_generation_runs')) {
            writes.push(params);
            return { rows: [{ ...row, result: JSON.parse(params[2]) }] };
          }
          return { rows: [] };
        },
      }),
    };
    const args = { pool, owner: 'owner', id: row.id, token, outcome: 'completed', result };
    expect((await finishSignalGeneration(args)).result).toEqual(result);
    expect(writes).toHaveLength(1);
    const legacyCandidates = result.candidates.map((candidate) => {
      const legacy = { ...candidate };
      delete legacy.topic_ids;
      return legacy;
    });
    const unversioned = { ...result };
    delete unversioned.validation_version;
    delete unversioned.rejected;
    const invalidResults = [
      { ...result, candidates: [{ ...result.candidates[0], topic_ids: ['unknown'] }] },
      { ...result, candidates: [{ ...result.candidates[0], topic_ids: ['topic-ai', 'topic-ai'] }] },
      {
        ...result,
        candidates: [{ ...result.candidates[0], topic_ids: Array(6).fill('topic-ai') }],
      },
      { ...result, candidates: legacyCandidates },
      unversioned,
    ];
    for (const invalid of invalidResults)
      await expect(finishSignalGeneration({ ...args, result: invalid })).rejects.toMatchObject({
        code: 'invalid_result',
      });
    delete row.snapshot.topics;
    await expect(finishSignalGeneration(args)).rejects.toMatchObject({ code: 'invalid_result' });
    const legacyResult = {
      ...result,
      candidates: legacyCandidates,
    };
    expect((await finishSignalGeneration({ ...args, result: legacyResult })).result).toEqual(
      legacyResult,
    );
    expect(writes).toHaveLength(2);
    const rejectedResult = {
      ...assessGeneratedCandidates(
        { candidates: [{ ...raw, topic_ids: ['unknown'] }], reason: 'Private raw text' },
        generationSource,
        topics,
      ),
      usage: result.usage,
    };
    const failedArgs = {
      ...args,
      outcome: 'failed',
      errorCode: 'generation_invalid_output',
      result: rejectedResult,
    };
    await expect(finishSignalGeneration(failedArgs)).rejects.toMatchObject({
      code: 'invalid_result',
    });
    row.snapshot.topics = topics;
    expect((await finishSignalGeneration(failedArgs)).result.rejected[0].errors).toEqual([
      { field: 'topic_ids', code: 'invalid_field', path: 'topic_ids[0]', reason: 'unknown_topic' },
    ]);
    expect(writes).toHaveLength(3);
    const metadataResult = {
      ...assessGeneratedCandidates(
        { candidates: [{ ...raw, signal_type: 'research' }], reason: 'Private candidate' },
        generationSource,
        topics,
        GENERATION_METADATA_CONTRACT,
      ),
      usage: result.usage,
    };
    await expect(finishSignalGeneration({ ...args, result: metadataResult })).rejects.toMatchObject(
      { code: 'invalid_result' },
    );
    row.snapshot.output_contract = GENERATION_METADATA_CONTRACT;
    expect(
      (await finishSignalGeneration({ ...args, result: metadataResult })).result.candidates[0]
        .signal_type,
    ).toBe('research');
    for (const invalid of [
      result,
      {
        ...metadataResult,
        candidates: [{ ...metadataResult.candidates[0], signal_type: 'editorial' }],
      },
    ])
      await expect(finishSignalGeneration({ ...args, result: invalid })).rejects.toMatchObject({
        code: 'invalid_result',
      });
    const invalidType = {
      ...assessGeneratedCandidates(
        { candidates: [{ ...raw, signal_type: 'private' }], reason: 'Private candidate' },
        generationSource,
        topics,
        GENERATION_METADATA_CONTRACT,
      ),
      usage: result.usage,
    };
    expect(
      (await finishSignalGeneration({ ...failedArgs, result: invalidType })).result.rejected[0]
        .errors,
    ).toEqual([
      { field: 'signal_type', code: 'invalid_field', path: 'signal_type', reason: 'invalid_type' },
    ]);
    delete row.snapshot.output_contract;
    await expect(
      finishSignalGeneration({ ...failedArgs, result: invalidType }),
    ).rejects.toMatchObject({ code: 'invalid_result' });
    expect(writes).toHaveLength(5);
  });

  it('persists all nine metadata field failures with usage, provider charge and terminal status', async () => {
    const source = {
      classification: 'private',
      fragments: [{ id: 'fragment-1', text: 'safe source', locator: { paragraph: 1 } }],
    };
    const result = {
      ...assessGeneratedCandidates(
        {
          candidates: [
            {
              title: '',
              summary: '',
              event_date: '2026-02-30',
              event_date_evidence: [],
              persons: {},
              organizations: {},
              claims: [],
              topic_ids: ['unknown-topic'],
              signal_type: 'unknown-type',
            },
          ],
          reason: 'raw provider explanation must not persist',
        },
        source,
        [],
        GENERATION_METADATA_CONTRACT,
      ),
      usage: { input_tokens: 120, output_tokens: 30 },
    };
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0].errors.map(({ field }) => field)).toEqual([
      'title',
      'summary',
      'event_date',
      'event_date_evidence',
      'persons',
      'organizations',
      'claims',
      'signal_type',
      'topic_ids',
    ]);
    const row = {
      id: randomUUID(),
      status: 'running',
      lease_token: randomUUID(),
      lease_until: new Date(Date.now() + 60000),
      reserved_microusd: '500',
      snapshot: { source, topics: [], output_contract: GENERATION_METADATA_CONTRACT },
    };
    const writes = [];
    const pool = {
      connect: async () => ({
        release() {},
        query: async (sql, params) => {
          if (sql.includes('FROM public.signal_generation_runs')) return { rows: [row] };
          if (sql.includes(' AS live')) return { rows: [{ live: true }] };
          if (sql.startsWith('UPDATE public.signal_generation_runs')) {
            writes.push(params);
            return {
              rows: [
                {
                  ...row,
                  status: params[1],
                  result: JSON.parse(params[2]),
                  error_code: params[3],
                  charged_microusd: params[4],
                },
              ],
            };
          }
          return { rows: [] };
        },
      }),
    };
    const args = {
      pool,
      owner: 'owner',
      id: row.id,
      token: row.lease_token,
      outcome: 'failed',
      errorCode: 'generation_invalid_output',
      providerCostMicrousd: 23,
      result,
    };
    const saved = await finishSignalGeneration(args);
    expect(saved.status).toBe('failed');
    expect(saved.error_code).toBe('generation_invalid_output');
    expect(saved.charged_microusd).toBe('23');
    expect(saved.result).toEqual(result);
    expect(writes).toHaveLength(1);
    const invalid = globalThis.structuredClone(result);
    invalid.rejected[0].errors.push(invalid.rejected[0].errors[0]);
    await expect(finishSignalGeneration({ ...args, result: invalid })).rejects.toMatchObject({
      code: 'invalid_result',
    });
    expect(writes).toHaveLength(1);
  });

  it('reports only fixed conflict field names and booleans, never private values', async () => {
    const value = input();
    const { id, ...identityRequest } = value.request;
    const row = {
      id,
      owner_id: value.owner,
      batch_id: value.request.batchId,
      item_id: value.request.itemId,
      source_fence: value.request.sourceFence,
      source_hash: value.request.sourceHash,
      profile_id: value.request.profileId,
      profile_revision: value.request.profileRevision,
      snapshot: value.snapshot,
      configuration: value.configuration,
      deleted_at: new Date(),
      fingerprint: signalGenerationSourceHash({
        owner: value.owner,
        ...identityRequest,
        snapshot: value.snapshot,
        configuration: value.configuration,
      }),
    };
    value.pool = {
      connect: async () => ({
        query: async (sql) => ({
          rows: sql.includes('FROM public.signal_generation_runs WHERE id=') ? [row] : [],
        }),
        release() {},
      }),
    };
    value.snapshot = {
      ...value.snapshot,
      profile: { ...value.snapshot.profile, name: 'private diagnostic sentinel' },
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(createSignalGeneration(value)).rejects.toMatchObject({
        code: 'request_id_conflict',
      });
      expect(warning).toHaveBeenCalledOnce();
      expect(JSON.parse(warning.mock.calls[0][0])).toEqual({
        event: 'signal_generation_identity_conflict',
        stored_fingerprint_valid: true,
        deleted: true,
        fields: ['snapshot.profile'],
      });
      expect(warning.mock.calls[0][0]).not.toContain('private diagnostic sentinel');
      expect(warning.mock.calls[0][0]).not.toContain(value.owner);
      expect(warning.mock.calls[0][0]).not.toContain(value.request.id);
    } finally {
      warning.mockRestore();
    }
  });
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
      ...[
        { path: 'title' },
        { reason: 'text_too_long' },
        { path: 'raw private path', reason: 'text_too_long' },
        { path: 'title', reason: 'raw private reason' },
        { path: 'persons[0].name', reason: 'text_too_long' },
        { path: 'title', reason: 'text_too_long', raw: 'private value' },
      ].map((detail) => ({
        rejected: [
          { ...rejected, errors: [{ field: 'title', code: 'title_too_long', ...detail }] },
        ],
      })),
      {
        rejected: [
          {
            ...rejected,
            errors: [
              {
                field: 'persons',
                code: 'invalid_field',
                path: 'persons[12].name',
                reason: 'missing_value',
              },
            ],
          },
        ],
      },
      {
        rejected: [
          {
            ...rejected,
            errors: [
              {
                field: 'claims',
                code: 'invalid_field',
                path: 'claims[0].evidence[8].quote',
                reason: 'quote_mismatch',
              },
            ],
          },
        ],
      },
      { rejected: [{ ...rejected, errors: [null] }] },
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
  it.each([false, true])(
    'atomically retains legacy or detailed (%s) failed validation diagnostics without reducing the reservation',
    async (detailed) => {
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
            errors: [
              {
                field: 'title',
                code: 'title_too_long',
                ...(detailed ? { path: 'title', reason: 'text_too_long' } : {}),
              },
            ],
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
    },
  );
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
