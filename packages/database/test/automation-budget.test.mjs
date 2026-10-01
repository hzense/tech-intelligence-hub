import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { claimAutomationRun } from '../src/automation-store.mjs';

const owner = 'admin@example.invalid';

function queuedRunHarness(used, snapshot = { kind: 'topic_insight' }) {
  const id = randomUUID();
  const configId = randomUUID();
  const queries = [];
  const query = vi.fn(async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM public.automation_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE')) {
      return {
        rows: [
          {
            id,
            config_id: configId,
            owner_id: owner,
            status: 'queued',
            snapshot,
            trigger: 'manual',
            config_revision: 1,
          },
        ],
      };
    }
    if (sql.includes('SELECT revision,enabled FROM public.automation_configs')) {
      return { rows: [{ revision: 1, enabled: true }] };
    }
    if (sql.includes('SELECT COALESCE(sum(')) return { rows: [{ used }] };
    return { rows: [] };
  });
  return { id, queries, pool: { connect: async () => ({ query, release() {} }) } };
}

describe('automation budget claim', () => {
  it('reserves the global ledger for AI discovery, not just insight reports', async () => {
    const { id, queries, pool } = queuedRunHarness(75, {
      kind: 'source_collection',
      discovery: { maxSources: 5 },
    });
    await expect(
      claimAutomationRun({ pool, owner, id, limits: { batch: 100, daily: 100, reserve: 50 } }),
    ).resolves.toBeNull();
    expect(queries.some((sql) => sql.includes("phase='budget_exceeded'"))).toBe(true);
    expect(queries.some((sql) => sql.includes("SET status='running'"))).toBe(false);
  });
  it.each([
    ['missing limits', undefined, 0, 'not_configured'],
    ['daily limit exhausted', { batch: 100, daily: 100, reserve: 50 }, 75, 'budget_exceeded'],
  ])('records %s as a final task result', async (_label, limits, used, errorCode) => {
    const { id, queries, pool } = queuedRunHarness(used);
    await expect(claimAutomationRun({ pool, owner, id, limits })).resolves.toBeNull();
    expect(queries.some((sql) => sql.includes(`status='failed',phase='${errorCode}'`))).toBe(true);
    expect(queries).toContain('COMMIT');
    expect(queries.some((sql) => sql.includes("SET status='running'"))).toBe(false);
  });
});
