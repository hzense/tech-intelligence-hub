import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { signalPublicationOutbox, signalQualifiedPublicationReceipts } from '../src/schema.js';
import {
  qualifiedPublicationColumns,
  qualifiedPublicationChecks,
  qualifiedPublicationPrimaryKeys,
  qualifiedPublicationForeignKeys,
  qualifiedPublicationUniqueIndexes,
  qualifiedPublicationFunctionHashes,
  qualifiedPublicationTriggers,
} from '../src/qualified-publication-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { expectedTableNames } from '../src/verify.mjs';
import { signalGuardSourceHash } from '../src/signal-immutability-catalog.mjs';

const table = signalQualifiedPublicationReceipts;
const name = getTableName(table);
const config = getTableConfig(table);
const migrationPath = resolve(
  process.cwd(),
  '../../db/migrations/0010_qualified_signal_publication.sql',
);

describe('Private qualified Signal publication schema', () => {
  it('pins only the non-null receipt, snapshot and lease bindings without defaults', () => {
    expect(expectedTableNames.has(name)).toBe(true);
    expect(expectedTableNames.size).toBe(58);
    expect(
      config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
    ).toEqual(
      Object.entries(qualifiedPublicationColumns[name]).map(([column, [type, notNull]]) => [
        column,
        type,
        notNull,
      ]),
    );
    expect(config.columns.every((column) => !column.hasDefault)).toBe(true);
    expect(config.indexes).toHaveLength(0);
    expect(
      config.columns.filter((column) => column.primary).map((column) => `${name}|${column.name}`),
    ).toEqual(qualifiedPublicationPrimaryKeys);
  });

  it('binds the exact outbox tuple, sealed source and run without cascading or loose identity keys', () => {
    const foreignKeys = config.foreignKeys.map((key) => {
      const reference = key.reference();
      expect(key.onDelete).toBe('no action');
      expect(key.onUpdate).toBe('no action');
      return `${name}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`;
    });
    expect(foreignKeys).toEqual(qualifiedPublicationForeignKeys);
    const index = getTableConfig(signalPublicationOutbox).indexes.find(
      ({ config: indexConfig }) =>
        indexConfig.name === 'signal_publication_outbox_qualified_receipt_uq',
    );
    expect(index?.config.unique).toBe(true);
    expect([
      `signal_publication_outbox|${index?.config.columns.map((column) => 'name' in column && column.name).join(',')}`,
    ]).toEqual(qualifiedPublicationUniqueIndexes);
  });

  it('matches all seven independently pinned CHECKs without erasing literals or grouping', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const dialect = new PgDialect();
    const expected = qualifiedPublicationChecks[name];
    expect(config.checks).toHaveLength(expected.length);
    for (const [index, constraint] of config.checks.entries()) {
      const expression = dialect
        .sqlToQuery(constraint.value)
        .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
      expect(normalized).toContain(`CONSTRAINT ${constraint.name} CHECK (${expression})`);
      expect(expected[index]).toContain(canonicalPublicationControlCheck(`CHECK (${expression})`));
      expect(expected[index]).not.toContain(
        canonicalPublicationControlCheck(`CHECK ((${expression}) OR true)`),
      );
      expect(constraint.name.length).toBeLessThanOrEqual(63);
    }
  });

  it('pins one invoker guard and three ALWAYS triggers, including a deferred lease recheck', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ');
    const bodies = [
      ...migration.matchAll(
        /CREATE FUNCTION public\.(\w+)\(\)[\s\S]*?AS \$guard\$([\s\S]*?)\$guard\$;/g,
      ),
    ];
    expect(bodies).toHaveLength(1);
    for (const [, routine, body] of bodies) {
      expect(signalGuardSourceHash(body)).toBe(qualifiedPublicationFunctionHashes[routine]);
      expect(normalized).toContain(
        `CREATE FUNCTION public.${routine}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp`,
      );
      expect(normalized).toContain(`REVOKE ALL ON FUNCTION public.${routine}() FROM PUBLIC`);
    }
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER/g)).toHaveLength(3);
    for (const trigger of qualifiedPublicationTriggers) {
      expect(normalized).toContain(
        `ALTER TABLE public.${trigger.table_name} ENABLE ALWAYS TRIGGER ${trigger.name}`,
      );
    }
    expect(normalized).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(normalized).toContain('target_xid IS DISTINCT FROM current_xid');
    expect(normalized).toContain('source_xid = current_xid');
    expect(normalized).toContain('run_record.lease_expires_at <= pg_catalog.clock_timestamp()');
    expect(migration.replace(/^--.*$/gm, '')).not.toMatch(
      /\b(?:GRANT|DISABLE|SECURITY DEFINER|DROP|CASCADE|VIEW)\b/i,
    );
  });
});
