import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, getViewConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  currentPublicSignals,
  signalPublicationPermits,
  signalVerificationDependencySeals,
} from '../src/schema.js';
import {
  currentPublicationColumns,
  currentPublicationForeignKeys,
  currentPublicationRoutines,
  currentPublicationTriggers,
  currentPublicSignalColumns,
} from '../src/current-publication-catalog.mjs';
import { signalGuardSourceHash } from '../src/signal-immutability-catalog.mjs';
import { expectedTableNames } from '../src/verify.mjs';
import { inspectCurrentPublicSignalReaderAccess } from '../src/current-publication-reader-contract.mjs';

const path = resolve(process.cwd(), '../../db/migrations/0012_current_signal_publication.sql');
describe('Current public Signal release schema', () => {
  it('pins only two private binding tables, with exact non-cascading foreign keys', () => {
    expect(expectedTableNames.size).toBe(35);
    const keys = [];
    for (const table of [signalVerificationDependencySeals, signalPublicationPermits]) {
      const name = getTableName(table);
      const config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, [column.getSQLType(), column.notNull]]),
      ).toEqual(Object.entries(currentPublicationColumns[name]));
      expect(config.indexes).toHaveLength(0);
      expect(config.checks).toHaveLength(1);
      for (const key of config.foreignKeys) {
        const reference = key.reference();
        expect(key.onDelete).toBe('no action');
        expect(key.onUpdate).toBe('no action');
        keys.push(
          `${name}|${reference.columns.map((c) => c.name).join(',')}|${getTableName(reference.foreignTable)}|${reference.foreignColumns.map((c) => c.name).join(',')}|a|a|false`,
        );
      }
      const defaults = config.columns.filter((column) => column.hasDefault);
      expect(defaults.map((column) => column.name)).toEqual(
        name === 'signal_verification_dependency_seals' ? ['invalidated'] : [],
      );
    }
    expect(keys).toEqual(currentPublicationForeignKeys);
  });
  it('maps an existing view only, with no private material fields', () => {
    const view = getViewConfig(currentPublicSignals);
    expect(view.isExisting).toBe(true);
    expect(
      Object.values(view.selectedFields).map((column) => [column.name, column.getSQLType()]),
    ).toEqual(currentPublicSignalColumns);
    expect(currentPublicSignalColumns.map(([name]) => name)).not.toEqual(
      expect.arrayContaining(['metadata', 'excerpt', 'locator', 'dependency_seal', 'content_hash']),
    );
  });
  it('pins each capability body, argument identity, security and timezone explicitly', async () => {
    const migration = await readFile(path, 'utf8');
    const functions = [
      ...migration.matchAll(
        /CREATE FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$(\w+)\$([\s\S]*?)\$\4\$;/g,
      ),
    ];
    expect(functions).toHaveLength(8);
    for (const [, name, args, header, , body] of functions) {
      const contract = currentPublicationRoutines[name];
      expect(args).toBe(contract.arguments);
      expect(signalGuardSourceHash(body)).toBe(contract.hash);
      expect(header).toContain(`SECURITY ${contract.definer === false ? 'INVOKER' : 'DEFINER'}`);
      expect(header).toContain('SET search_path = pg_catalog, pg_temp');
      expect(header.includes("SET timezone = 'UTC'")).toBe(contract.utc === true);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}(`);
    }
    expect(migration).toContain(
      'ALTER FUNCTION public.hzense_guard_qualified_publication_receipt() SECURITY DEFINER',
    );
  });
  it('pins ALWAYS guards, irreversible dependency invalidation, exact clone and final clock gates', async () => {
    const migration = await readFile(path, 'utf8');
    expect(migration.match(/CREATE (?:CONSTRAINT )?TRIGGER/g)).toHaveLength(12);
    for (const trigger of currentPublicationTriggers)
      expect(migration).toContain(
        `ALTER TABLE public.${trigger.table_name} ENABLE ALWAYS TRIGGER ${trigger.name}`,
      );
    expect(migration).toContain('WITH (security_barrier=true)');
    expect(migration).toContain(
      'OR run_row.fencing_token IS DISTINCT FROM qualified.fencing_token',
    );
    expect(migration).toContain('Public verification or lease expired during final qualification');
    expect(migration).toContain(
      'Dependency seals cannot be replaced, restored, deleted or truncated',
    );
    expect(migration).toContain(
      'verification.created_xid IS DISTINCT FROM pg_catalog.pg_current_xact_id()',
    );
    expect(migration).not.toMatch(
      /INSERT INTO (?:public\.)?signal_verification_dependency_seals[\s\n]*SELECT/i,
    );
  });
  it('keeps json object constraints and invalidated default aligned with the DDL', async () => {
    const dialect = new PgDialect();
    const migration = (await readFile(path, 'utf8')).replace(/\s+/g, ' ');
    for (const table of [signalVerificationDependencySeals, signalPublicationPermits]) {
      for (const check of getTableConfig(table).checks) {
        const expression = dialect
          .sqlToQuery(check.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        expect(migration).toContain(`CONSTRAINT ${check.name} CHECK (${expression})`);
      }
    }
  });
});

describe('V3 Runtime capability increment', () => {
  const identity = {
    authenticated_role: 'hzense_runtime',
    effective_role: 'hzense_runtime',
    privileged: false,
    inherits: false,
    memberships: false,
    database_create: false,
    database_temp: false,
    schema_create: false,
    view_select: true,
    current_execute: true,
  };
  it('accepts only reviewed public fields and the boolean current-state capability', () => {
    expect(
      inspectCurrentPublicSignalReaderAccess({
        identity,
        columns: [
          {
            table_name: 'current_public_signals',
            column_name: 'title',
            readable: true,
            writable: false,
          },
        ],
        routines: [
          {
            routine_name: 'hzense_public_signal_is_current',
            arguments: 'p_event_id uuid',
            executable: true,
          },
        ],
      }).ok,
    ).toBe(true);
  });
  it('rejects private data, writes, unexpected functions, roles and incomplete inspection', () => {
    expect(
      inspectCurrentPublicSignalReaderAccess({
        identity,
        columns: [
          {
            table_name: 'signal_versions',
            column_name: 'summary',
            readable: true,
            writable: false,
          },
        ],
        routines: [],
      }).ok,
    ).toBe(false);
    expect(
      inspectCurrentPublicSignalReaderAccess({
        identity,
        columns: [
          {
            table_name: 'current_public_signals',
            column_name: 'title',
            readable: true,
            writable: true,
          },
        ],
        routines: [],
      }).ok,
    ).toBe(false);
    expect(
      inspectCurrentPublicSignalReaderAccess({
        identity,
        columns: [],
        routines: [
          {
            routine_name: 'hzense_signal_dependency_seal',
            arguments: 'p_signal_id text, p_source_version integer',
            executable: true,
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      inspectCurrentPublicSignalReaderAccess({
        identity: { ...identity, effective_role: 'hzense_migrator' },
        columns: [],
        routines: [],
      }).ok,
    ).toBe(false);
    expect(inspectCurrentPublicSignalReaderAccess({ identity }).ok).toBe(false);
  });
});
