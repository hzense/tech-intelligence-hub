import { readFile } from 'node:fs/promises';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  aiConnections,
  aiConnectionVersions,
  aiProfiles,
  aiProfileVersions,
  aiProbeRuns,
} from '../src/schema.js';
import {
  aiConfigurationColumns,
  aiConfigurationPrimaryKeys,
  aiConfigurationForeignKeys,
  aiConfigurationChecks,
  aiConfigurationDefaults,
  aiConfigurationIndexes,
} from '../src/ai-configuration-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';

const tables = [aiConnections, aiConnectionVersions, aiProfiles, aiProfileVersions, aiProbeRuns];
const dialect = new PgDialect();
const ddl = await readFile(
  new URL('../../../db/migrations/0013_ai_configuration.sql', import.meta.url),
  'utf8',
);
describe('Private AI configuration schema', () => {
  it('pins exactly five private tables and all column types/nullability', () => {
    expect(expectedTableNames.size).toBe(47);
    expect(tables.map(getTableName)).toEqual(Object.keys(aiConfigurationColumns));
    for (const table of tables) {
      const name = getTableName(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        getTableConfig(table).columns.map((column) => [
          column.name,
          [column.getSQLType(), column.notNull],
        ]),
      ).toEqual(Object.entries(aiConfigurationColumns[name]));
    }
  });
  it('binds probes to immutable connection revisions without cascades or business FKs', () => {
    const primaryKeys = [];
    const foreignKeys = [];
    const indexes = [];
    for (const table of tables) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      primaryKeys.push(
        ...config.columns
          .filter((column) => column.primary)
          .map((column) => `${name}|${column.name}`),
      );
      primaryKeys.push(
        ...config.primaryKeys.map(
          (key) => `${name}|${key.columns.map((column) => column.name).join(',')}`,
        ),
      );
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        expect(key.onDelete).toBe('no action');
        expect(key.onUpdate).toBe('no action');
        foreignKeys.push(
          `${name}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`,
        );
      }
      for (const { config: index } of config.indexes) {
        expect(index.unique).toBe(false);
        indexes.push(
          `${name}|${index.columns.map((column) => 'name' in column && column.name).join(',')}`,
        );
      }
    }
    expect(primaryKeys).toEqual(aiConfigurationPrimaryKeys);
    expect(foreignKeys).toEqual(aiConfigurationForeignKeys);
    expect(indexes).toEqual(aiConfigurationIndexes);
  });
  it('keeps exact defaults including disabled connections and lossless integer costs', () => {
    const defaults = new Map(aiConfigurationDefaults);
    const actual = [];
    for (const table of tables) {
      const name = getTableName(table);
      for (const column of getTableConfig(table).columns.filter((value) => value.hasDefault)) {
        const key = `${name}.${column.name}`;
        actual.push(key);
        const value = column.default;
        const expression =
          typeof value === 'object' && value !== null && 'getSQL' in value
            ? dialect.sqlToQuery(value.getSQL()).sql
            : typeof value === 'object'
              ? `'${JSON.stringify(value)}'`
              : String(value);
        expect(defaults.get(key)?.has(canonicalCatalogExpression(expression))).toBe(true);
      }
    }
    expect(actual.sort()).toEqual([...defaults.keys()].sort());
    expect(aiProbeRuns.reservedMicrousd.mapFromDriverValue('9007199254740993')).toBe(
      9007199254740993n,
    );
  });
  it('pins every CHECK and rejects weakened comparisons, protocol, hash and JSON shapes', () => {
    const normalized = ddl.replace(/\s+/g, ' ');
    for (const table of tables) {
      const config = getTableConfig(table);
      const expected = aiConfigurationChecks[getTableName(table)];
      expect(config.checks).toHaveLength(expected.length);
      for (const [index, constraint] of config.checks.entries()) {
        const expression = dialect
          .sqlToQuery(constraint.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        expect(normalized).toContain(`CONSTRAINT ${constraint.name} CHECK (${expression})`);
        expect(expected[index]).toContain(
          canonicalPublicationControlCheck(`CHECK (${expression})`),
        );
        expect(expected[index]).not.toContain(
          canonicalPublicationControlCheck(`CHECK ((${expression}) OR true)`),
        );
      }
    }
  });
  it('does not add functions, triggers, public projections, grants or implicit production enablement', () => {
    const executable = ddl.replace(/^--.*$/gm, '');
    expect(executable).not.toMatch(
      /\b(?:GRANT|TRIGGER|FUNCTION|VIEW|CREATE ROLE|ALTER ROLE|ENABLE|DISABLE)\b/i,
    );
    expect(executable).toMatch(/REVOKE ALL ON[\s\S]*FROM PUBLIC/);
    expect(executable).toContain('permission.grantee<>relation.relowner');
    expect(executable).toContain(
      'AI configuration tables require owner-only ACLs before explicit provisioning',
    );
    expect(executable.match(/CREATE TABLE/g)).toHaveLength(5);
  });
});
