import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  radarSnapshots,
  radarSnapshotSignals,
  searchDocuments,
  signals,
  sources,
  topics,
} from '../src/schema.js';

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

describe('Topic runtime projection schema', () => {
  it('keeps runtime eligibility separate from canonical Topic identity and status', () => {
    const topicConfig = getTableConfig(topics);

    expect(columnNames(topics)).toEqual([
      'id',
      'title',
      'parent_id',
      'status',
      'metadata',
      'runtime_enabled',
    ]);
    expect(topicConfig.checks.map((constraint) => constraint.name)).toContain(
      'topics_runtime_enabled_status_ck',
    );
  });

  it('ships an append-only migration with the reviewed runtime backfill', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0002_topic_projection.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN runtime_enabled boolean NOT NULL DEFAULT false;');
    expect(migration).toContain("SET runtime_enabled = status IN ('active', 'strategic');");
    expect(migration).toContain("CHECK (NOT runtime_enabled OR status <> 'archived');");
  });
});

describe('FTS-1 Search Document schema', () => {
  it('models the persisted display, normalized and generated search fields', () => {
    expect(columnNames(searchDocuments)).toEqual([
      'id',
      'source_id',
      'source_type',
      'title',
      'summary',
      'href',
      'keywords',
      'body',
      'importance',
      'document_date',
      'topics',
      'entities',
      'embedding',
      'normalized_title',
      'normalized_summary',
      'normalized_keywords',
      'normalized_body',
      'search_vector',
    ]);
    const config = getTableConfig(searchDocuments);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'search_source_idx',
        'search_documents_source_identity_uq',
        'search_documents_date_idx',
        'search_documents_fts_idx',
      ]),
    );
  });

  it('ships an append-only guarded persistence and GIN-index migration', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0003_search_documents_fts.sql'),
      'utf8',
    );

    expect(migration).toContain('requires an empty derived search_documents table');
    expect(migration).toContain('ADD COLUMN summary text NOT NULL');
    expect(migration).toContain('ADD COLUMN search_vector tsvector GENERATED ALWAYS AS');
    expect(migration).toContain("to_tsvector('pg_catalog.simple'::regconfig");
    expect(migration).toContain('USING gin(search_vector)');
  });
});
