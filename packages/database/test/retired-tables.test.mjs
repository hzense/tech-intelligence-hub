import { describe, expect, it } from 'vitest';
import {
  expectedMigrationTableNames,
  retiredTableNames,
  unusedTableRetirementMigration,
} from '../src/retired-tables.mjs';
import { expectedTableNames } from '../src/verify.mjs';
import * as schema from '../src/schema.js';

describe('retired table preflight boundary', () => {
  it('removes exactly the four retired tables from the latest schema contract', () => {
    expect(expectedTableNames.size).toBe(58);
    expect(expectedTableNames.has('hzense_schema_migrations')).toBe(true);
    expect(retiredTableNames).toEqual([
      'content_registry',
      'entity_topics',
      'radar_snapshot_signals',
      'radar_snapshots',
    ]);
    for (const name of retiredTableNames) expect(expectedTableNames.has(name)).toBe(false);
    for (const name of [
      'contentRegistry',
      'entityTopics',
      'radarSnapshotSignals',
      'radarSnapshots',
    ])
      expect(schema).not.toHaveProperty(name);
    for (const name of ['signals', 'signal_versions', 'editorial_signal_revisions', 'relations'])
      expect(expectedTableNames.has(name)).toBe(true);
  });

  it('permits only the four known old tables while the exact retirement is pending', () => {
    const allowed = expectedMigrationTableNames(expectedTableNames, [
      { name: unusedTableRetirementMigration },
    ]);
    expect(allowed.size).toBe(62);
    expect(allowed.has('unknown_business_table')).toBe(false);
    for (const name of retiredTableNames) expect(allowed.has(name)).toBe(true);
    // Migration preflight must not weaken the shared latest-schema/ACL contract.
    expect(expectedTableNames.size).toBe(58);
  });

  it.each([
    { label: 'up to date', pending: [] },
    { label: 'unreviewed name', pending: [{ name: '0031_unreviewed.sql' }] },
    { label: 'unrelated migration', pending: [{ name: '0032_future.sql' }] },
  ])('rejects retired table reappearance when retirement is not pending: $label', ({ pending }) => {
    const allowed = expectedMigrationTableNames(expectedTableNames, pending);
    expect(allowed).toEqual(expectedTableNames);
    expect(allowed).not.toBe(expectedTableNames);
    for (const name of retiredTableNames) expect(allowed.has(name)).toBe(false);
  });
});
