import { createHash } from 'node:crypto';
import {
  signalPublicationFunctionHashes,
  signalPublicationTriggers,
} from './signal-publication-catalog.mjs';
import {
  signalPublicationControlFunctionHashes,
  signalPublicationControlTriggers,
} from './signal-publication-control-catalog.mjs';
import {
  qualifiedPublicationFunctionHashes,
  qualifiedPublicationTriggers,
} from './qualified-publication-catalog.mjs';
import {
  candidateVerificationFunctionHashes,
  candidateVerificationTriggers,
  candidateVerificationStampedTables,
} from './candidate-verification-catalog.mjs';

// Independent migration 0007 seal contract, with the narrowly enumerated 0008–0011
// publication guards. Never derive expected bodies from installed catalog or
// migration SQL at runtime: both may have drifted.
export const stampedSignalTables = Object.freeze([
  'signal_versions',
  'public_source_evidence',
  'signal_event_identities',
]);
// Additional stamped records have their own append-only guard. Do not add
// them to the legacy 0007 guard's narrowly enumerated attachment set.
export const allStampedSignalTables = Object.freeze([
  ...stampedSignalTables,
  ...candidateVerificationStampedTables,
]);
export const sealedSignalEdgeTables = Object.freeze([
  'signal_version_evidence',
  'signal_version_people',
  'signal_version_organizations',
  'signal_version_topics',
]);
export const sealedSignalTables = Object.freeze([
  ...stampedSignalTables,
  ...sealedSignalEdgeTables,
]);

// Updated only after reviewing the function source as part of a migration.
export const sealedSignalFunctionHashes = Object.freeze({
  hzense_guard_sealed_row: 'cac551349972dfdc20016fd7bdb7f50c3ee97bb5c803ae7a7cffec2c6a429524',
  hzense_guard_version_edge: '49d6bf24722b9259c77cc4a03d79c53374cdad109d1c8950b9e053a63855720e',
  hzense_reject_sealed_truncate: 'b41325b4f62e1bd563246b024169e3c197e16bee10beee7edeadf15dd0305981',
  ...signalPublicationFunctionHashes,
  ...signalPublicationControlFunctionHashes,
  ...qualifiedPublicationFunctionHashes,
  ...candidateVerificationFunctionHashes,
});

export function expectedSignalTriggerCount(tableName) {
  return sealedSignalTriggers.filter((trigger) => trigger.table_name === tableName).length;
}

export const sealedSignalTriggers = Object.freeze([
  ...sealedSignalTables.flatMap((table) => [
    Object.freeze({
      table_name: table,
      name: `${table}_sealed_row_trg`,
      trigger_type: 31, // BEFORE ROW INSERT | UPDATE | DELETE
      routine_name: stampedSignalTables.includes(table)
        ? 'hzense_guard_sealed_row'
        : 'hzense_guard_version_edge',
    }),
    Object.freeze({
      table_name: table,
      name: `${table}_sealed_truncate_trg`,
      trigger_type: 34, // BEFORE STATEMENT TRUNCATE
      routine_name: 'hzense_reject_sealed_truncate',
    }),
  ]),
  ...signalPublicationTriggers,
  ...signalPublicationControlTriggers,
  ...qualifiedPublicationTriggers,
  ...candidateVerificationTriggers,
]);

export function signalGuardSourceHash(source) {
  // Only trim outer SQL dollar-quote padding; retain every literal, operator,
  // comment and internal whitespace. No SQL expression canonicalizer here.
  return createHash('sha256').update(source.trim(), 'utf8').digest('hex');
}

export function inspectSignalImmutabilityCatalog({ triggers, routines, stamps }, expectedOwner) {
  const problems = [];
  const actualTriggers = new Map(triggers.map((row) => [`${row.table_name}.${row.name}`, row]));
  for (const contract of sealedSignalTriggers) {
    const key = `${contract.table_name}.${contract.name}`;
    const row = actualTriggers.get(key);
    if (!row) {
      problems.push(`missing Signal immutability trigger: ${key}`);
      continue;
    }
    actualTriggers.delete(key);
    if (
      row.table_owner !== expectedOwner ||
      row.trigger_type !== contract.trigger_type ||
      row.enabled !== 'A' ||
      row.routine_schema !== 'public' ||
      row.routine_name !== contract.routine_name ||
      row.routine_arguments !== '' ||
      row.constraint_trigger !== (contract.constraint_trigger ?? false) ||
      row.parent_trigger !== false ||
      row.deferrable !== (contract.deferrable ?? false) ||
      row.initially_deferred !== (contract.initially_deferred ?? false) ||
      row.argument_count !== 0 ||
      row.arguments_hex !== '' ||
      row.column_numbers !== '' ||
      row.when_expression !== null ||
      row.old_transition_table !== null ||
      row.new_transition_table !== null
    ) {
      problems.push(`Signal immutability trigger contract mismatch: ${key}`);
    }
  }
  for (const key of actualTriggers.keys()) problems.push(`unexpected user trigger: ${key}`);

  const actualRoutines = new Map(
    routines.map((row) => [`${row.name}(${row.identity_arguments})`, row]),
  );
  for (const [name, sourceHash] of Object.entries(sealedSignalFunctionHashes)) {
    const key = `${name}()`;
    const row = actualRoutines.get(key);
    if (!row) {
      problems.push(`missing Signal immutability function: ${key}`);
      continue;
    }
    actualRoutines.delete(key);
    if (
      row.owner !== expectedOwner ||
      row.language !== 'plpgsql' ||
      row.kind !== 'f' ||
      row.result_type !== 'trigger' ||
      row.security_definer !== false ||
      row.leakproof !== false ||
      row.strict !== false ||
      row.returns_set !== false ||
      row.volatility !== 'v' ||
      row.parallel !== 'u' ||
      row.support_function !== false ||
      row.binary !== null ||
      row.sql_body !== null ||
      JSON.stringify(row.configuration) !== JSON.stringify(['search_path=pg_catalog, pg_temp']) ||
      row.unsafe_acl_count !== 0 ||
      row.owner_execute_count !== 1 ||
      typeof row.source !== 'string' ||
      signalGuardSourceHash(row.source) !== sourceHash
    ) {
      problems.push(`Signal immutability function contract mismatch: ${key}`);
    }
  }
  for (const key of actualRoutines.keys())
    problems.push(`unexpected public application function: ${key}`);

  const actualStamps = new Map(stamps.map((row) => [row.table_name, row]));
  for (const tableName of allStampedSignalTables) {
    const row = actualStamps.get(tableName);
    if (
      !row ||
      row.data_type !== 'xid8' ||
      row.not_null !== true ||
      row.generated_kind !== '' ||
      !['pg_current_xact_id()', 'pg_catalog.pg_current_xact_id()'].includes(row.default_expression)
    ) {
      problems.push(`Signal creation transaction column mismatch: ${tableName}.created_xid`);
    }
  }
  return problems;
}

export async function collectSignalImmutabilityProblems(client, expectedOwner) {
  // Catalog reads only; available even to a runtime reader without EXECUTE on
  // these functions or SELECT on the private data protected by the triggers.
  const triggers = await client.query(`/* hzense:signal-immutability:triggers */
    SELECT t.tgname AS name, c.relname AS table_name,
           pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
           t.tgtype::integer AS trigger_type, t.tgenabled AS enabled,
           pn.nspname AS routine_schema, p.proname AS routine_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS routine_arguments,
           (t.tgconstraint <> 0 OR t.tgconstrrelid <> 0 OR t.tgconstrindid <> 0) AS constraint_trigger,
           (t.tgparentid <> 0) AS parent_trigger,
           t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred,
           t.tgnargs::integer AS argument_count, pg_catalog.encode(t.tgargs, 'hex') AS arguments_hex,
           t.tgattr::text AS column_numbers,
           pg_catalog.pg_get_expr(t.tgqual, t.tgrelid) AS when_expression,
           t.tgoldtable AS old_transition_table, t.tgnewtable AS new_transition_table
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname`);
  const routines = await client.query(`/* hzense:signal-immutability:routines */
    SELECT p.proname AS name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner, l.lanname AS language,
           p.prokind AS kind, pg_catalog.format_type(p.prorettype, NULL) AS result_type,
           p.prosecdef AS security_definer, p.proleakproof AS leakproof,
           p.proisstrict AS strict, p.proretset AS returns_set,
           p.provolatile AS volatility, p.proparallel AS parallel,
           (p.prosupport <> 0) AS support_function,
           p.probin AS binary, p.prosqlbody::text AS sql_body,
           p.proconfig AS configuration, p.prosrc AS source,
           (SELECT count(*)::integer FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE a.grantee <> p.proowner OR a.grantor <> p.proowner
               OR a.privilege_type <> 'EXECUTE' OR a.is_grantable) AS unsafe_acl_count,
           (SELECT count(*)::integer FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE a.grantee = p.proowner AND a.privilege_type = 'EXECUTE') AS owner_execute_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        AND d.objid = p.oid AND d.deptype = 'e')
    ORDER BY p.proname, p.oid`);
  const stamps = await client.query(
    `/* hzense:signal-immutability:stamps */
    SELECT c.relname AS table_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null, a.attgenerated AS generated_kind,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND a.attname = 'created_xid'
      AND c.relname = ANY($1::text[])`,
    [allStampedSignalTables],
  );
  return inspectSignalImmutabilityCatalog(
    { triggers: triggers.rows, routines: routines.rows, stamps: stamps.rows },
    expectedOwner,
  );
}
