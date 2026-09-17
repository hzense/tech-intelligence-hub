import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { signalCandidateVerifications, signalCandidateAssemblyReceipts } from '../src/schema.js';
import {
  candidateVerificationColumns,
  candidateVerificationChecks,
  candidateVerificationPrimaryKeys,
  candidateVerificationForeignKeys,
  candidateVerificationUniqueIndexes,
  candidateVerificationDefaults,
  candidateVerificationFunctionHashes,
  candidateVerificationTriggers,
} from '../src/candidate-verification-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';
import {
  signalGuardSourceHash,
  allStampedSignalTables,
  stampedSignalTables,
} from '../src/signal-immutability-catalog.mjs';

const tables = [signalCandidateVerifications, signalCandidateAssemblyReceipts];
const migrationPath = resolve(
  process.cwd(),
  '../../db/migrations/0011_signal_candidate_verification.sql',
);

describe('Private candidate verification and assembly schema', () => {
  it('pins two exact private tables and only database-generated statement time and xid defaults', () => {
    expect(expectedTableNames.size).toBe(48);
    const dialect = new PgDialect();
    const defaults = new Map([
      ...candidateVerificationDefaults,
      ['signal_candidate_verifications.created_xid', new Set(['pg_catalog.pg_current_xact_id'])],
    ]);
    for (const table of tables) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
      ).toEqual(
        Object.entries(candidateVerificationColumns[name]).map(([column, [type, notNull]]) => [
          column,
          type,
          notNull,
        ]),
      );
      for (const column of config.columns) {
        const key = `${name}.${column.name}`;
        expect(column.hasDefault).toBe(defaults.has(key));
        if (defaults.has(key)) {
          const expression = dialect.sqlToQuery(
            column.default as Parameters<PgDialect['sqlToQuery']>[0],
          ).sql;
          expect(defaults.get(key)?.has(canonicalCatalogExpression(expression))).toBe(true);
          defaults.delete(key);
        }
      }
    }
    expect(defaults.size).toBe(0);
    expect(allStampedSignalTables).toEqual([
      ...stampedSignalTables,
      'signal_candidate_verifications',
    ]);
    expect(stampedSignalTables).toHaveLength(3);
  });

  it('binds each assembly to exactly one verification and source tuple and one target version', () => {
    const primaryKeys = tables.flatMap((table) =>
      getTableConfig(table)
        .columns.filter((column) => column.primary)
        .map((column) => `${getTableName(table)}|${column.name}`),
    );
    expect(primaryKeys).toEqual(candidateVerificationPrimaryKeys);
    const foreignKeys = tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => {
        const reference = key.reference();
        expect(key.onDelete).toBe('no action');
        expect(key.onUpdate).toBe('no action');
        return `${getTableName(table)}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`;
      }),
    );
    expect(foreignKeys).toEqual(candidateVerificationForeignKeys);
    const indexes = tables.flatMap((table) =>
      getTableConfig(table).indexes.map(({ config }) => {
        expect(config.unique).toBe(true);
        expect(config.name?.length).toBeLessThanOrEqual(63);
        return `${getTableName(table)}|${config.columns.map((column) => 'name' in column && column.name).join(',')}`;
      }),
    );
    expect(indexes).toEqual(candidateVerificationUniqueIndexes);
  });

  it('matches all policy, object, bounded time, hash and identity CHECKs without erasing grouping or literals', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalized = sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const dialect = new PgDialect();
    for (const table of tables) {
      const expected = candidateVerificationChecks[getTableName(table)];
      const config = getTableConfig(table);
      expect(config.checks).toHaveLength(expected.length);
      for (const [index, check] of config.checks.entries()) {
        const expression = dialect
          .sqlToQuery(check.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        expect(normalized).toContain(`CONSTRAINT ${check.name} CHECK (${expression})`);
        expect(expected[index]).toContain(
          canonicalPublicationControlCheck(`CHECK (${expression})`),
        );
        expect(expected[index]).not.toContain(
          canonicalPublicationControlCheck(`CHECK ((${expression}) OR true)`),
        );
        expect(check.name.length).toBeLessThanOrEqual(63);
      }
    }
    expect(candidateVerificationChecks.signal_candidate_verifications).toHaveLength(16);
    expect(candidateVerificationChecks.signal_candidate_assembly_receipts).toHaveLength(7);
  });

  it('pins one invoker guard, five ALWAYS triggers and a deferred approval/target check without grants', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ');
    const bodies = [
      ...migration.matchAll(
        /CREATE FUNCTION public\.(\w+)\(\)[\s\S]*?AS \$guard\$([\s\S]*?)\$guard\$;/g,
      ),
    ];
    expect(bodies).toHaveLength(1);
    for (const [, name, body] of bodies) {
      expect(signalGuardSourceHash(body)).toBe(candidateVerificationFunctionHashes[name]);
      expect(normalized).toContain(
        `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp`,
      );
      expect(normalized).toContain(`REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC`);
    }
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER/g)).toHaveLength(5);
    for (const trigger of candidateVerificationTriggers) {
      expect(normalized).toContain(
        `ALTER TABLE public.${trigger.table_name} ENABLE ALWAYS TRIGGER ${trigger.name}`,
      );
    }
    expect(normalized).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(normalized).toContain(
      "NEW.verified_at IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())",
    );
    expect(normalized).toContain('NEW.created_xid IS DISTINCT FROM current_xid');
    expect(normalized).toContain('verification.created_xid = current_xid');
    expect(normalized).toContain('verification.expires_at <= pg_catalog.clock_timestamp()');
    expect(normalized).toContain('target_hash IS DISTINCT FROM NEW.content_hash');
    expect(migration.replace(/^--.*$/gm, '')).not.toMatch(
      /\b(?:GRANT|DISABLE|SECURITY DEFINER|DROP|CASCADE|VIEW)\b/i,
    );
  });
});
