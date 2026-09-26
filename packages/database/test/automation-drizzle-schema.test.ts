import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { automationConfigs, automationRuns } from '../src/schema.js';
import {
  automationColumns,
  automationChecks,
  automationPrimaryKeys,
  automationForeignKeys,
  automationUniqueIndexes,
  automationIndexes,
  automationDefaults,
} from '../src/automation-catalog.mjs';

const tables = [automationConfigs, automationRuns];

describe('automation schema mapping', () => {
  it('keeps both Drizzle tables aligned with the independent migration catalog', () => {
    expect(tables.map(getTableName)).toEqual(Object.keys(automationColumns));
    const primaryKeys: string[] = [];
    const foreignKeys: string[] = [];
    const uniqueIndexes: string[] = [];
    const indexes: string[] = [];
    const defaults: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      expect(
        config.columns.map((column) => [column.name, [column.getSQLType(), column.notNull]]),
      ).toEqual(Object.entries(automationColumns[name]));
      expect(config.checks).toHaveLength(automationChecks[name].length);
      primaryKeys.push(
        ...config.columns
          .filter((column) => column.primary)
          .map((column) => `${name}|${column.name}`),
      );
      defaults.push(
        ...config.columns
          .filter((column) => column.hasDefault)
          .map((column) => `${name}.${column.name}`),
      );
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        expect(foreignKey.onDelete).toBe('no action');
        expect(foreignKey.onUpdate).toBe('no action');
        foreignKeys.push(
          `${name}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`,
        );
      }
      for (const { config: index } of config.indexes) {
        const signature = `${name}|${index.columns.map((column) => 'name' in column && column.name).join(',')}`;
        if (index.unique) uniqueIndexes.push(signature);
        else indexes.push(signature);
      }
    }
    expect(primaryKeys).toEqual(automationPrimaryKeys);
    expect(foreignKeys).toEqual(automationForeignKeys);
    expect(uniqueIndexes).toEqual(automationUniqueIndexes);
    expect(indexes).toEqual(automationIndexes);
    expect(defaults.sort()).toEqual(automationDefaults.map(([name]) => name).sort());
  });
});
