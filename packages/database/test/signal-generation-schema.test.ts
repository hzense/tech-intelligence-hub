import { readFile } from 'node:fs/promises';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { signalGenerationRuns } from '../src/signal-generation-schema.js';
import {
  signalGenerationColumns,
  signalGenerationChecks,
  signalGenerationDefaults,
  signalGenerationIndexes,
  signalGenerationUniqueIndexes,
} from '../src/signal-generation-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';
const ddl = await readFile(
  new URL('../../../db/migrations/0015_signal_generation.sql', import.meta.url),
  'utf8',
);
it('pins the private generation SQL, typed schema and independent catalog together', () => {
  const config = getTableConfig(signalGenerationRuns),
    dialect = new PgDialect();
  expect(getTableName(signalGenerationRuns)).toBe('signal_generation_runs');
  expect(expectedTableNames.size).toBe(48);
  expect(config.columns.map((c) => [c.name, [c.getSQLType(), c.notNull]])).toEqual(
    Object.entries(signalGenerationColumns.signal_generation_runs),
  );
  expect(config.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id']);
  expect(config.foreignKeys).toEqual([]);
  expect(config.checks).toHaveLength(signalGenerationChecks.signal_generation_runs.length);
  config.checks.forEach((c, i) => {
    const expression = dialect.sqlToQuery(c.value).sql.replace(/"[a-z_]+"\."([a-z0-9_]+)"/g, '$1');
    expect(ddl.replace(/\s+/g, ' ')).toContain(`CONSTRAINT ${c.name} CHECK (${expression})`);
    expect(signalGenerationChecks.signal_generation_runs[i]).toContain(
      canonicalPublicationControlCheck(`CHECK (${expression})`),
    );
  });
  for (const c of config.columns.filter((column) => column.hasDefault)) {
    const expression =
      typeof c.default === 'object' && c.default !== null && 'getSQL' in c.default
        ? dialect.sqlToQuery(c.default.getSQL()).sql
        : String(c.default);
    expect(
      new Map(signalGenerationDefaults)
        .get(`signal_generation_runs.${c.name}`)
        ?.has(canonicalCatalogExpression(expression)),
    ).toBe(true);
  }
  const indexes = config.indexes.map(({ config: i }) => ({
    unique: i.unique,
    value: `signal_generation_runs|${i.columns.map((c) => 'name' in c && c.name).join(',')}`,
  }));
  expect(indexes.filter((i) => i.unique).map((i) => i.value)).toEqual(
    signalGenerationUniqueIndexes,
  );
  expect(indexes.filter((i) => !i.unique).map((i) => i.value)).toEqual(signalGenerationIndexes);
});
it('grants no role permissions and changes no existing public or sealed material', () => {
  const executable = ddl.replace(/^--.*$/gm, '');
  expect(executable).not.toMatch(
    /\b(GRANT|ALTER TABLE|CREATE ROLE|CREATE FUNCTION|CREATE TRIGGER)\b/i,
  );
  expect(executable).toContain('a.grantee<>r.relowner');
  expect(executable).toContain('FROM PUBLIC');
});
