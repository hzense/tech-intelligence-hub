import { editorialColumns, editorialPublicColumns } from './editorial-signal-catalog.mjs';
import { EditorialSignalError } from './editorial-signal-contract.mjs';
import { editorialVectorManifest } from './editorial-vector-manifest.mjs';
import { editorialVectorQuery, canonicalVectorManifest } from './editorial-vector-query.mjs';
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
  // pg_init_privs records initial catalog ACLs, but not information_schema's
  // initdb SQL grants. Its fallback is restricted to bootstrap-owned built-ins
  // (OID < FirstNormalObjectId), never newly created user objects.
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
    AND NOT EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(l.lomacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_tablespace t CROSS JOIN LATERAL aclexplode(t.spcacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_foreign_server s CROSS JOIN LATERAL aclexplode(s.srvacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_foreign_data_wrapper f CROSS JOIN LATERAL aclexplode(f.fdwacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a
      WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=r.oid OR (a.grantee=0 AND NOT EXISTS(
        SELECT 1 FROM aclexplode(COALESCE(
          (SELECT p.initprivs FROM pg_init_privs p WHERE p.classoid='pg_proc'::regclass AND p.objoid=f.oid AND p.objsubid=0),
          CASE WHEN f.oid<16384 AND f.proowner=10 THEN acldefault('f',f.proowner) ELSE NULL::aclitem[] END
        )) initial WHERE initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
    AND NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=r.oid OR (a.grantee=0
        AND NOT (n.nspname='information_schema' AND n.oid<16384 AND n.nspowner=10 AND a.grantor=10 AND a.privilege_type='USAGE' AND NOT a.is_grantable)
        AND NOT EXISTS(
        SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
        WHERE p.classoid='pg_namespace'::regclass AND p.objoid=n.oid AND p.objsubid=0
          AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE (n.nspname~'^pg_' OR n.nspname='information_schema')
      AND (a.grantee=r.oid OR (a.grantee=0
        AND NOT (n.nspname='information_schema' AND n.oid<16384 AND c.oid<16384 AND c.relowner=10 AND a.grantor=10
          AND a.privilege_type='SELECT' AND NOT a.is_grantable
          AND (c.relkind='v' OR (c.relkind='r' AND c.relname IN ('sql_features','sql_implementation_info','sql_parts','sql_sizing'))))
        AND NOT EXISTS(
        SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
        WHERE p.classoid='pg_class'::regclass AND p.objoid=c.oid AND p.objsubid=0
          AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=r.oid OR (a.grantee=0 AND NOT EXISTS(
        SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
        WHERE p.classoid='pg_class'::regclass AND p.objoid=c.oid AND p.objsubid=col.attnum
          AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
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
    AND has_schema_privilege('public','USAGE')
    AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'
      AND (has_schema_privilege(oid,'CREATE,USAGE WITH GRANT OPTION') OR (nspname<>'public' AND has_schema_privilege(oid,'USAGE'))))
    AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'SELECT,UPDATE,USAGE') ELSE false END)
    AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.objid=p.oid AND d.deptype='e'
          AND e.extname='vector' AND e.extversion='0.8.6' AND e.extnamespace=n.oid AND n.nspname='public'
          AND ((p.proowner=e.extowner AND e.extowner=10)
            OR (pg_get_userbyid(p.proowner)='cloud_admin' AND pg_get_userbyid(e.extowner)='neondb_owner'))
          AND NOT p.prosecdef AND p.proconfig IS NULL
          AND NOT has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION')
          AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=r.oid OR (a.grantee=0 AND a.is_grantable))
          AND (SELECT count(*) FROM pg_depend members WHERE members.refclassid='pg_extension'::regclass
            AND members.refobjid=e.oid AND members.classid='pg_proc'::regclass AND members.deptype='e')=118)) AS safe
    FROM pg_roles r WHERE r.rolname=current_user`)
  ).rows[0];
  if (!identity?.safe || identity.name !== `hzense_editorial_${role}`)
    throw new EditorialSignalError('editorial_role_invalid');
  const vectorFunctions = (await client.query(editorialVectorQuery)).rows;
  if (
    vectorFunctions.length &&
    canonicalVectorManifest(vectorFunctions) !== canonicalVectorManifest(editorialVectorManifest)
  )
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
