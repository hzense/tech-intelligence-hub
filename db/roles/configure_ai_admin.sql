-- Reviewed opt-in candidate: never run from migrations, web startup or a probe.
-- Authenticate as the database owner after exact schema verification. An admin
-- must pre-create EMPTY hzense_ai_admin LOGIN NOINHERIT CONNECTION LIMIT 2.
-- No passwords/roles are created here. Refuse existing rights, do not repair
-- PUBLIC/other-role privileges. Trusted server service writes this private state.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $ai_admin$
DECLARE target pg_roles%ROWTYPE; database_owner oid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  SELECT datdba INTO database_owner FROM pg_database WHERE datname=current_database();
  IF session_user<>current_user OR pg_get_userbyid(database_owner)<>current_user THEN
    RAISE EXCEPTION 'Authenticated database owner required';
  END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname='hzense_ai_admin';
  IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN
    RAISE EXCEPTION 'Pre-create a restricted hzense_ai_admin LOGIN NOINHERIT CONNECTION LIMIT 2';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=target.oid OR roleid=target.oid)
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN
    RAISE EXCEPTION 'AI administrator must have no ownership, memberships, settings or existing direct ACLs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0013_ai_configuration.sql') THEN
    RAISE EXCEPTION 'Verify migration 0013 before AI administrator provisioning';
  END IF;
  IF has_database_privilege(target.oid,current_database(),'CREATE') OR has_database_privilege(target.oid,current_database(),'TEMPORARY')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
      AND (has_schema_privilege(target.oid,oid,'CREATE') OR (nspname<>'public' AND has_schema_privilege(target.oid,oid,'USAGE')))) THEN
    RAISE EXCEPTION 'Remove unsafe ambient database/schema capabilities in separately approved maintenance';
  END IF;
  -- PUBLIC privileges apply even to NOINHERIT roles. Inspect every connectable
  -- database without changing its ACL. Only the same exact provider-owned
  -- reserved-database shapes accepted by the runtime reader are exempt.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname<>current_database() AND d.datallowconn
    AND (has_database_privilege(target.oid,d.oid,'CONNECT') OR has_database_privilege(target.oid,d.oid,'CREATE')
      OR has_database_privilege(target.oid,d.oid,'TEMPORARY'))
    AND NOT (
      pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
      AND NOT has_database_privilege(target.oid,d.oid,'CONNECT WITH GRANT OPTION')
      AND NOT has_database_privilege(target.oid,d.oid,'CREATE')
      AND NOT has_database_privilege(target.oid,d.oid,'CREATE WITH GRANT OPTION')
      AND NOT has_database_privilege(target.oid,d.oid,'TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
        WHERE a.grantee=target.oid OR (a.grantee=0 AND a.is_grantable))
      AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND has_database_privilege(target.oid,d.oid,'CONNECT') AND has_database_privilege(target.oid,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(target.oid,d.oid,'CONNECT') AND NOT has_database_privilege(target.oid,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))
    )) THEN
    RAISE EXCEPTION 'AI administrator has unsafe privileges on another connectable database';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) grant_row
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND grant_row.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target.oid,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Ambient application data/function privileges are not permitted';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_ai_admin',current_database());
END;
$ai_admin$;
GRANT USAGE ON SCHEMA public TO hzense_ai_admin;
-- Pin reads to the reviewed columns: adding a private column must not silently
-- expose it to the service, including through SELECT * or RETURNING *.
GRANT SELECT (id,revision,name,protocol,base_url,enabled,settings,encrypted_key,created_at,updated_at) ON public.ai_connections TO hzense_ai_admin;
GRANT SELECT (connection_id,revision,snapshot,created_at) ON public.ai_connection_versions TO hzense_ai_admin;
GRANT SELECT (id,revision,name,stages,created_at,updated_at) ON public.ai_profiles TO hzense_ai_admin;
GRANT SELECT (profile_id,revision,snapshot,created_at) ON public.ai_profile_versions TO hzense_ai_admin;
GRANT SELECT (id,connection_id,connection_revision,kind,model_id,fingerprint,status,configuration,reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,created_at,finished_at) ON public.ai_probe_runs TO hzense_ai_admin;
GRANT INSERT (id,revision,name,protocol,base_url,enabled,settings,encrypted_key,created_at,updated_at) ON public.ai_connections TO hzense_ai_admin;
GRANT UPDATE (revision,name,protocol,base_url,enabled,settings,encrypted_key,updated_at) ON public.ai_connections TO hzense_ai_admin;
GRANT INSERT (connection_id,revision,snapshot,created_at) ON public.ai_connection_versions TO hzense_ai_admin;
GRANT INSERT (id,revision,name,stages,created_at,updated_at) ON public.ai_profiles TO hzense_ai_admin;
GRANT UPDATE (revision,name,stages,updated_at) ON public.ai_profiles TO hzense_ai_admin;
GRANT INSERT (profile_id,revision,snapshot,created_at) ON public.ai_profile_versions TO hzense_ai_admin;
GRANT INSERT (id,connection_id,connection_revision,kind,model_id,fingerprint,status,configuration,reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,created_at,finished_at) ON public.ai_probe_runs TO hzense_ai_admin;
GRANT UPDATE (status,reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,finished_at) ON public.ai_probe_runs TO hzense_ai_admin;

-- GRANT may only warn when the authenticated owner lacks a grant option. Check
-- both effective privileges and the exact direct ACL before committing anything.
DO $ai_admin_verify$
DECLARE
  target oid := 'hzense_ai_admin'::regrole;
  relation_info record;
  column_info record;
  checked_privilege text;
  expected boolean;
  read_insert_columns jsonb := $columns${
    "ai_connections": ["id","revision","name","protocol","base_url","enabled","settings","encrypted_key","created_at","updated_at"],
    "ai_connection_versions": ["connection_id","revision","snapshot","created_at"],
    "ai_profiles": ["id","revision","name","stages","created_at","updated_at"],
    "ai_profile_versions": ["profile_id","revision","snapshot","created_at"],
    "ai_probe_runs": ["id","connection_id","connection_revision","kind","model_id","fingerprint","status","configuration","reserved_microusd","charged_microusd","input_tokens","output_tokens","result","error_code","created_at","finished_at"]
  }$columns$::jsonb;
  update_columns jsonb := $columns${
    "ai_connections": ["revision","name","protocol","base_url","enabled","settings","encrypted_key","updated_at"],
    "ai_profiles": ["revision","name","stages","updated_at"],
    "ai_probe_runs": ["status","reserved_microusd","charged_microusd","input_tokens","output_tokens","result","error_code","finished_at"]
  }$columns$::jsonb;
BEGIN
  IF NOT has_database_privilege(target,current_database(),'CONNECT')
    OR has_database_privilege(target,current_database(),'CONNECT WITH GRANT OPTION')
    OR has_database_privilege(target,current_database(),'CREATE')
    OR has_database_privilege(target,current_database(),'TEMPORARY')
    OR (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE d.datname=current_database() AND a.grantee=target AND a.privilege_type='CONNECT' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'AI administrator database privilege contract mismatch';
  END IF;
  -- Recheck effective cross-database privileges after GRANT. Drift visible at
  -- this check fails provisioning; this does not lock other databases' ACLs or
  -- prevent later changes. Keep the operator's maintenance freeze in place.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname<>current_database() AND d.datallowconn
    AND (has_database_privilege(target,d.oid,'CONNECT') OR has_database_privilege(target,d.oid,'CREATE')
      OR has_database_privilege(target,d.oid,'TEMPORARY'))
    AND NOT (
      pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
      AND NOT has_database_privilege(target,d.oid,'CONNECT WITH GRANT OPTION')
      AND NOT has_database_privilege(target,d.oid,'CREATE')
      AND NOT has_database_privilege(target,d.oid,'CREATE WITH GRANT OPTION')
      AND NOT has_database_privilege(target,d.oid,'TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
        WHERE a.grantee=target OR (a.grantee=0 AND a.is_grantable))
      AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND has_database_privilege(target,d.oid,'CONNECT') AND has_database_privilege(target,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(target,d.oid,'CONNECT') AND NOT has_database_privilege(target,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))
    )) THEN
    RAISE EXCEPTION 'AI administrator has unsafe privileges on another connectable database';
  END IF;
  IF NOT has_schema_privilege(target,'public','USAGE')
    OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(target,n.oid,'CREATE') OR has_schema_privilege(target,n.oid,'USAGE WITH GRANT OPTION')
        OR (n.nspname<>'public' AND has_schema_privilege(target,n.oid,'USAGE'))))
    OR (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname='public' AND a.grantee=target AND a.privilege_type='USAGE' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'AI administrator schema privilege contract mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=target) THEN
    RAISE EXCEPTION 'AI administrator must have no direct table or sequence privileges';
  END IF;
  FOR relation_info IN
    SELECT c.oid,c.relname,c.relkind,c.relowner,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
  LOOP
    -- Use PostgreSQL's own privilege list, including privileges added by newer
    -- server versions, rather than overlooking a future table-level capability.
    FOR checked_privilege IN SELECT a.privilege_type FROM aclexplode(acldefault(
      CASE WHEN relation_info.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relation_info.relowner)) a
    LOOP
      IF relation_info.relkind='S' THEN
        IF has_sequence_privilege(target,relation_info.oid,checked_privilege) THEN
          RAISE EXCEPTION 'AI administrator effective sequence privilege contract mismatch';
        END IF;
      ELSIF has_table_privilege(target,relation_info.oid,checked_privilege) THEN
        RAISE EXCEPTION 'AI administrator effective table privilege contract mismatch';
      END IF;
    END LOOP;
    FOR column_info IN SELECT a.attnum,a.attname FROM pg_attribute a
      WHERE a.attrelid=relation_info.oid AND a.attnum>0 AND NOT a.attisdropped AND relation_info.relkind<>'S'
    LOOP
      FOREACH checked_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        expected := relation_info.nspname='public' AND relation_info.relkind='r' AND CASE
          WHEN checked_privilege IN ('SELECT','INSERT') THEN COALESCE((read_insert_columns->relation_info.relname)?column_info.attname,false)
          WHEN checked_privilege='UPDATE' THEN COALESCE((update_columns->relation_info.relname)?column_info.attname,false)
          ELSE false END;
        IF has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege) IS DISTINCT FROM expected
          OR has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege||' WITH GRANT OPTION') THEN
          RAISE EXCEPTION 'AI administrator effective column privilege contract mismatch on %.%.%',
            relation_info.nspname,relation_info.relname,column_info.attname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS(
    WITH expected_acl AS (
      SELECT 'public'::name AS schema_name,e.key::name AS table_name,c.column_name::name AS column_name,p.privilege_name
      FROM jsonb_each(read_insert_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(column_name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege_name)
      UNION ALL
      SELECT 'public'::name,e.key::name,c.column_name::name,'UPDATE'
      FROM jsonb_each(update_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(column_name)
    ), actual_acl AS (
      SELECT n.nspname AS schema_name,c.relname AS table_name,col.attname AS column_name,a.privilege_type AS privilege_name,a.is_grantable
      FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE a.grantee=target
    )
    SELECT 1 FROM (
      (SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl WHERE NOT is_grantable)
      UNION ALL
      (SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl)
    ) difference
  ) THEN
    RAISE EXCEPTION 'AI administrator direct column ACL contract mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=target)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'AI administrator function privilege contract mismatch';
  END IF;
END;
$ai_admin_verify$;
COMMIT;
