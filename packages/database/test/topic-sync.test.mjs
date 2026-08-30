import { describe, expect, it, vi } from 'vitest';
import {
  normalizeDesiredTopics,
  planTopicSync,
  syncTopics,
  topicProjectionFingerprint,
} from '../src/topic-sync.mjs';

const desiredTopics = [
  {
    id: 'topic-root',
    title: 'Root',
    parentId: null,
    status: 'watching',
    runtimeEnabled: false,
  },
  {
    id: 'topic-child',
    title: "Child's Topic",
    parentId: 'topic-root',
    status: 'active',
    runtimeEnabled: true,
  },
  {
    id: 'topic-archived',
    title: 'Archived',
    parentId: 'topic-root',
    status: 'archived',
    runtimeEnabled: false,
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function syncClient({ before = [], after = desiredTopics, locked = true, written } = {}) {
  let readCount = 0;
  const queries = [];
  const client = {
    query: vi.fn(async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
      if (sql.includes('FROM public.topics') && sql.includes('ORDER BY id')) {
        readCount += 1;
        return { rows: clone(readCount === 1 ? before : after) };
      }
      if (sql.startsWith('INSERT INTO public.topics')) {
        return { rowCount: written ?? parameters[0].length, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
  };
  return { client, queries };
}

describe('Topic database sync planning', () => {
  it('normalizes order and produces a stable projection fingerprint', () => {
    expect(normalizeDesiredTopics([...desiredTopics].reverse()).map((topic) => topic.id)).toEqual([
      'topic-archived',
      'topic-child',
      'topic-root',
    ]);
    expect(topicProjectionFingerprint([...desiredTopics].reverse())).toBe(
      topicProjectionFingerprint(desiredTopics),
    );
    expect(topicProjectionFingerprint(desiredTopics)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('plans inserts, owned-field updates and true no-op rows', () => {
    const plan = planTopicSync(desiredTopics, [
      { ...desiredTopics[0] },
      { ...desiredTopics[1], title: 'Drifted', runtimeEnabled: false },
    ]);

    expect(plan.inserts.map((topic) => topic.id)).toEqual(['topic-archived']);
    expect(plan.updates.map((topic) => topic.id)).toEqual(['topic-child']);
    expect(plan.unchanged.map((topic) => topic.id)).toEqual(['topic-root']);
    expect(plan.changedIds).toEqual(['topic-archived', 'topic-child']);
    expect(plan.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(planTopicSync(desiredTopics, plan.unchanged).planFingerprint).not.toBe(
      plan.planFingerprint,
    );
  });

  it('fails closed on unknown database IDs and invalid desired hierarchy', () => {
    expect(() =>
      planTopicSync(desiredTopics, [
        ...desiredTopics,
        {
          id: 'topic-unknown',
          title: 'Unknown',
          parentId: null,
          status: 'watching',
          runtimeEnabled: false,
        },
      ]),
    ).toThrow(/outside authoritative Taxonomy: topic-unknown/);

    expect(() =>
      normalizeDesiredTopics([{ ...desiredTopics[1], parentId: 'topic-missing' }]),
    ).toThrow(/missing parent topic-missing/);
    expect(() =>
      normalizeDesiredTopics([{ ...desiredTopics[0], parentId: 'topic-child' }, desiredTopics[1]]),
    ).toThrow(/contains a cycle/);
    expect(() =>
      normalizeDesiredTopics([
        { ...desiredTopics[0], parentId: 'topic-child' },
        { ...desiredTopics[1], parentId: 'topic-missing' },
      ]),
    ).toThrow(/Desired Topic topic-child has missing parent topic-missing/);
    expect(() =>
      normalizeDesiredTopics([{ ...desiredTopics[2], parentId: null, runtimeEnabled: true }]),
    ).toThrow(/Archived desired Topic/);
  });
});

describe('Topic database sync transaction', () => {
  it('uses parameterized bulk upsert, verifies the result and commits an apply', async () => {
    const { client, queries } = syncClient();
    const result = await syncTopics(client, desiredTopics, { dryRun: false });

    expect(result).toMatchObject({
      mode: 'apply',
      committed: true,
      desiredCount: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
    });
    const write = queries.find(({ sql }) => sql.startsWith('INSERT INTO public.topics'));
    expect(write.sql).toContain('FROM unnest(');
    expect(write.sql).toContain('IS DISTINCT FROM');
    expect(write.sql).not.toContain("Child's Topic");
    expect(write.parameters[1]).toContain("Child's Topic");
    expect(queries.at(-1).sql).toBe('COMMIT');
  });

  it('performs a full dry-run and rolls every write back', async () => {
    const { client, queries } = syncClient();
    const result = await syncTopics(client, desiredTopics);

    expect(result).toMatchObject({ mode: 'dry-run', committed: false, inserted: 3 });
    expect(queries.at(-1).sql).toBe('ROLLBACK');
  });

  it('does not issue an upsert for an idempotent no-op', async () => {
    const { client, queries } = syncClient({ before: desiredTopics });
    const result = await syncTopics(client, desiredTopics, { dryRun: false });

    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 });
    expect(queries.some(({ sql }) => sql.startsWith('INSERT INTO public.topics'))).toBe(false);
  });

  it('fails fast on advisory-lock contention and rolls back', async () => {
    const { client, queries } = syncClient({ locked: false });
    await expect(syncTopics(client, desiredTopics, { dryRun: false })).rejects.toThrow(
      /migration or Topic sync process currently holds the lock/,
    );
    expect(queries.at(-1).sql).toBe('ROLLBACK');
  });

  it('rechecks the reviewed projection fingerprint while locked and before upsert', async () => {
    const projectionFingerprint = topicProjectionFingerprint(desiredTopics);
    const accepted = syncClient();
    await expect(
      syncTopics(accepted.client, desiredTopics, {
        dryRun: false,
        expectedProjectionFingerprint: projectionFingerprint,
      }),
    ).resolves.toMatchObject({ fingerprint: projectionFingerprint });

    const rejected = syncClient();
    const mismatchedFingerprint =
      projectionFingerprint === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    await expect(
      syncTopics(rejected.client, desiredTopics, {
        dryRun: false,
        expectedProjectionFingerprint: mismatchedFingerprint,
      }),
    ).rejects.toThrow(/projection fingerprint mismatch inside the locked transaction/);
    expect(rejected.queries.some(({ sql }) => sql.includes('pg_try_advisory_xact_lock'))).toBe(
      true,
    );
    expect(rejected.queries.some(({ sql }) => sql.startsWith('LOCK TABLE public.topics'))).toBe(
      true,
    );
    expect(rejected.queries.some(({ sql }) => sql.startsWith('INSERT INTO public.topics'))).toBe(
      false,
    );
    expect(rejected.queries.at(-1).sql).toBe('ROLLBACK');
  });

  it('binds apply to the exact database plan observed by dry-run', async () => {
    const reviewed = planTopicSync(desiredTopics, []);
    const accepted = syncClient();
    await expect(
      syncTopics(accepted.client, desiredTopics, {
        dryRun: false,
        expectedPlanFingerprint: reviewed.planFingerprint,
      }),
    ).resolves.toMatchObject({ planFingerprint: reviewed.planFingerprint });

    const changedDatabaseState = syncClient({ before: [desiredTopics[0]] });
    await expect(
      syncTopics(changedDatabaseState.client, desiredTopics, {
        dryRun: false,
        expectedPlanFingerprint: reviewed.planFingerprint,
      }),
    ).rejects.toThrow(/plan fingerprint mismatch/);
    expect(
      changedDatabaseState.queries.some(({ sql }) => sql.startsWith('INSERT INTO public.topics')),
    ).toBe(false);
    expect(changedDatabaseState.queries.at(-1).sql).toBe('ROLLBACK');
  });

  it('rolls back when the write count or read-back verification is incomplete', async () => {
    const shortWrite = syncClient({ written: 2 });
    await expect(syncTopics(shortWrite.client, desiredTopics, { dryRun: false })).rejects.toThrow(
      /wrote 2 rows, but the plan required 3/,
    );
    expect(shortWrite.queries.at(-1).sql).toBe('ROLLBACK');

    const residualDrift = syncClient({ after: [{ ...desiredTopics[0], title: 'Still drifted' }] });
    await expect(
      syncTopics(residualDrift.client, desiredTopics, { dryRun: false }),
    ).rejects.toThrow(/residual drift/);
    expect(residualDrift.queries.at(-1).sql).toBe('ROLLBACK');
  });
});
