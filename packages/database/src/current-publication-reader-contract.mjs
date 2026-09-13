import { currentPublicSignalColumns } from './current-publication-catalog.mjs';

// V3 capability increment. This is not the legacy FTS preflight and does not
// replace exact schema/body/owner verification or cross-database ACL inspection.
export const currentPublicReaderColumns = Object.freeze({
  topics: ['id', 'title', 'parent_id', 'status', 'runtime_enabled'],
  search_documents: [
    'source_id',
    'source_type',
    'title',
    'summary',
    'href',
    'keywords',
    'body',
    'document_date',
    'normalized_title',
    'normalized_summary',
    'normalized_keywords',
    'normalized_body',
  ],
  current_public_signals: currentPublicSignalColumns.map(([name]) => name),
});

export function inspectCurrentPublicSignalReaderAccess({ identity, columns, routines }) {
  const problems = [];
  if (
    !identity ||
    identity.authenticated_role !== 'hzense_runtime' ||
    identity.effective_role !== 'hzense_runtime' ||
    [
      'privileged',
      'inherits',
      'memberships',
      'database_create',
      'database_temp',
      'schema_create',
    ].some((key) => identity[key] !== false) ||
    identity.view_select !== true ||
    identity.current_execute !== true
  )
    problems.push('invalid_v3_runtime_capabilities');
  for (const row of columns ?? []) {
    if (
      row.writable ||
      (row.readable && !currentPublicReaderColumns[row.table_name]?.includes(row.column_name))
    ) {
      problems.push('unexpected_v3_runtime_data_access');
    }
  }
  for (const row of routines ?? []) {
    if (
      row.executable &&
      (row.routine_name !== 'hzense_public_signal_is_current' ||
        row.arguments !== 'p_event_id uuid')
    ) {
      problems.push('unexpected_v3_runtime_execution');
    }
  }
  if (!Array.isArray(columns) || !Array.isArray(routines))
    problems.push('incomplete_v3_runtime_inspection');
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export async function verifyCurrentPublicSignalReaderAccess(client) {
  const identity = await client.query(`/* hzense:current-reader:identity */
    SELECT session_user AS authenticated_role,current_user AS effective_role,
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS privileged,
      r.rolinherit AS inherits,EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS memberships,
      pg_catalog.has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
      pg_catalog.has_database_privilege(current_user,current_database(),'TEMPORARY') AS database_temp,
      pg_catalog.has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      pg_catalog.has_table_privilege(current_user,'public.current_public_signals','SELECT') AS view_select,
      pg_catalog.has_function_privilege(current_user,'public.hzense_public_signal_is_current(uuid)','EXECUTE') AS current_execute
    FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`);
  const columns = await client.query(`/* hzense:current-reader:columns */
    SELECT c.relname AS table_name,a.attname AS column_name,
      pg_catalog.has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS readable,
      pg_catalog.has_column_privilege(current_user,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES')
        OR pg_catalog.has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS writable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p')`);
  const routines = await client.query(`/* hzense:current-reader:routines */
    SELECT p.proname AS routine_name,pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE') AS executable
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid=p.oid AND d.deptype='e')`);
  const result = inspectCurrentPublicSignalReaderAccess({
    identity: identity.rows[0],
    columns: columns.rows,
    routines: routines.rows,
  });
  if (!result.ok) throw new Error('Current public Signal reader capability verification failed');
  return result;
}
