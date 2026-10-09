// Only migration preflight may accept these historical tables, and only while
// the exact retirement migration is pending in a checksum-verified history.
// Latest-schema / role verification must continue to reject them.
export const unusedTableRetirementMigration = '0031_retire_unused_tables.sql';
export const retiredTableNames = Object.freeze([
  'content_registry',
  'entity_topics',
  'radar_snapshot_signals',
  'radar_snapshots',
]);

export function expectedMigrationTableNames(latestTableNames, pendingMigrations) {
  return new Set([
    ...latestTableNames,
    ...(pendingMigrations.some(({ name }) => name === unusedTableRetirementMigration)
      ? retiredTableNames
      : []),
  ]);
}
