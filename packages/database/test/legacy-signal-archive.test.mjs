import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../../content/src/seed.ts';
import { projectLegacySignalEntries } from '../../../apps/web/lib/legacy-signal-projection.ts';
import {
  applyLegacySignalArchive,
  assertLegacySignalArchivePlan,
  buildLegacySignalArchivePlan,
  canonicalLegacyArchiveJson,
  reconcileLegacySignalArchive,
} from '../src/legacy-signal-archive.mjs';
import {
  legacyArchiveCount,
  legacyArchivePlanHash,
  legacyArchiveProjectionHashes,
} from '../src/legacy-signal-archive-manifest.mjs';

export async function archiveFixture() {
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
    fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  );
  const projections = projectLegacySignalEntries(catalog);
  return { catalog, projections, plan: buildLegacySignalArchivePlan(catalog, projections) };
}

describe('frozen historical Signal archive', () => {
  it('preserves all 110 original identities, dates, roles, links and missing strength', async () => {
    const { catalog, projections, plan } = await archiveFixture();
    expect(plan.count).toBe(110);
    expect(plan.count).toBe(legacyArchiveCount);
    expect(plan.plan_hash).toBe(legacyArchivePlanHash);
    expect(assertLegacySignalArchivePlan(plan)).toBe(plan);
    expect(Object.keys(legacyArchiveProjectionHashes)).toHaveLength(110);
    for (const row of plan.rows) {
      const original = catalog.signals.find((signal) => signal.id === row.signal_id);
      expect(row.signal).toEqual(original);
      expect(row.projection).toEqual(projections.find((signal) => signal.id === row.signal_id));
      expect(row.signal).not.toHaveProperty('strength');
      expect(row.projection).not.toHaveProperty('public_version');
      expect(row.projection).not.toHaveProperty('publication_revision');
      expect(row.projection).not.toHaveProperty('publication_basis');
      expect(row.references.entities.map((entity) => entity.id)).toEqual(original.entities);
      expect(row.references.topics.map((topic) => topic.id)).toEqual(original.topics);
      expect(row.references.source.id).toBe(original.source_id);
      expect(row.content_hash).toBe(legacyArchiveProjectionHashes[row.signal_id]);
    }
    const noPeople = plan.rows.filter((row) => row.projection.public_people.length === 0);
    const nonParticipants = plan.rows.filter(
      (row) => row.projection.legacy_related_entities.length > 0,
    );
    expect(noPeople.length).toBeGreaterThan(0);
    expect(nonParticipants.length).toBeGreaterThan(0);
  });

  it('hashes JSONB readback independent of object key order without changing arrays or dates', () => {
    const source = { z: ['b', 'a'], a: { title: ' 科研 ', date: '2026-10-04T00:00:00Z' } };
    expect(canonicalLegacyArchiveJson(source)).toBe(
      canonicalLegacyArchiveJson({ a: source.a, z: source.z }),
    );
    expect(canonicalLegacyArchiveJson(source)).not.toBe(
      canonicalLegacyArchiveJson({ ...source, z: ['a', 'b'] }),
    );
    expect(() => canonicalLegacyArchiveJson({ missing: undefined })).toThrow(
      'legacy_archive_non_json_value',
    );
  });

  it('rejects missing references, dropped projections and publication promotion', async () => {
    const { catalog, projections } = await archiveFixture();
    expect(() => buildLegacySignalArchivePlan({ ...catalog, sources: [] }, projections)).toThrow(
      'legacy_archive_missing_reference',
    );
    expect(() => buildLegacySignalArchivePlan(catalog, projections.slice(1))).toThrow(
      'legacy_archive_projection_set_mismatch',
    );
    expect(() =>
      buildLegacySignalArchivePlan(catalog, [
        { ...projections[0], public_version: 1 },
        ...projections.slice(1),
      ]),
    ).toThrow('legacy_archive_publication_promotion');
    expect(() =>
      buildLegacySignalArchivePlan(catalog, [
        { ...projections[0], occurred_at: '2026-10-04T00:00:00Z' },
        ...projections.slice(1),
      ]),
    ).toThrow('legacy_archive_projection_content_mismatch');
  });

  it('rejects changes to the reviewed plan before performing any query', async () => {
    const { plan } = await archiveFixture();
    plan.rows[0].signal.summary += 'changed';
    const client = {
      query: () => {
        throw new Error('unexpected query');
      },
    };
    await expect(applyLegacySignalArchive(client, plan)).rejects.toThrow(
      'legacy_archive_frozen_plan_mismatch',
    );
  });

  it('identical rows are idempotent and forged matching hashes do not conceal content changes', async () => {
    const { plan } = await archiveFixture();
    const queries = [];
    const identical = {
      async query(sql) {
        queries.push(sql);
        return { rows: sql.startsWith('SELECT') ? globalThis.structuredClone(plan.rows) : [] };
      },
    };
    expect(await applyLegacySignalArchive(identical, plan)).toEqual({
      inserted: 0,
      existing: 110,
      count: 110,
      plan_hash: plan.plan_hash,
    });
    expect(queries.some((sql) => sql.startsWith('INSERT'))).toBe(false);
    const altered = globalThis.structuredClone(plan.rows);
    altered[0].projection.title += 'changed';
    await expect(
      reconcileLegacySignalArchive({ query: async () => ({ rows: altered }) }, plan),
    ).rejects.toThrow('legacy_archive_existing_content_conflict');
    await expect(
      reconcileLegacySignalArchive(
        { query: async () => ({ rows: [...plan.rows, plan.rows[0]] }) },
        plan,
      ),
    ).rejects.toThrow('legacy_archive_existing_content_conflict');
  });
});
