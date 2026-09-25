import { editorialColumns, editorialPublicColumns } from './editorial-signal-catalog.mjs';
import { EditorialSignalError } from './editorial-signal-contract.mjs';
export const editorialRoleColumns = {
  writer: {
    editorial_signal_revisions: Object.keys(editorialColumns.editorial_signal_revisions),
    signal_generation_runs: ['id', 'owner_id', 'status', 'deleted_at'],
    topics: ['id', 'title', 'runtime_enabled', 'status'],
  },
  reader: { editorial_public_signals: editorialPublicColumns.map(([column]) => column) },
};
export async function assertEditorialRole(client, role) {
  if (!['writer', 'reader'].includes(role))
    throw new EditorialSignalError('editorial_role_invalid');
  const identity = (
    await client.query(`SELECT current_user AS name, current_user=session_user AND r.rolcanlogin AND r.rolconnlimit=2
    AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    AND r.rolconfig IS NULL AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
      AND (m.roleid=r.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid
      AND (deptype='o' OR (deptype='a' AND (
        classid NOT IN ('pg_database'::regclass,'pg_namespace'::regclass,'pg_class'::regclass)
        OR dbid NOT IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))))))
    AND NOT EXISTS(SELECT 1 FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a WHERE a.grantee IN (0,r.oid))
    AND has_database_privilege(current_database(),'CONNECT')
    AND NOT has_database_privilege(current_database(),'CONNECT WITH GRANT OPTION')
    AND NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE d.datname<>current_database() AND a.grantee=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database() AND d.datallowconn
      AND has_database_privilege(r.oid,d.oid,'CONNECT,CREATE,TEMPORARY')
      AND NOT (
        pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
        AND NOT has_database_privilege(r.oid,d.oid,'CONNECT WITH GRANT OPTION,CREATE,CREATE WITH GRANT OPTION,TEMPORARY WITH GRANT OPTION')
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
          WHERE a.grantee=r.oid OR (a.grantee=0 AND a.is_grantable))
        AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
          AND has_database_privilege(r.oid,d.oid,'CONNECT') AND has_database_privilege(r.oid,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(r.oid,d.oid,'CONNECT') AND NOT has_database_privilege(r.oid,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))))
    AND NOT has_database_privilege(current_database(),'CREATE,TEMPORARY')
    AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(oid,'CREATE'))
    AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'SELECT,UPDATE,USAGE') ELSE false END)
    AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) AS safe
    FROM pg_roles r WHERE r.rolname=current_user`)
  ).rows[0];
  if (!identity?.safe || identity.name !== `hzense_editorial_${role}`)
    throw new EditorialSignalError('editorial_role_invalid');
  const columns = (
    await client.query(`SELECT n.nspname AS schema,c.relname AS table_name,a.attname AS column_name,p.privilege,
    has_column_privilege(c.oid,a.attnum,p.privilege || ' WITH GRANT OPTION') AS grantable
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(c.oid,a.attnum,p.privilege)`)
  ).rows;
  const expected = new Set(
    Object.entries(editorialRoleColumns[role]).flatMap(([table, names]) =>
      names.flatMap((name) => [
        `${table}|${name}|SELECT`,
        ...(role === 'writer' && table === 'editorial_signal_revisions'
          ? [`${table}|${name}|INSERT`]
          : []),
      ]),
    ),
  );
  const mutable = (
    await client.query(
      `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')) AS unsafe`,
    )
  ).rows[0];
  if (
    mutable?.unsafe !== false ||
    columns.length !== expected.size ||
    columns.some(
      (column) =>
        column.schema !== 'public' ||
        column.grantable ||
        !expected.has(`${column.table_name}|${column.column_name}|${column.privilege}`),
    )
  )
    throw new EditorialSignalError('editorial_role_invalid');
}
