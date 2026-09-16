import { importFail } from '../../ingestion/src/import-task-contract.mjs';
import { importRoleColumns } from './import-role-columns.mjs';
const allowedColumns = Object.entries(importRoleColumns)
  .flatMap(([table, privileges]) =>
    Object.entries(privileges).flatMap(([privilege, columns]) =>
      columns.map((column) => `('${table}','${column}','${privilege}')`),
    ),
  )
  .join(',');
export const importRoleCheckSQL = `WITH allowed(table_name,column_name,privilege) AS (VALUES ${allowedColumns})
  SELECT current_user='hzense_import_admin' AND session_user=current_user
  AND r.rolcanlogin AND r.rolconnlimit=2 AND r.rolconfig IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
    AND (m.roleid=r.oid AND pg_get_userbyid(m.member)='neondb_owner'
      AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
  AND NOT has_database_privilege(current_database(),'CREATE,TEMPORARY')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(oid,'CREATE'))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND (
      c.relowner=r.oid OR EXISTS(SELECT 1 FROM aclexplode(acldefault('r',c.relowner)) p
        WHERE has_table_privilege(c.oid,p.privilege_type))))
  AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND (has_column_privilege(c.oid,a.attnum,p.privilege) IS DISTINCT FROM EXISTS(
      SELECT 1 FROM allowed e WHERE n.nspname='public' AND c.relkind='r' AND e.table_name=c.relname AND e.column_name=a.attname AND e.privilege=p.privilege)
      OR has_column_privilege(c.oid,a.attnum,p.privilege||' WITH GRANT OPTION')))
  AND NOT EXISTS(SELECT 1 FROM allowed e WHERE NOT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname=e.table_name AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(c.oid,a.attnum,e.privilege)))
  AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (c.relowner=r.oid OR has_sequence_privilege(c.oid,'SELECT,UPDATE,USAGE')))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AS safe
  FROM pg_roles r WHERE r.rolname=current_user`;
export async function assertImportRole(client) {
  if ((await client.query(importRoleCheckSQL)).rows[0]?.safe !== true) importFail('not_configured');
}
