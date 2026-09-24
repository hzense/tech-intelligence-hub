import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  candidateMaterialRequests,
  candidateMaterialReports,
  candidateMaterialReceipts,
} from '../src/schema.js';
import {
  candidateMaterialColumns,
  candidateMaterialChecks,
  candidateMaterialPrimaryKeys,
  candidateMaterialForeignKeys,
  candidateMaterialUniqueIndexes,
  candidateMaterialDefaults,
  candidateMaterialFunctionHashes,
  candidateMaterialLockFunctionHash,
  candidateMaterialTriggers,
} from '../src/candidate-material-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { canonicalCatalogExpression, expectedTableNames } from '../src/verify.mjs';
import {
  inspectSignalImmutabilityCatalog,
  signalGuardSourceHash,
} from '../src/signal-immutability-catalog.mjs';
import { signalImmutabilityFixture } from './signal-immutability-fixtures.mjs';

const tables = [candidateMaterialRequests, candidateMaterialReports, candidateMaterialReceipts];
describe('private candidate material schema and catalog', () => {
  it('checks the bounded lock capability signature, security context, source seal and exact grantees', () => {
    const fixture = signalImmutabilityFixture();
    const routine = fixture.routines.find((r) => r.name === 'hzense_lock_material_dependencies')!;
    expect(signalGuardSourceHash(routine.source)).toBe(candidateMaterialLockFunctionHash);
    expect(routine.identity_arguments).toBe('p_report_id uuid, p_owner_id text');
    expect(routine.result_type).toBe('void');
    expect(routine.security_definer).toBe(true);
    for (const grantee of ['hzense_material_registrar', 'hzense_material_verifier'])
      routine.acl_entries.push({
        grantee,
        grantor: 'hzense_migrator',
        privilege: 'EXECUTE',
        grantable: false,
      });
    expect(inspectSignalImmutabilityCatalog(fixture, 'hzense_migrator')).toEqual([]);
    const mutations: Array<(r: typeof routine) => void> = [
      (r) => {
        r.identity_arguments = 'p_report_id text, p_owner_id text';
      },
      (r) => {
        r.result_type = 'trigger';
      },
      (r) => {
        r.security_definer = false;
      },
      (r) => {
        r.language = 'sql';
      },
      (r) => {
        r.owner = 'another-owner';
      },
      (r) => {
        r.configuration = ['search_path=public, pg_catalog'];
      },
      (r) => {
        r.source += '\n-- drift';
      },
      (r) => {
        r.acl_entries.push({
          grantee: 'PUBLIC',
          grantor: 'hzense_migrator',
          privilege: 'EXECUTE',
          grantable: false,
        });
      },
      (r) => {
        r.acl_entries.push({
          grantee: 'hzense_material_verifier',
          grantor: 'hzense_migrator',
          privilege: 'EXECUTE',
          grantable: true,
        });
      },
    ];
    for (const mutate of mutations) {
      const changed = signalImmutabilityFixture();
      mutate(changed.routines.find((r) => r.name === 'hzense_lock_material_dependencies')!);
      expect(inspectSignalImmutabilityCatalog(changed, 'hzense_migrator')).toContainEqual(
        expect.stringContaining('Candidate material function contract mismatch'),
      );
    }
  });
  it('matches columns, generated timestamps and all bounded checks for three private tables', () => {
    expect(expectedTableNames.size).toBe(55);
    const dialect = new PgDialect();
    const defaults = new Map(candidateMaterialDefaults);
    for (const table of tables) {
      const name = getTableName(table),
        config = getTableConfig(table);
      expect(expectedTableNames.has(name)).toBe(true);
      expect(
        config.columns.map((column) => [column.name, column.getSQLType(), column.notNull]),
      ).toEqual(
        Object.entries(candidateMaterialColumns[name]).map(([column, [type, notNull]]) => [
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
      expect(config.checks).toHaveLength(candidateMaterialChecks[name].length);
      for (const [index, check] of config.checks.entries()) {
        const expression = dialect
          .sqlToQuery(check.value)
          .sql.replace(/"[a-z_]+"\."([a-z_]+)"/g, '$1');
        expect(candidateMaterialChecks[name][index]).toContain(
          canonicalPublicationControlCheck(`CHECK (${expression})`),
        );
      }
    }
    expect(defaults.size).toBe(0);
  });
  it('binds every report and receipt to matching owner, request, report and plan identities', () => {
    expect(
      tables.flatMap((table) =>
        getTableConfig(table)
          .columns.filter((c) => c.primary)
          .map((c) => `${getTableName(table)}|${c.name}`),
      ),
    ).toEqual(candidateMaterialPrimaryKeys);
    expect(
      tables.flatMap((table) =>
        getTableConfig(table).foreignKeys.map((key) => {
          const ref = key.reference();
          expect(key.onDelete).toBe('no action');
          expect(key.onUpdate).toBe('no action');
          return `${getTableName(table)}|${ref.columns.map((c) => c.name).join(',')}|${getTableName(ref.foreignTable)}|${ref.foreignColumns.map((c) => c.name).join(',')}|a|a|false`;
        }),
      ),
    ).toEqual(candidateMaterialForeignKeys);
    expect(
      tables.flatMap((table) =>
        getTableConfig(table).indexes.map(({ config }) => {
          expect(config.unique).toBe(true);
          return `${getTableName(table)}|${config.columns.map((c) => 'name' in c && c.name).join(',')}`;
        }),
      ),
    ).toEqual(candidateMaterialUniqueIndexes);
  });
  it('seals all seven ALWAYS triggers and rejects stage-role guard drift', () => {
    const fixture = signalImmutabilityFixture();
    expect(candidateMaterialTriggers).toHaveLength(7);
    for (const [name, hash] of Object.entries(candidateMaterialFunctionHashes)) {
      const routine = fixture.routines.find((r) => r.name === name);
      expect(routine).toBeTruthy();
      expect(signalGuardSourceHash(routine!.source)).toBe(hash);
    }
    expect(inspectSignalImmutabilityCatalog(fixture, 'hzense_migrator')).toEqual([]);
    fixture.triggers.find(
      (t) => t.name === 'candidate_material_receipts_insert_guard_trg',
    )!.enabled = 'O';
    expect(inspectSignalImmutabilityCatalog(fixture, 'hzense_migrator')).toContainEqual(
      expect.stringContaining('trigger contract mismatch'),
    );
    const altered = signalImmutabilityFixture();
    altered.routines.find(
      (r) => r.name === 'hzense_guard_candidate_material_receipt_insert',
    )!.source += '\n-- unreviewed';
    expect(inspectSignalImmutabilityCatalog(altered, 'hzense_migrator')).toContainEqual(
      expect.stringContaining('function contract mismatch'),
    );
  });
});
