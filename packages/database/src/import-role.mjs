import { importFail } from '../../ingestion/src/import-task-contract.mjs';
export const importRoleCheckSQL = `SELECT current_user='hzense_import_admin' AND session_user=current_user
  AND r.rolcanlogin AND r.rolconnlimit=2 AND r.rolconfig IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
  AND NOT has_database_privilege(current_database(),'CREATE,TEMPORARY')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(oid,'CREATE'))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND (
      c.relowner=r.oid OR EXISTS(SELECT 1 FROM aclexplode(acldefault('r',c.relowner)) p
        WHERE p.privilege_type NOT IN ('SELECT','INSERT','UPDATE') AND has_table_privilege(c.oid,p.privilege_type)) OR
      has_any_column_privilege(c.oid,'REFERENCES') OR
      has_table_privilege(c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION') OR
      has_any_column_privilege(c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION') OR
      (c.relname NOT IN ('import_batches','import_items','import_documents','import_attempts','import_outputs','import_audit','import_daily_usage') OR n.nspname<>'public') AND has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE') OR
      c.relname IN ('import_documents','import_outputs','import_audit') AND has_any_column_privilege(c.oid,'UPDATE')))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (c.relowner=r.oid OR has_sequence_privilege(c.oid,'SELECT,UPDATE,USAGE')))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
    AND c.relname IN ('import_batches','import_items','import_documents','import_attempts','import_outputs','import_audit','import_daily_usage')
    AND has_table_privilege(c.oid,'SELECT') AND has_table_privilege(c.oid,'INSERT')
    AND (c.relname IN ('import_documents','import_outputs','import_audit') OR has_table_privilege(c.oid,'UPDATE')))=7 AS safe
  FROM pg_roles r WHERE r.rolname=current_user`;
export async function assertImportRole(client) {
  if ((await client.query(importRoleCheckSQL)).rows[0]?.safe !== true) importFail('not_configured');
}
