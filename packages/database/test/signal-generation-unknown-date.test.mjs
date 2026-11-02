import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assessGeneratedCandidates,
  GENERATION_RESOURCES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  GENERATION_EVENT_TYPES_CONTRACT,
  GENERATION_CHINESE_CONTRACT,
  hasSourcePublicationDate,
} from '../../ingestion/src/signal-generation-contract.mjs';
import { finishSignalGeneration } from '../src/signal-generation-store.mjs';

const source = {
  classification: 'private',
  fragments: [
    { id: 'fragment-1', text: 'Lab announced X.', locator: { paragraph: 1 } },
    {
      id: 'fragment-2',
      text: 'The announcement was made today; its calendar date is not supplied.',
      locator: { paragraph: 2 },
    },
  ],
};
const topics = [{ id: 'topic-ai', title: '人工智能' }];
const dateReference = { fragment_id: 'fragment-2', quote: 'today' };
const raw = {
  title: 'Lab 发布 X',
  summary: 'Lab 发布 X，原文没有明确事件日期。',
  event_date: null,
  event_date_evidence: [dateReference],
  persons: [],
  organizations: ['Lab'],
  claims: [
    { text: 'Lab 发布 X。', evidence: [{ fragment_id: 'fragment-1', quote: 'Lab announced X.' }] },
  ],
  signal_type: 'product',
  topic_ids: ['topic-ai'],
  resources: [
    {
      type: 'company',
      name: 'Lab',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'fragment-1', quote: 'Lab' }],
    },
  ],
};

function fixture(contract = GENERATION_RESOURCES_CONTRACT) {
  const row = {
    id: randomUUID(),
    status: 'running',
    lease_token: randomUUID(),
    reserved_microusd: '100',
    lease_until: new Date(Date.now() + 60000),
    snapshot: { source, topics, output_contract: contract },
  };
  const writes = [];
  const result = {
    ...assessGeneratedCandidates(
      {
        candidates: [
          {
            ...raw,
            ...(hasSourcePublicationDate(contract) ? { date_basis: 'source_published' } : {}),
          },
        ],
        reason: '私有候选',
      },
      source,
      topics,
      contract,
    ),
    usage: { input_tokens: 10, output_tokens: 20 },
  };
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
                charged_microusd: params[4],
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
  };
  return {
    row,
    writes,
    args: {
      pool,
      owner: 'owner',
      id: row.id,
      token: row.lease_token,
      outcome: 'completed',
      providerCostMicrousd: 23,
      result,
    },
  };
}

describe('unknown event dates at the generation persistence boundary', () => {
  it.each([
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
    GENERATION_EVENT_TYPES_CONTRACT,
    GENERATION_CHINESE_CONTRACT,
  ])('binds %s date semantics to the immutable snapshot through completion', async (contract) => {
    const { args, row, writes } = fixture(contract);
    const saved = await finishSignalGeneration(args);
    expect(saved.result.candidates[0].date_basis).toBe('source_published');
    expect(saved.result.candidates[0].event_date).toBeNull();
    expect(row.snapshot.output_contract).toBe(contract);
    expect(writes).toHaveLength(1);
    for (const basis of [undefined, 'event', 'captured_at']) {
      const candidate = { ...args.result.candidates[0] };
      if (basis === undefined) delete candidate.date_basis;
      else candidate.date_basis = basis;
      await expect(
        finishSignalGeneration({ ...args, result: { ...args.result, candidates: [candidate] } }),
      ).rejects.toMatchObject({ code: 'invalid_result' });
    }
    const legacy = fixture();
    await expect(
      finishSignalGeneration({
        ...legacy.args,
        result: {
          ...legacy.args.result,
          candidates: [{ ...legacy.args.result.candidates[0], date_basis: 'source_published' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_result' });
  });
  it('retains exact private date clues without inferring a date or promoting publication readiness', async () => {
    const { args, row, writes } = fixture();
    const before = JSON.stringify({ source, raw, snapshot: row.snapshot, result: args.result });
    expect(args.result.candidates).toHaveLength(1);
    expect(args.result.rejected).toEqual([]);
    const saved = await finishSignalGeneration(args);
    expect(saved.status).toBe('completed');
    expect(saved.charged_microusd).toBe('23');
    expect(saved.result.candidates[0]).toMatchObject({
      classification: 'private',
      status: 'needs_review',
      event_date: null,
      event_date_evidence: [dateReference],
    });
    expect(saved.result.candidates[0].issues).toContain('needs_event_time');
    expect(writes).toHaveLength(1);
    expect(JSON.stringify({ source, raw, snapshot: row.snapshot, result: args.result })).toBe(
      before,
    );
  });

  it('recomputes needs_event_time and rejects omitted or forged issue flags before writing', async () => {
    const { args, writes } = fixture();
    const candidate = args.result.candidates[0];
    expect(candidate.issues).toContain('needs_event_time');
    for (const issues of [
      candidate.issues.filter((issue) => issue !== 'needs_event_time'),
      [...candidate.issues, 'approved'],
    ]) {
      await expect(
        finishSignalGeneration({
          ...args,
          result: { ...args.result, candidates: [{ ...candidate, issues }] },
        }),
      ).rejects.toMatchObject({ code: 'invalid_result' });
    }
    expect(writes).toEqual([]);
  });

  it('does not allow the private-date policy to bypass snapshot fragment or exact-quote validation', async () => {
    const { args, writes } = fixture();
    const candidate = args.result.candidates[0];
    for (const evidence of [
      [{ ...dateReference, fragment_id: 'fragment-missing' }],
      [{ ...dateReference, quote: '2026-10-21' }],
    ]) {
      await expect(
        finishSignalGeneration({
          ...args,
          result: {
            ...args.result,
            candidates: [{ ...candidate, event_date_evidence: evidence }],
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid_result' });
    }
    expect(writes).toEqual([]);
  });

  it('continues rejecting a non-null date with no evidence and never silently promotes a draft date', async () => {
    const { args, writes } = fixture();
    const candidate = args.result.candidates[0];
    await expect(
      finishSignalGeneration({
        ...args,
        result: {
          ...args.result,
          candidates: [
            {
              ...candidate,
              event_date: '2026-10-21',
              event_date_evidence: [],
              issues: candidate.issues.filter((issue) => issue !== 'needs_event_time'),
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_result' });
    expect(writes).toEqual([]);
  });
});

it('completion rejects retired dimensions in event-only tasks while retaining historical results', async () => {
  for (const signalType of ['technology', 'security', 'market', 'supply_chain', 'open_source']) {
    const current = fixture(GENERATION_EVENT_TYPES_CONTRACT);
    current.args.result.candidates[0].signal_type = signalType;
    await expect(finishSignalGeneration(current.args)).rejects.toMatchObject({
      code: 'invalid_result',
    });
    expect(current.writes).toHaveLength(0);
    const legacy = fixture(GENERATION_SOURCE_PUBLICATION_CONTRACT);
    legacy.args.result.candidates[0].signal_type = signalType;
    const saved = await finishSignalGeneration(legacy.args);
    expect(saved.result.candidates[0].signal_type).toBe(signalType);
  }
  for (const signalType of ['disclosure', 'operations', 'incident']) {
    const current = fixture(GENERATION_EVENT_TYPES_CONTRACT);
    current.args.result.candidates[0].signal_type = signalType;
    const saved = await finishSignalGeneration(current.args);
    expect(saved.result.candidates[0].signal_type).toBe(signalType);
  }
});

it.each(['title', 'summary'])(
  'new Chinese snapshots reject an English %s at persistence while old snapshots remain readable',
  async (field) => {
    const current = fixture(GENERATION_CHINESE_CONTRACT);
    const changed = {
      ...current.args.result,
      candidates: [{ ...current.args.result.candidates[0], [field]: 'Lab released a new model.' }],
    };
    await expect(
      finishSignalGeneration({ ...current.args, result: changed }),
    ).rejects.toMatchObject({ code: 'invalid_result' });
    expect(current.writes).toHaveLength(0);
    const historical = fixture(GENERATION_EVENT_TYPES_CONTRACT);
    const saved = await finishSignalGeneration({
      ...historical.args,
      result: {
        ...historical.args.result,
        candidates: [
          { ...historical.args.result.candidates[0], [field]: 'Lab released a new model.' },
        ],
      },
    });
    expect(saved.result.candidates[0][field]).toBe('Lab released a new model.');
  },
);
