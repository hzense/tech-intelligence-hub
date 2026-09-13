import { describe, expect, it, vi } from 'vitest';
import {
  collectSignalImmutabilityProblems,
  inspectSignalImmutabilityCatalog,
  expectedSignalTriggerCount,
  signalGuardSourceHash,
} from '../src/signal-immutability-catalog.mjs';
import {
  signalImmutabilityFixture,
  signalImmutabilityQueryFixture,
} from './signal-immutability-fixtures.mjs';

const owner = 'hzense_migrator';

describe('Signal transaction seal exact catalog contract', () => {
  it('accepts exactly six reviewed functions, twenty-one guards and three xid8 columns', () => {
    const fixture = signalImmutabilityFixture();
    expect(fixture.routines).toHaveLength(6);
    expect(fixture.triggers).toHaveLength(21);
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([]);
    expect(expectedSignalTriggerCount('signal_versions')).toBe(2);
    expect(expectedSignalTriggerCount('signal_publication_outbox')).toBe(3);
    expect(expectedSignalTriggerCount('signal_publication_state')).toBe(2);
    expect(expectedSignalTriggerCount('signal_publication_runs')).toBe(2);
    expect(expectedSignalTriggerCount('topics')).toBe(0);
    expect(expectedSignalTriggerCount('unexpected')).toBe(0);
  });

  it.each([
    ['trigger_type', 19],
    ['enabled', 'O'],
    ['enabled', 'D'],
    ['routine_name', 'hzense_guard_publication_receipt'],
    ['when_expression', 'false'],
    ['column_numbers', '5'],
  ])('rejects changed publication run guard %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers.find((row) => row.name === 'signal_publication_runs_guard_trg')[key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
  });

  it.each([
    ['constraint_trigger', false],
    ['deferrable', false],
    ['initially_deferred', false],
    ['trigger_type', 7],
    ['enabled', 'O'],
    ['routine_name', 'hzense_guard_publication_receipt'],
    ['when_expression', 'false'],
    ['column_numbers', '1'],
  ])('rejects changed deferred publication pair trigger %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    const trigger = fixture.triggers.find(
      (row) => row.name === 'signal_publication_state_pair_trg',
    );
    trigger[key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
  });

  it.each([
    'hzense_guard_publication_receipt',
    'hzense_check_publication_pair',
    'hzense_guard_publication_run',
  ])('pins publication function %s source and privileges', (name) => {
    for (const mutation of [
      (routine) => {
        routine.source = 'BEGIN RETURN NULL; END;';
      },
      (routine) => {
        routine.security_definer = true;
      },
      (routine) => {
        routine.unsafe_acl_count = 1;
      },
    ]) {
      const fixture = signalImmutabilityFixture();
      mutation(fixture.routines.find((row) => row.name === name));
      expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
        expect.stringContaining('function contract mismatch'),
      ]);
    }
  });

  it.each([
    ['trigger_type', 19],
    ['enabled', 'O'],
    ['enabled', 'D'],
    ['enabled', 'R'],
    ['routine_name', 'other_guard'],
    ['routine_schema', 'other'],
    ['routine_arguments', 'text'],
    ['constraint_trigger', true],
    ['parent_trigger', true],
    ['deferrable', true],
    ['initially_deferred', true],
    ['argument_count', 1],
    ['arguments_hex', '00'],
    ['column_numbers', '1'],
    ['when_expression', 'false'],
    ['old_transition_table', 'old_rows'],
    ['new_transition_table', 'new_rows'],
    ['table_owner', 'writer'],
  ])('rejects changed trigger %s=%s without merely checking count', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers[0][key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
  });

  it.each([
    ['owner', 'writer'],
    ['language', 'sql'],
    ['kind', 'p'],
    ['result_type', 'text'],
    ['security_definer', true],
    ['leakproof', true],
    ['strict', true],
    ['returns_set', true],
    ['volatility', 's'],
    ['parallel', 's'],
    ['support_function', true],
    ['binary', '$libdir/unsafe'],
    ['sql_body', 'body'],
    ['configuration', ['search_path=public, pg_catalog']],
    ['unsafe_acl_count', 1],
    ['owner_execute_count', 0],
    ['source', 'BEGIN RETURN NEW; END;'],
  ])('rejects changed guard function %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.routines[0][key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('function contract mismatch'),
    ]);
  });

  it.each([
    ['data_type', 'xid'],
    ['not_null', false],
    ['generated_kind', 's'],
    ['default_expression', "'1'::xid8"],
    ['default_expression', 'other.pg_current_xact_id()'],
  ])('rejects changed creation stamp %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.stamps[0][key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('creation transaction column mismatch'),
    ]);
  });

  it('rejects missing/extra functions, overloads and triggers', () => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers[0].name = 'substitute';
    fixture.routines[0].identity_arguments = 'text';
    fixture.routines.push({ ...fixture.routines[1], name: 'unexpected' });
    fixture.stamps.pop();
    const problems = inspectSignalImmutabilityCatalog(fixture, owner);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing Signal immutability trigger'),
        expect.stringContaining('unexpected user trigger'),
        expect.stringContaining('missing Signal immutability function'),
        expect.stringContaining('unexpected public application function'),
        expect.stringContaining('creation transaction column mismatch'),
      ]),
    );
  });

  it('does not discard semantic whitespace, case or punctuation within function bodies', () => {
    expect(signalGuardSourceHash("\nBEGIN RETURN 'a(b) C'; END;\n")).toBe(
      signalGuardSourceHash("BEGIN RETURN 'a(b) C'; END;"),
    );
    for (const value of [
      "BEGIN RETURN 'ab C'; END;",
      "BEGIN RETURN 'a(b)c'; END;",
      "BEGIN RETURN 'a(b) c'; END;",
    ]) {
      expect(signalGuardSourceHash(value)).not.toBe(
        signalGuardSourceHash("BEGIN RETURN 'a(b) C'; END;"),
      );
    }
  });

  it('collects only catalog data, no private table reads or function execution', async () => {
    const client = { query: vi.fn(async (sql) => signalImmutabilityQueryFixture(sql)) };
    expect(await collectSignalImmutabilityProblems(client, owner)).toEqual([]);
    expect(client.query).toHaveBeenCalledTimes(3);
    for (const [sql] of client.query.mock.calls) {
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|ALTER)\b/);
      expect(sql).not.toContain('FROM public.');
    }
  });
});
