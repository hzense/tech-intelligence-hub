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
  it('accepts exactly eighteen reviewed functions, forty-seven guards and four xid8 columns', () => {
    const fixture = signalImmutabilityFixture();
    expect(fixture.routines).toHaveLength(18);
    expect(fixture.triggers).toHaveLength(47);
    expect(fixture.stamps).toHaveLength(4);
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([]);
    expect(expectedSignalTriggerCount('signal_versions')).toBe(2);
    expect(expectedSignalTriggerCount('signal_publication_outbox')).toBe(3);
    expect(expectedSignalTriggerCount('signal_publication_state')).toBe(2);
    expect(expectedSignalTriggerCount('signal_publication_runs')).toBe(2);
    expect(expectedSignalTriggerCount('signal_qualified_publication_receipts')).toBe(3);
    expect(expectedSignalTriggerCount('signal_candidate_verifications')).toBe(3);
    expect(expectedSignalTriggerCount('signal_candidate_assembly_receipts')).toBe(3);
    expect(expectedSignalTriggerCount('topics')).toBe(1);
    expect(expectedSignalTriggerCount('signal_publication_permits')).toBe(3);
    expect(expectedSignalTriggerCount('signal_verification_dependency_seals')).toBe(2);
    expect(expectedSignalTriggerCount('unexpected')).toBe(0);
  });

  it.each([
    ['deferrable', false],
    ['initially_deferred', false],
    ['enabled', 'O'],
    ['trigger_type', 7],
    ['routine_name', 'hzense_guard_publication_run'],
    ['when_expression', 'false'],
  ])('rejects weakened candidate assembly approval guard %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers.find((row) => row.name === 'signal_candidate_assembly_receipts_approval_trg')[
      key
    ] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
  });

  it.each([
    'hzense_signal_dependency_seal',
    'hzense_lock_publication_controls',
    'hzense_lock_publication_dependencies',
    'hzense_capture_verification_dependencies',
    'hzense_guard_verification_dependency_seal',
    'hzense_invalidate_verification_dependencies',
    'hzense_guard_publication_permit',
    'hzense_public_signal_is_current',
  ])('rejects unreviewed source, security context and ACL for current capability %s', (name) => {
    for (const mutation of [
      (routine) => {
        routine.source += '\n-- unreviewed replacement';
      },
      (routine) => {
        routine.security_definer = !routine.security_definer;
      },
      (routine) => {
        routine.configuration = ['search_path=public, pg_catalog'];
      },
      (routine) => {
        routine.acl_entries = [
          { grantee: 'PUBLIC', grantor: owner, privilege: 'EXECUTE', grantable: false },
        ];
      },
      (routine) => {
        routine.acl_entries[0].grantable = true;
      },
      (routine) => {
        routine.acl_entries[0].grantor = 'untrusted_grantor';
      },
      (routine) => {
        routine.acl_entries = [
          {
            grantee: 'hzense_signal_writer',
            grantor: owner,
            privilege: 'EXECUTE',
            grantable: false,
          },
        ];
      },
    ]) {
      const fixture = signalImmutabilityFixture();
      mutation(fixture.routines.find((routine) => routine.name === name));
      expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
        expect.stringContaining('Current publication function contract mismatch'),
      ]);
    }
  });

  it('allows only the exact named read/lock capabilities after a separately applied grant', () => {
    const fixture = signalImmutabilityFixture();
    for (const [name, grantees] of [
      ['hzense_lock_publication_controls', ['hzense_publisher']],
      ['hzense_lock_publication_dependencies', ['hzense_publisher']],
      ['hzense_public_signal_is_current', ['hzense_publisher', 'hzense_runtime']],
    ]) {
      fixture.routines
        .find((row) => row.name === name)
        .acl_entries.push(
          ...grantees.map((grantee) => ({
            grantee,
            grantor: owner,
            privilege: 'EXECUTE',
            grantable: false,
          })),
        );
    }
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([]);
  });

  it('accepts the separately provisioned Signal admin reader on the currentness predicate only', () => {
    const fixture = signalImmutabilityFixture();
    fixture.routines
      .find((row) => row.name === 'hzense_public_signal_is_current')
      .acl_entries.push({
        grantee: 'hzense_signal_admin_reader',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
      });
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([]);
  });

  it('accepts the separately provisioned candidate verifier dependency lock grant', () => {
    const fixture = signalImmutabilityFixture();
    fixture.routines
      .find((row) => row.name === 'hzense_lock_publication_dependencies')
      .acl_entries.push({
        grantee: 'hzense_candidate_verifier',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
      });
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([]);
  });

  it.each([
    { grantee: 'PUBLIC' },
    { grantee: 'hzense_candidate_assembler' },
    { grantee: 'hzense_publication_controller' },
    { grantee: 'unreviewed_verifier' },
    { grantor: 'untrusted_grantor' },
    { privilege: 'SELECT' },
    { grantable: true },
  ])('rejects a broadened candidate verifier dependency lock grant: %j', (change) => {
    const fixture = signalImmutabilityFixture();
    fixture.routines
      .find((row) => row.name === 'hzense_lock_publication_dependencies')
      .acl_entries.push({
        grantee: 'hzense_candidate_verifier',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
        ...change,
      });
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      'Current publication function contract mismatch: hzense_lock_publication_dependencies(p_signal_id text, p_source_version integer)',
    ]);
  });

  it('does not permit the candidate verifier to execute any other publication or guard function', () => {
    for (const candidate of signalImmutabilityFixture().routines) {
      if (candidate.name === 'hzense_lock_publication_dependencies') continue;
      const fixture = signalImmutabilityFixture();
      const row = fixture.routines.find((row) => row.name === candidate.name);
      row.acl_entries.push({
        grantee: 'hzense_candidate_verifier',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
      });
      row.unsafe_acl_count += 1;
      expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
        expect.stringContaining(`function contract mismatch: ${candidate.name}(`),
      ]);
    }
  });

  it.each([
    { grantee: 'PUBLIC' },
    { grantee: 'hzense_import_admin' },
    { grantee: 'unreviewed_reader' },
    { grantor: 'untrusted_grantor' },
    { privilege: 'SELECT' },
    { grantable: true },
  ])('rejects a broadened Signal reader predicate grant: %j', (change) => {
    const fixture = signalImmutabilityFixture();
    fixture.routines
      .find((row) => row.name === 'hzense_public_signal_is_current')
      .acl_entries.push({
        grantee: 'hzense_signal_admin_reader',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
        ...change,
      });
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      'Current publication function contract mismatch: hzense_public_signal_is_current(p_event_id uuid)',
    ]);
  });

  it('does not permit the Signal admin reader to execute any other publication or guard function', () => {
    for (const candidate of signalImmutabilityFixture().routines) {
      if (candidate.name === 'hzense_public_signal_is_current') continue;
      const fixture = signalImmutabilityFixture();
      const row = fixture.routines.find((row) => row.name === candidate.name);
      row.acl_entries.push({
        grantee: 'hzense_signal_admin_reader',
        grantor: owner,
        privilege: 'EXECUTE',
        grantable: false,
      });
      row.unsafe_acl_count += 1;
      expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
        expect.stringContaining(`function contract mismatch: ${candidate.name}(`),
      ]);
    }
  });

  it.each([
    'signal_publication_permits_current_trg',
    'sources_verification_invalidation_trg',
    'signal_candidate_verifications_dependencies_trg',
  ])('pins every new guard attachment including %s', (name) => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers.find((row) => row.name === name).enabled = 'D';
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
  });

  it.each([
    ['deferrable', false],
    ['initially_deferred', false],
    ['enabled', 'O'],
    ['trigger_type', 7],
    ['routine_name', 'hzense_guard_publication_run'],
    ['when_expression', 'false'],
  ])('rejects weakened qualified receipt commit guard %s', (key, value) => {
    const fixture = signalImmutabilityFixture();
    fixture.triggers.find(
      (row) => row.name === 'signal_qualified_publication_receipts_controls_trg',
    )[key] = value;
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining('trigger contract mismatch'),
    ]);
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
    'hzense_guard_qualified_publication_receipt',
    'hzense_guard_candidate_verification',
  ])('pins publication function %s source and privileges', (name) => {
    for (const mutation of [
      (routine) => {
        routine.source = 'BEGIN RETURN NULL; END;';
      },
      (routine) => {
        routine.security_definer = !routine.security_definer;
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

  it('pins the candidate verification xid separately from the legacy seal attachment set', () => {
    const fixture = signalImmutabilityFixture();
    fixture.stamps.find(
      (row) => row.table_name === 'signal_candidate_verifications',
    ).default_expression = "'1'::xid8";
    expect(inspectSignalImmutabilityCatalog(fixture, owner)).toEqual([
      expect.stringContaining(
        'creation transaction column mismatch: signal_candidate_verifications',
      ),
    ]);
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
