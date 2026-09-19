import { signalGenerationRoleColumns } from './signal-generation-role-columns.mjs';

const allowedColumns = Object.entries(signalGenerationRoleColumns)
  .flatMap(([privilege, columns]) => columns.map((column) => `('${column}','${privilege}')`))
  .join(',');

const legacyAllowedColumns = Object.entries(signalGenerationRoleColumns)
  .flatMap(([privilege, columns]) =>
    columns
      .filter((column) => !['progress_phase', 'progress_at', 'started_at'].includes(column))
      .map((column) => `('${column}','${privilege}')`),
  )
  .join(',');

// Shared read-only catalog check for runtime and owner maintenance. No SET ROLE,
// ACL repair, secret reads or generation data reads are performed here.
export const generationRoleCheckSQL = `WITH allowed(column_name,privilege) AS (VALUES ${allowedColumns})
SELECT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
  AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND r.rolconnlimit=2 AND r.rolconfig IS NULL
  AND (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=r.oid OR roleid=r.oid)<=1
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
    AND (m.roleid=r.oid AND pg_catalog.pg_get_userbyid(m.member)='neondb_owner'
      AND pg_catalog.pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend
    WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=r.oid
      AND (deptype='o' OR (deptype='a' AND (
        classid NOT IN ('pg_catalog.pg_database'::regclass,'pg_catalog.pg_namespace'::regclass,'pg_catalog.pg_class'::regclass)
        OR dbid NOT IN (0,(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))))))
  AND pg_catalog.has_database_privilege(r.oid,current_database(),'CONNECT')
  AND NOT pg_catalog.has_database_privilege(r.oid,current_database(),'CONNECT WITH GRANT OPTION,CREATE,TEMPORARY')
  AND (SELECT count(*) FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) a WHERE a.grantee=r.oid)=1
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) a
    WHERE d.datname=current_database() AND a.grantee=r.oid AND a.privilege_type='CONNECT' AND NOT a.is_grantable)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname<>current_database() AND d.datallowconn
    AND pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT,CREATE,TEMPORARY')
    AND NOT (
      pg_catalog.pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
      AND NOT pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT WITH GRANT OPTION,CREATE,CREATE WITH GRANT OPTION,TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
        WHERE a.grantee=r.oid OR (a.grantee=0 AND a.is_grantable))
      AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT') AND pg_catalog.has_database_privilege(r.oid,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
      OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
        AND pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT') AND NOT pg_catalog.has_database_privilege(r.oid,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))))
  AND pg_catalog.has_schema_privilege(r.oid,'public','USAGE')
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
    AND (pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION')
      OR (n.nspname<>'public' AND pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE'))))
  AND (SELECT count(*) FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a WHERE a.grantee=r.oid)=1
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
    WHERE n.nspname='public' AND a.grantee=r.oid AND a.privilege_type='USAGE' AND NOT a.is_grantable)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
      AND CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')
        WHEN c.relkind IN ('r','p','v','m','f') THEN EXISTS(
          SELECT 1 FROM pg_catalog.aclexplode(pg_catalog.acldefault('r',c.relowner)) p
          WHERE pg_catalog.has_table_privilege(r.oid,c.oid,p.privilege_type)) ELSE false END)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r.oid)
  -- Effective role permissions alone cannot detect PUBLIC grants for a column
  -- already in this role's allowlist. Explicitly reject public data exposure.
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND a.grantee=0)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND a.grantee=0)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
      AND n.nspname!~'^pg_' AND n.nspname<>'information_schema'
      AND (pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) IS DISTINCT FROM EXISTS(
        SELECT 1 FROM allowed e WHERE n.nspname='public' AND c.relkind='r' AND c.relname='signal_generation_runs'
          AND e.column_name=a.attname AND e.privilege=p.privilege)
        OR pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION')))
  AND NOT EXISTS(SELECT 1 FROM allowed e WHERE NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname='signal_generation_runs'
      AND c.relowner=(SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database())
      AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,e.privilege)))
  AND (SELECT count(*) FROM pg_catalog.pg_attribute c CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a
    WHERE a.grantee=r.oid)=(SELECT count(*) FROM allowed)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE a.grantee=r.oid AND (n.nspname<>'public' OR c.relkind<>'r' OR c.relname<>'signal_generation_runs'
      OR col.attnum<=0 OR col.attisdropped OR a.grantor<>c.relowner OR a.is_grantable
      OR NOT EXISTS(SELECT 1 FROM allowed e WHERE e.column_name=col.attname AND e.privilege=a.privilege_type)))
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AS safe FROM pg_catalog.pg_roles r WHERE r.rolname='hzense_generation_admin'`;

// Frozen 0018 contract; not a relaxation of the new mutation contract.
export const legacyGenerationRoleCheckSQL = generationRoleCheckSQL.replace(
  `VALUES ${allowedColumns}`,
  `VALUES ${legacyAllowedColumns}`,
);
