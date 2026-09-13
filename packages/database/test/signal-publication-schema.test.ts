import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { signalPublicationOutbox, signalPublicationState } from '../src/schema.js';
import {
  signalPublicationColumns,
  signalPublicationChecks,
  signalPublicationForeignKeys,
  signalPublicationUniqueIndexes,
  signalPublicationFunctionHashes,
  signalPublicationTriggers,
} from '../src/signal-publication-catalog.mjs';
import { canonicalCatalogExpressionWithLiterals, expectedTableNames } from '../src/verify.mjs';
import { signalGuardSourceHash } from '../src/signal-immutability-catalog.mjs';

const tables = [signalPublicationOutbox, signalPublicationState];

describe('Private Signal publication state and permanent receipt schema', () => {
  it('has independent revisions, metadata-only receipts, exact nonnull columns and no defaults', () => {
    for (const table of tables) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
      ).toEqual(
        Object.entries(signalPublicationColumns[name]).map(([column, [type, notNull]]) => [
          column,
          type,
          notNull,
        ]),
      );
      expect(config.columns.some((column) => column.hasDefault)).toBe(false);
      expect(
        config.columns.some((column) =>
          ['body', 'reason', 'created_xid', 'delivered_at'].includes(column.name),
        ),
      ).toBe(false);
    }
    expect(signalPublicationOutbox.eventId.primary).toBe(true);
    expect(signalPublicationState.signalId.primary).toBe(true);
  });

  it('anchors the complete head tuple to receipts and receipts to version plus canonical identity', () => {
    const foreignKeys = tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => {
        const reference = key.reference();
        expect(key.onDelete).toBe('no action');
        expect(key.onUpdate).toBe('no action');
        return `${getTableName(table)}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`;
      }),
    );
    expect(foreignKeys).toEqual(signalPublicationForeignKeys);
    const indexes = tables.flatMap((table) =>
      getTableConfig(table).indexes.map(({ config }) => {
        expect(config.unique).toBe(true);
        expect(config.name?.length).toBeLessThanOrEqual(63);
        return `${getTableName(table)}|${config.columns.map((column) => 'name' in column && column.name).join(',')}`;
      }),
    );
    expect(indexes).toEqual(signalPublicationUniqueIndexes);
  });

  it('aligns every strict token, reason, revision and bounded millisecond timestamp CHECK with DDL', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0008_signal_publication_outbox.sql'),
      'utf8',
    );
    const normalized = migration.replace(/\s+/g, ' ');
    const dialect = new PgDialect();
    for (const table of tables) {
      const expected = signalPublicationChecks[getTableName(table)];
      const checks = getTableConfig(table).checks;
      expect(checks).toHaveLength(expected.length);
      for (const [index, constraint] of checks.entries()) {
        const expression = dialect
          .sqlToQuery(constraint.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        // DDL line breaks may add padding just inside the reason IN list.
        expect(normalized.replace(/\( /g, '(').replace(/ \)/g, ')')).toContain(
          `CONSTRAINT ${constraint.name} CHECK (${expression})`,
        );
        expect(expected[index]).toContain(canonicalCatalogExpressionWithLiterals(expression));
        expect(constraint.name.length).toBeLessThanOrEqual(63);
      }
    }
  });

  it('pins two invoker guard bodies, five ALWAYS triggers and only two deferred constraint guards', async () => {
    const migration = await readFile(
      resolve(process.cwd(), '../../db/migrations/0008_signal_publication_outbox.sql'),
      'utf8',
    );
    const normalized = migration.replace(/\s+/g, ' ');
    const bodies = [
      ...migration.matchAll(
        /CREATE FUNCTION public\.(\w+)\(\)[\s\S]*?AS \$guard\$([\s\S]*?)\$guard\$;/g,
      ),
    ];
    expect(bodies).toHaveLength(2);
    for (const [, name, source] of bodies) {
      expect(signalGuardSourceHash(source)).toBe(signalPublicationFunctionHashes[name]);
      expect(normalized).toContain(
        `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp`,
      );
      expect(normalized).toContain(`REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC`);
    }
    for (const trigger of signalPublicationTriggers) {
      expect(normalized).toContain(
        `ALTER TABLE public.${trigger.table_name} ENABLE ALWAYS TRIGGER ${trigger.name}`,
      );
    }
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER/g)).toHaveLength(5);
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(2);
    expect(migration.replace(/^--.*$/gm, '')).not.toMatch(
      /\b(?:GRANT|DISABLE|SECURITY DEFINER|DROP|CASCADE|VIEW|POLICY)\b/i,
    );
  });
});
