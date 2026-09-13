import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sealedSignalTriggers, stampedSignalTables } from '../src/signal-immutability-catalog.mjs';

// Test data only. Production expectations are separately pinned source hashes.
const migration = readFileSync(
  new URL('../../../db/migrations/0007_signal_version_immutability.sql', import.meta.url),
  'utf8',
);
const bodies = [
  ...migration.matchAll(
    /CREATE FUNCTION public\.(\w+)\(\)[\s\S]*?AS \$guard\$([\s\S]*?)\$guard\$;/g,
  ),
];

export function signalImmutabilityFixture(owner = 'hzense_migrator') {
  return {
    triggers: sealedSignalTriggers.map((contract) => ({
      ...contract,
      table_owner: owner,
      enabled: 'A',
      routine_schema: 'public',
      routine_arguments: '',
      constraint_trigger: false,
      parent_trigger: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      arguments_hex: '',
      column_numbers: '',
      when_expression: null,
      old_transition_table: null,
      new_transition_table: null,
    })),
    routines: bodies.map(([, name, source]) => ({
      name,
      source,
      owner,
      identity_arguments: '',
      language: 'plpgsql',
      kind: 'f',
      result_type: 'trigger',
      security_definer: false,
      leakproof: false,
      strict: false,
      returns_set: false,
      volatility: 'v',
      parallel: 'u',
      support_function: false,
      binary: null,
      sql_body: null,
      configuration: ['search_path=pg_catalog, pg_temp'],
      unsafe_acl_count: 0,
      owner_execute_count: 1,
    })),
    stamps: stampedSignalTables.map((table_name) => ({
      table_name,
      data_type: 'xid8',
      not_null: true,
      generated_kind: '',
      default_expression: 'pg_current_xact_id()',
    })),
  };
}

export function signalImmutabilityQueryFixture(sql, fixture = signalImmutabilityFixture()) {
  for (const key of ['triggers', 'routines', 'stamps']) {
    if (sql.includes(`hzense:signal-immutability:${key}`)) {
      return { rows: fixture[key], rowCount: fixture[key].length };
    }
  }
  return null;
}
