import { fileURLToPath, URL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../../content/src/seed.ts';
import { projectLegacySignalEntries } from '../../../apps/web/lib/legacy-signal-projection.ts';
import {
  buildLegacySignalArchivePlan,
  legacySignalArchiveReadQuery,
} from '../src/legacy-signal-archive.mjs';
import {
  inspectUnifiedSignalMigration,
  unifiedCoreInventoryQuery,
  unifiedEditorialHistoryQuery,
} from '../src/unified-signal-preflight.mjs';

let archive;
beforeAll(async () => {
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
    fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  );
  archive = buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog));
});
function adapter({
  rows = archive.rows,
  core = { signal_count: '0', version_count: '0' },
  history = [],
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql === legacySignalArchiveReadQuery) return { rows };
      if (sql === unifiedEditorialHistoryQuery) return { rows: history };
      if (sql === unifiedCoreInventoryQuery) return { rows: [core] };
      if (
        [
          'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
          "SET LOCAL statement_timeout='30s'",
          'COMMIT',
          'ROLLBACK',
        ].includes(sql)
      )
        return {};
      throw new Error('unexpected_sql');
    },
  };
}
describe('unified Signal read-only preflight', () => {
  it('reads a single consistent snapshot and explicitly refuses to authorize cutover', async () => {
    const client = adapter();
    const { summary, plan } = await inspectUnifiedSignalMigration(client);
    expect(client.calls).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      "SET LOCAL statement_timeout='30s'",
      legacySignalArchiveReadQuery,
      unifiedEditorialHistoryQuery,
      unifiedCoreInventoryQuery,
      'COMMIT',
    ]);
    expect(summary).toMatchObject({
      status: 'preview_only',
      cutover_ready: false,
      signals: 110,
      versions: 110,
      public_preview: 110,
    });
    expect(summary.blockers).toHaveLength(3);
    expect(plan.plan_hash).toBe(summary.plan_hash);
    expect(JSON.stringify(summary)).not.toContain('source_record');
  });
  it('flags existing original core records instead of ignoring or overwriting them', async () => {
    const { summary } = await inspectUnifiedSignalMigration(
      adapter({ core: { signal_count: '2', version_count: '5' } }),
    );
    expect(summary.blockers).toContain('existing_core_signals_require_reconciliation');
  });
  it('rolls back read-only inspection if source archive differs from reviewed inventory', async () => {
    const client = adapter({ rows: archive.rows.slice(1) });
    await expect(inspectUnifiedSignalMigration(client)).rejects.toThrow(
      'legacy_archive_frozen_plan_mismatch',
    );
    expect(client.calls.at(-1)).toBe('ROLLBACK');
    expect(client.calls).not.toContain(unifiedEditorialHistoryQuery);
  });
  it('fails closed on missing original table inventory', async () => {
    const client = adapter({ core: { signal_count: null, version_count: '0' } });
    await expect(inspectUnifiedSignalMigration(client)).rejects.toThrow(
      'unified_inventory_unavailable',
    );
    expect(client.calls.at(-1)).toBe('ROLLBACK');
  });
});
