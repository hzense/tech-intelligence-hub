import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { radarSnapshots, radarSnapshotSignals, signals, sources } from '../src/schema.js';

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe('Radar evidence persistence schema', () => {
  it('keeps Signal and Radar evidence fields aligned with the information model', () => {
    expect(columnNames(signals)).toContain('source_url');
    expect(columnNames(sources)).toContain('allowed_hosts');
    expect(columnNames(radarSnapshots)).toEqual(expect.arrayContaining(['domain', 'reasoning']));
    expect(columnNames(radarSnapshotSignals)).toEqual(['snapshot_id', 'signal_id', 'position']);

    const evidenceConfig = getTableConfig(radarSnapshotSignals);
    expect(evidenceConfig.primaryKeys).toHaveLength(1);
    expect(evidenceConfig.foreignKeys).toHaveLength(2);
  });

  it('ships an expand-backfill-constrain SQL migration for the evidence contract', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0001_radar_evidence.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN allowed_hosts text[];');
    expect(migration).toContain('ADD COLUMN source_url text;');
    expect(migration).toContain('ADD COLUMN domain radar_domain;');
    expect(migration).toContain('ADD COLUMN reasoning text;');
    expect(migration).toContain('requires an exact source_url backfill');
    expect(migration).toContain('LOCK TABLE signal_topics IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain("SET occurred_at = '2024-06-21T00:00:00Z'");
    expect(migration).toContain("'radar-20260827-ai-security',");
    expect(migration).toContain("'medium',\n      0.4,");
    expect(migration).toContain('ALTER TABLE signals ALTER COLUMN source_url SET NOT NULL');
    expect(migration).not.toContain('ADD COLUMN source_url text NOT NULL');
    expect(migration).toContain('CREATE TABLE radar_snapshot_signals');
    expect(migration).toContain('radar_snapshot_signal_position_uq');
    expect(migration).toContain('INSERT INTO radar_snapshot_signals');
    expect(migration).toContain('requires at least one persisted evidence signal per snapshot');
  });
});
