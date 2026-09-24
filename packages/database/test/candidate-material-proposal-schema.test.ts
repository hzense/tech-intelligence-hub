import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { candidateMaterialProposals, candidateMaterialApprovals } from '../src/schema.js';
import {
  materialProposalColumns,
  materialProposalChecks,
  materialProposalPrimaryKeys,
  materialProposalForeignKeys,
  materialProposalUniqueIndexes,
  materialProposalDefaults,
} from '../src/candidate-material-proposal-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';
const tables = [candidateMaterialProposals, candidateMaterialApprovals];
describe('private material proposal schema', () => {
  it('matches columns, generated timestamps and all bounded checks for two private tables', () => {
    expect(expectedTableNames.size).toBe(57);
    const dialect = new PgDialect();
    const defaults = new Map(materialProposalDefaults);
    for (const table of tables) {
      const name = getTableName(table),
        config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
      ).toEqual(
        Object.entries(materialProposalColumns[name]).map(([column, [type, notNull]]) => [
          column,
          type,
          notNull,
        ]),
      );
      for (const column of config.columns) {
        const key = `${name}.${column.name}`;
        expect(column.hasDefault).toBe(defaults.has(key));
        if (defaults.has(key)) {
          const sql = dialect.sqlToQuery(
            column.default as Parameters<PgDialect['sqlToQuery']>[0],
          ).sql;
          expect(defaults.get(key)?.has(canonicalCatalogExpression(sql))).toBe(true);
          defaults.delete(key);
        }
      }
      expect(config.checks).toHaveLength(materialProposalChecks[name].length);
      for (const [index, check] of config.checks.entries()) {
        const expression = dialect
          .sqlToQuery(check.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        expect(materialProposalChecks[name][index]).toContain(
          canonicalPublicationControlCheck(`CHECK (${expression})`),
        );
      }
    }
    expect(defaults.size).toBe(0);
  });
  it('binds every proposal and approval to exact owner, request and draft identities', () => {
    expect(
      tables.flatMap((table) =>
        getTableConfig(table)
          .columns.filter((c) => c.primary)
          .map((c) => `${getTableName(table)}|${c.name}`),
      ),
    ).toEqual(materialProposalPrimaryKeys);
    expect(
      tables.flatMap((table) =>
        getTableConfig(table).foreignKeys.map((key) => {
          const ref = key.reference();
          expect(key.onDelete).toBe('no action');
          expect(key.onUpdate).toBe('no action');
          return `${getTableName(table)}|${ref.columns.map((c) => c.name).join(',')}|${getTableName(ref.foreignTable)}|${ref.foreignColumns.map((c) => c.name).join(',')}|a|a|false`;
        }),
      ),
    ).toEqual(materialProposalForeignKeys);
    expect(
      tables.flatMap((table) =>
        getTableConfig(table).indexes.map(({ config }) => {
          expect(config.unique).toBe(true);
          return `${getTableName(table)}|${config.columns.map((c) => 'name' in c && c.name).join(',')}`;
        }),
      ),
    ).toEqual(materialProposalUniqueIndexes);
  });
});
