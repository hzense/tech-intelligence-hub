import { beforeAll, describe, expect, it, vi } from 'vitest';
import { legacySignalArchiveReadQuery } from '../src/legacy-signal-archive.mjs';
import {
  unifiedEditorialHistoryQuery,
  unifiedSourcePublicIdsQuery,
} from '../src/unified-signal-preflight.mjs';
import {
  applyUnifiedSignalBackfill,
  verifyUnifiedSignalBackfill,
  unifiedMasterReadQuery,
  unifiedVersionReadQuery,
  unifiedMasterInsertQuery,
  unifiedVersionInsertQuery,
  unifiedBackfillLockQuery,
  unifiedBackfillPublicPreviewQuery,
} from '../src/unified-signal-backfill.mjs';
import { unifiedBackfillFixture } from './fixtures/unified-signal-backfill.mjs';

let fixture;
beforeAll(async () => {
  fixture = await unifiedBackfillFixture();
});
function adapter() {
  let committed = { masters: [], versions: [] };
  let active;
  const calls = [];
  const client = {
    calls,
    commitReplyLost: false,
    failInsert: false,
    state: () => committed,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('BEGIN')) {
        active = globalThis.structuredClone(committed);
        return {};
      }
      if (sql === 'ROLLBACK') {
        active = undefined;
        return {};
      }
      if (sql === 'COMMIT') {
        committed = active;
        active = undefined;
        if (client.commitReplyLost) {
          client.commitReplyLost = false;
          throw new Error('private-host');
        }
        return {};
      }
      if (sql.startsWith('SET ') || sql === unifiedBackfillLockQuery) return {};
      if (sql === legacySignalArchiveReadQuery) return { rows: fixture.sources.archivePlan.rows };
      if (sql === unifiedEditorialHistoryQuery) return { rows: fixture.sources.editorialRevisions };
      if (sql === unifiedSourcePublicIdsQuery) return { rows: fixture.publicIds };
      const target = active ?? committed;
      if (sql === unifiedMasterReadQuery) return { rows: target.masters };
      if (sql === unifiedVersionReadQuery) return { rows: target.versions };
      if (sql === unifiedBackfillPublicPreviewQuery)
        return {
          rows: target.masters.flatMap((master) => {
            const row = target.versions.find(
              (v) => v.signal_id === master.id && v.version === master.latest_version,
            );
            return row?.status === 'published'
              ? [
                  {
                    id: master.id,
                    version: row.version,
                    origin: row.origin,
                    publication_basis: row.publication_basis,
                    content: row.content,
                  },
                ]
              : [];
          }),
        };
      if (sql === unifiedMasterInsertQuery) {
        if (client.failInsert) throw new Error('private-record');
        target.masters.push({
          id: values[0],
          storage_schema: '4.0.0',
          origin: values[1],
          latest_version: values[2],
        });
        return {};
      }
      if (sql === unifiedVersionInsertQuery) {
        target.versions.push({
          signal_id: values[0],
          version: values[1],
          schema_version: values[2],
          origin: values[3],
          content: JSON.parse(values[4]),
          publication_basis: values[5],
          status: values[6],
          recorded_at: values[7],
          source_record: JSON.parse(values[8]),
          source_record_hash: values[9],
          content_hash: values[10],
        });
        return {};
      }
      throw new Error('unexpected_sql');
    },
  };
  return client;
}
const input = (gate = vi.fn(async () => {})) => ({
  expectedPlanHash: fixture.plan.plan_hash,
  checkBeforeCommit: gate,
});

describe('unified Signal backfill transaction kernel', () => {
  it('writes 114 identities and 120 immutable versions; only 112 are currently published', async () => {
    const client = adapter();
    const gate = vi.fn(async () => {});
    const result = await applyUnifiedSignalBackfill(client, input(gate));
    expect(result).toMatchObject({
      signalCount: 114,
      versionCount: 120,
      publicCount: 112,
      inserted: 114,
      committed: true,
      cutoverReady: false,
    });
    expect(gate).toHaveBeenCalledOnce();
    expect(client.state().versions).toEqual(fixture.plan.signal_versions);
    const sql = client.calls.map((c) => c.sql);
    expect(sql.indexOf(unifiedBackfillLockQuery)).toBeLessThan(
      sql.indexOf(legacySignalArchiveReadQuery),
    );
    expect(sql.indexOf('SET CONSTRAINTS ALL IMMEDIATE')).toBeLessThan(
      sql.lastIndexOf(unifiedVersionReadQuery),
    );
    expect(sql.at(-1)).toBe('COMMIT');
    expect(JSON.stringify(result)).not.toMatch(/synthetic-owner|source_record|研究|request_id/);
  });
  it('validates a plan binding and a gate before touching the borrowed client', async () => {
    const client = adapter();
    await expect(applyUnifiedSignalBackfill(client)).rejects.toMatchObject({
      code: 'unified_backfill_plan_required',
    });
    await expect(
      applyUnifiedSignalBackfill(client, { expectedPlanHash: fixture.plan.plan_hash }),
    ).rejects.toMatchObject({ code: 'unified_backfill_gate_required' });
    expect(client.calls).toHaveLength(0);
  });
  it('rejects changed sources before any insert', async () => {
    const client = adapter();
    await expect(
      applyUnifiedSignalBackfill(client, { ...input(), expectedPlanHash: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'unified_backfill_plan_changed', mayHaveCommitted: false });
    expect(client.calls.some((c) => c.sql === unifiedMasterInsertQuery)).toBe(false);
    expect(client.calls.at(-1).sql).toBe('ROLLBACK');
  });
  it('rolls back all inserts if approval expires before commit', async () => {
    const client = adapter();
    await expect(
      applyUnifiedSignalBackfill(
        client,
        input(async () => {
          throw new Error('approval-expired');
        }),
      ),
    ).rejects.toMatchObject({ phase: 'authorization', mayHaveCommitted: false });
    expect(client.state()).toEqual({ masters: [], versions: [] });
    expect(client.calls.some((c) => c.sql === 'COMMIT')).toBe(false);
  });
  it('rolls back on database failures without exposing SQL or content in the error message', async () => {
    const client = adapter();
    client.failInsert = true;
    await expect(applyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
      message: 'unified_backfill_failed',
      phase: 'insert',
      mayHaveCommitted: false,
    });
    expect(client.state()).toEqual({ masters: [], versions: [] });
  });
  it('marks a lost commit reply unknown and never replays; separate read-only verification succeeds', async () => {
    const client = adapter();
    client.commitReplyLost = true;
    await expect(applyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
      code: 'unified_backfill_commit_unknown',
      phase: 'commit',
      mayHaveCommitted: true,
    });
    expect(client.calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(1);
    const start = client.calls.length;
    expect(await verifyUnifiedSignalBackfill(client, input())).toMatchObject({
      verificationCompleted: true,
      publicCount: 112,
      cutoverReady: false,
    });
    expect(
      client.calls.slice(start).every((c) => !/^(INSERT|LOCK|UPDATE|DELETE)/.test(c.sql)),
    ).toBe(true);
  });
  it('recognizes an exact previous import without issuing more inserts or a commit', async () => {
    const client = adapter();
    await applyUnifiedSignalBackfill(client, input());
    const start = client.calls.length;
    expect(await applyUnifiedSignalBackfill(client, input())).toMatchObject({
      alreadyPresent: true,
      inserted: 0,
      committed: false,
    });
    expect(
      client.calls.slice(start).some((c) => c.sql.startsWith('INSERT') || c.sql === 'COMMIT'),
    ).toBe(false);
  });
  it.each(['content', 'source', 'status', 'head', 'missing', 'extra', 'v3'])(
    'rejects %s conflicts without repair or overwrite',
    async (kind) => {
      const client = adapter();
      await applyUnifiedSignalBackfill(client, input());
      const state = client.state();
      if (kind === 'content') state.versions[0].content.title += 'changed without updating hash';
      if (kind === 'source') state.versions[0].source_record.key = 'wrong';
      if (kind === 'status')
        state.versions[0].status =
          state.versions[0].status === 'published' ? 'withdrawn' : 'published';
      if (kind === 'head') state.masters[0].latest_version += 1;
      if (kind === 'missing') state.versions.pop();
      if (kind === 'extra') state.masters.push({ id: 'extra' });
      if (kind === 'v3') state.masters[0].storage_schema = '3.0.0';
      const start = client.calls.length;
      await expect(applyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
        code: 'unified_backfill_target_conflict',
      });
      expect(client.calls.slice(start).some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql))).toBe(
        false,
      );
      await expect(verifyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
        code: 'unified_backfill_target_conflict',
      });
    },
  );
  it('rejects a divergent public projection even when full stored rows match', async () => {
    const client = adapter();
    await applyUnifiedSignalBackfill(client, input());
    const originalQuery = client.query.bind(client);
    client.query = async (sql, values) => {
      const result = await originalQuery(sql, values);
      return sql === unifiedBackfillPublicPreviewQuery ? { rows: result.rows.slice(1) } : result;
    };
    await expect(verifyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
      code: 'unified_backfill_public_conflict',
    });
    await expect(applyUnifiedSignalBackfill(client, input())).rejects.toMatchObject({
      code: 'unified_backfill_public_conflict',
      mayHaveCommitted: false,
    });
  });
  it('does not call an empty target a completed verification', async () => {
    await expect(verifyUnifiedSignalBackfill(adapter(), input())).rejects.toMatchObject({
      code: 'unified_backfill_incomplete',
      phase: 'verify',
    });
  });
});
