import { readFile } from 'node:fs/promises';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import * as schema from '../src/import-schema.js';
import {
  importColumns,
  importChecks,
  importPrimaryKeys,
  importForeignKeys,
  importIndexes,
  importUniqueIndexes,
  importDefaults,
} from '../src/import-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';

const ddl = await readFile(
  new URL('../../../db/migrations/0014_import_tasks.sql', import.meta.url),
  'utf8',
);
const dialect = new PgDialect();
it('pins all seven private tables, column types, checks, defaults, keys and indexes', () => {
  expect(expectedTableNames.size).toBe(47);
  expect(Object.values(schema).map(getTableName).sort()).toEqual(Object.keys(importColumns).sort());
  const keys: string[] = [],
    fks: string[] = [],
    indexes: string[] = [],
    uniques: string[] = [],
    defaults: string[] = [];
  for (const table of Object.values(schema)) {
    const name = getTableName(table),
      config = getTableConfig(table);
    expect(config.columns.map((c) => [c.name, [c.getSQLType(), c.notNull]])).toEqual(
      Object.entries(importColumns[name]),
    );
    for (const c of config.columns) {
      if (c.primary) keys.push(`${name}|${c.name}`);
      if (c.hasDefault) {
        const key = `${name}.${c.name}`;
        defaults.push(key);
        const expression =
          typeof c.default === 'object' && c.default !== null && 'getSQL' in c.default
            ? dialect.sqlToQuery(c.default.getSQL()).sql
            : String(c.default);
        expect(new Map(importDefaults).get(key)?.has(canonicalCatalogExpression(expression))).toBe(
          true,
        );
      }
    }
    for (const k of config.primaryKeys)
      keys.push(`${name}|${k.columns.map((c) => c.name).join(',')}`);
    for (const k of config.foreignKeys) {
      const r = k.reference();
      expect(k.onDelete).toBe('no action');
      expect(k.onUpdate).toBe('no action');
      fks.push(
        `${name}|${r.columns.map((c) => c.name).join(',')}|${getTableName(r.foreignTable)}|${r.foreignColumns.map((c) => c.name).join(',')}|a|a|false`,
      );
    }
    for (const { config: i } of config.indexes)
      (i.unique ? uniques : indexes).push(
        `${name}|${i.columns.map((c) => 'name' in c && c.name).join(',')}`,
      );
    expect(config.checks.length).toBe(importChecks[name].length);
    config.checks.forEach((c, i) => {
      const expression = dialect
        .sqlToQuery(c.value)
        .sql.replace(/"[a-z_]+"\."([a-z0-9_]+)"/g, '$1');
      expect(ddl.replace(/\s+/g, ' ')).toContain(`CONSTRAINT ${c.name} CHECK (${expression})`);
      expect(importChecks[name][i]).toContain(
        canonicalPublicationControlCheck(`CHECK (${expression})`),
      );
    });
  }
  expect(keys.sort()).toEqual([...importPrimaryKeys].sort());
  expect(fks.sort()).toEqual([...importForeignKeys].sort());
  expect(indexes.sort()).toEqual([...importIndexes].sort());
  expect(uniques.sort()).toEqual([...importUniqueIndexes].sort());
  expect(defaults.sort()).toEqual(importDefaults.map(([key]) => key).sort());
});
it('never grants access or changes published source seals during migration', () => {
  const executable = ddl.replace(/^--.*$/gm, '');
  expect(executable).not.toMatch(
    /\b(GRANT|ALTER TABLE|CREATE ROLE|CREATE FUNCTION|CREATE TRIGGER)\b/i,
  );
  expect(executable).toContain('a.grantee<>r.relowner');
  expect(executable).toContain('FROM PUBLIC');
});
