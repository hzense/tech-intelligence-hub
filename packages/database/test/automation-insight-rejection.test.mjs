import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { rejectInsightTopicsBeforeClaim } from '../src/automation-store.mjs';

const id = randomUUID();
const owner = 'insight-rejection-test';

function fixture() {
  const calls = [];
  const outcomes = [[{ id }], []];
  const release = vi.fn();
  const query = vi.fn(async (sql, parameters) => {
    calls.push({ sql, parameters });
    return {
      rows: sql.startsWith('UPDATE public.automation_runs') ? outcomes.shift() : [],
    };
  });
  return { calls, release, pool: { connect: vi.fn(async () => ({ query, release })) } };
}

describe('unpaid insight scope rejection', () => {
  it.each([undefined, 'insight_topic_not_leaf', 'insight_topic_not_tracked'])(
    'binds the approved reason %s and returns false when a replay no longer matches',
    async (errorCode) => {
      const { pool, calls, release } = fixture();
      const request = { pool, owner, id, errorCode };
      expect(await rejectInsightTopicsBeforeClaim(request)).toBe(true);
      expect(await rejectInsightTopicsBeforeClaim(request)).toBe(false);
      const updates = calls.filter(({ sql }) => sql.startsWith('UPDATE public.automation_runs'));
      expect(updates).toHaveLength(2);
      for (const update of updates) {
        expect(update.parameters).toEqual([id, owner, errorCode ?? 'insight_topic_not_leaf']);
        expect(update.sql).toContain('phase=$3,error_code=$3');
        expect(update.sql).not.toContain('insight_topic_not_');
      }
      expect(calls.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(2);
      expect(release).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    null,
    '',
    'outcome_unknown',
    'insight_insufficient_evidence',
    ' insight_topic_not_tracked',
    "insight_topic_not_tracked'; UPDATE public.automation_runs SET charged_microusd=0; --",
    0,
    {},
    ['insight_topic_not_tracked'],
  ])('rejects an unapproved reason before obtaining a connection: %j', async (errorCode) => {
    const { pool, calls } = fixture();
    await expect(
      rejectInsightTopicsBeforeClaim({ pool, owner, id, errorCode }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
