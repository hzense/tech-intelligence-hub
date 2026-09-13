import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  signalPublicationControl,
  signalPublicationTasks,
  signalPublicationAuthorizations,
  signalPublicationRuns,
} from '../src/schema.js';
import {
  canonicalPublicationControlCheck,
  signalPublicationControlColumns,
  signalPublicationControlChecks,
  signalPublicationControlDefaults,
  signalPublicationControlPrimaryKeys,
  signalPublicationControlForeignKeys,
  signalPublicationControlIndexes,
  signalPublicationControlFunctionHashes,
  signalPublicationControlTriggers,
} from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';
import { signalGuardSourceHash } from '../src/signal-immutability-catalog.mjs';

const tables = [
  signalPublicationControl,
  signalPublicationTasks,
  signalPublicationAuthorizations,
  signalPublicationRuns,
];
const migrationPath = resolve(
  process.cwd(),
  '../../db/migrations/0009_signal_publication_controls.sql',
);

describe('Private Signal publication control schema', () => {
  it('pins only policy, task authorization and run coordination fields with fail-closed defaults', () => {
    const dialect = new PgDialect();
    const defaults = new Map(signalPublicationControlDefaults);
    for (const table of tables) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
      ).toEqual(
        Object.entries(signalPublicationControlColumns[name]).map(([column, [type, notNull]]) => [
          column,
          type,
          notNull,
        ]),
      );
      expect(config.indexes).toHaveLength(name === 'signal_publication_runs' ? 1 : 0);
      for (const column of config.columns) {
        const key = `${name}.${column.name}`;
        expect(column.hasDefault).toBe(defaults.has(key));
        if (defaults.has(key)) {
          const expression =
            typeof column.default === 'object'
              ? dialect.sqlToQuery(column.default as Parameters<PgDialect['sqlToQuery']>[0]).sql
              : typeof column.default === 'string'
                ? `'${column.default}'`
                : String(column.default);
          expect(defaults.get(key)?.has(canonicalCatalogExpression(expression))).toBe(true);
          defaults.delete(key);
        }
      }
    }
    expect(defaults.size).toBe(0);
    expect(signalPublicationControl.publicationEnabled.default).toBe(false);
    expect(signalPublicationTasks.policy.default).toBe('preview_only');
    expect(signalPublicationTasks.publicationEnabled.default).toBe(false);
    expect(signalPublicationAuthorizations.canPublish.default).toBe(false);
    expect(signalPublicationRuns.status.default).toBe('pending');
    expect(signalPublicationRuns.fencingToken.default).toBe(0);
  });

  it('requires each run to reference one exact task/principal pair with no cascading deletion', () => {
    const primaryKeys = tables.flatMap((table) => {
      const config = getTableConfig(table);
      return [
        ...config.columns
          .filter((column) => column.primary)
          .map((column) => `${getTableName(table)}|${column.name}`),
        ...config.primaryKeys.map(
          (key) => `${getTableName(table)}|${key.columns.map((column) => column.name).join(',')}`,
        ),
      ];
    });
    expect(primaryKeys).toEqual(signalPublicationControlPrimaryKeys);
    const foreignKeys = tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => {
        const reference = key.reference();
        expect(key.onDelete).toBe('no action');
        expect(key.onUpdate).toBe('no action');
        return `${getTableName(table)}|${reference.columns.map((column) => column.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((column) => column.name).join(',')}|a|a|false`;
      }),
    );
    expect(foreignKeys).toEqual(signalPublicationControlForeignKeys);
    const indexes = tables.flatMap((table) =>
      getTableConfig(table).indexes.map(({ config }) => {
        expect(config.unique).toBe(false);
        expect(config.name).toBe('signal_publication_runs_task_lease_idx');
        return `${getTableName(table)}|${config.columns.map((column) => 'name' in column && column.name).join(',')}`;
      }),
    );
    expect(indexes).toEqual(signalPublicationControlIndexes);
  });

  it('aligns source checks with separately pinned catalog forms while retaining boolean grouping', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const dialect = new PgDialect();
    for (const table of tables) {
      const expected = signalPublicationControlChecks[getTableName(table)] ?? [];
      const checks = getTableConfig(table).checks;
      expect(checks).toHaveLength(expected.length);
      for (const [index, constraint] of checks.entries()) {
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
        expect(constraint.name.length).toBeLessThanOrEqual(63);
      }
    }
    expect(canonicalPublicationControlCheck('CHECK ((a AND b) OR c)')).not.toBe(
      canonicalPublicationControlCheck('CHECK (a AND (b OR c))'),
    );
    expect(canonicalPublicationControlCheck("CHECK (label = 'A ( B )')")).not.toBe(
      canonicalPublicationControlCheck("CHECK (label = 'a(b)')"),
    );
  });

  it('seeds publication disabled and pins the two ALWAYS guards without granting any role access', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'INSERT INTO signal_publication_control (singleton, publication_enabled) VALUES (true, false)',
    );
    const bodies = [
      ...migration.matchAll(
        /CREATE FUNCTION public\.(\w+)\(\)[\s\S]*?AS \$guard\$([\s\S]*?)\$guard\$;/g,
      ),
    ];
    expect(bodies).toHaveLength(1);
    for (const [, name, source] of bodies) {
      expect(signalGuardSourceHash(source)).toBe(signalPublicationControlFunctionHashes[name]);
      expect(normalized).toContain(
        `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp`,
      );
      expect(normalized).toContain(`REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC`);
    }
    for (const trigger of signalPublicationControlTriggers) {
      expect(normalized).toContain(
        `ALTER TABLE public.${trigger.table_name} ENABLE ALWAYS TRIGGER ${trigger.name}`,
      );
    }
    expect(migration.match(/CREATE TRIGGER/g)).toHaveLength(2);
    expect(migration.replace(/^--.*$/gm, '')).not.toMatch(
      /\b(?:GRANT|DISABLE|SECURITY DEFINER|DROP|CASCADE|VIEW)\b/i,
    );
  });
});
