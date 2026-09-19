-- Reviewed opt-in candidate: never run from migrations, web startup or a probe.
-- Authenticate as the database owner after exact schema verification. An admin
-- must pre-create EMPTY hzense_generation_admin LOGIN NOINHERIT CONNECTION LIMIT 2.
-- No passwords/roles are created here. Refuse existing rights, do not repair
-- PUBLIC/other-role privileges. Trusted server service writes this private state.
-- Column ACL source of truth: packages/database/src/signal-generation-role-columns.mjs.
-- Pin changes with signal-generation-role-columns.test.mjs.
-- PostgreSQL retains a bootstrap-superuser ADMIN-only grant to a non-superuser
-- creator. Accept only Neon's exact neondb_owner -> hzense_generation_admin management
-- edge, granted by cloud_admin with neither INHERIT nor SET. It gives the generation
-- login no provider privileges. Never create, revoke or repair memberships here.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';
DO $generation_admin$
DECLARE target pg_roles%ROWTYPE; database_owner oid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  SELECT datdba INTO database_owner FROM pg_database WHERE datname=current_database();
  IF session_user<>current_user OR pg_get_userbyid(database_owner)<>current_user THEN
    RAISE EXCEPTION 'Authenticated database owner required';
  END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname='hzense_generation_admin';
  IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN
    RAISE EXCEPTION 'Pre-create a restricted hzense_generation_admin LOGIN NOINHERIT CONNECTION LIMIT 2';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=target.oid OR roleid=target.oid)>1
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
      AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN
    RAISE EXCEPTION 'Generation administrator must have no ownership, unsafe memberships, settings or existing direct ACLs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0015_signal_generation.sql' AND checksum='0c93078e520045e733824668d5eafe23064c48c60a0f0d52c72e00a9eae6b666') THEN
    RAISE EXCEPTION 'Verify migration 0015 before Generation administrator provisioning';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE a.grantee IN (0,target.oid)) THEN
    RAISE EXCEPTION 'Remove unsafe explicit PUBLIC/generation default ACLs in separately approved maintenance';
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
    RAISE EXCEPTION 'Generation administrator has unsafe privileges on another connectable database';
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
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relowner=database_owner
      AND c.relname='signal_generation_runs')<>1 THEN
    RAISE EXCEPTION 'Verify the owner-controlled generation table before provisioning';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_generation_admin',current_database());
END;
$generation_admin$;
GRANT USAGE ON SCHEMA public TO hzense_generation_admin;
GRANT SELECT(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration,status,lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,result,error_code,created_at,finished_at,deleted_at),INSERT(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration),UPDATE(status,lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,result,error_code,finished_at,deleted_at) ON public.signal_generation_runs TO hzense_generation_admin;
DO $generation_admin_verify$
DECLARE
  target oid := 'hzense_generation_admin'::regrole;
  target_role pg_roles%ROWTYPE;
  relation_info record;
  column_info record;
  checked_privilege text;
  expected boolean;
  allowed_columns jsonb := '{"signal_generation_runs":{"SELECT":["id","owner_id","batch_id","item_id","source_fence","source_hash","profile_id","profile_revision","generation_version","fingerprint","snapshot","configuration","status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","created_at","finished_at","deleted_at"],"INSERT":["id","owner_id","batch_id","item_id","source_fence","source_hash","profile_id","profile_revision","generation_version","fingerprint","snapshot","configuration"],"UPDATE":["status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","finished_at","deleted_at"]}}'::jsonb;
BEGIN
  -- Re-read role attributes and memberships after GRANT. No role mutation is
  -- allowed to bypass the commit gate; this does not prevent later drift.
  SELECT * INTO target_role FROM pg_roles WHERE oid=target;
  IF NOT FOUND OR NOT target_role.rolcanlogin OR target_role.rolinherit OR target_role.rolconnlimit<>2
    OR target_role.rolsuper OR target_role.rolcreatedb OR target_role.rolcreaterole
    OR target_role.rolreplication OR target_role.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target
      AND (deptype='o' OR (deptype='a' AND (
        classid NOT IN ('pg_database'::regclass,'pg_namespace'::regclass,'pg_class'::regclass)
        OR dbid NOT IN (0,(SELECT oid FROM pg_database WHERE datname=current_database())))))) THEN
    RAISE EXCEPTION 'Generation administrator role contract mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=target OR roleid=target)>1
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=target OR m.roleid=target)
      AND (m.roleid=target AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Generation administrator membership contract mismatch';
  END IF;
  IF NOT has_database_privilege(target,current_database(),'CONNECT')
    OR has_database_privilege(target,current_database(),'CONNECT WITH GRANT OPTION')
    OR has_database_privilege(target,current_database(),'CREATE')
    OR has_database_privilege(target,current_database(),'TEMPORARY')
    OR (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE d.datname=current_database() AND a.grantee=target AND a.privilege_type='CONNECT' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'Generation administrator database privilege contract mismatch';
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
    RAISE EXCEPTION 'Generation administrator has unsafe privileges on another connectable database';
  END IF;
  IF NOT has_schema_privilege(target,'public','USAGE')
    OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(target,n.oid,'CREATE') OR has_schema_privilege(target,n.oid,'USAGE WITH GRANT OPTION')
        OR (n.nspname<>'public' AND has_schema_privilege(target,n.oid,'USAGE'))))
    OR (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname='public' AND a.grantee=target AND a.privilege_type='USAGE' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'Generation administrator schema privilege contract mismatch';
  END IF;
  -- Private generation ledger only; snapshots, source identity and configuration are immutable.
  FOR relation_info IN
    SELECT c.oid,c.relname,c.relkind,c.relowner,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
  LOOP
    FOR checked_privilege IN SELECT a.privilege_type FROM aclexplode(acldefault(
      CASE WHEN relation_info.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relation_info.relowner)) a
    LOOP
      expected := false; -- No table-wide grants, including future columns.
      IF relation_info.relkind='S' THEN
        IF has_sequence_privilege(target,relation_info.oid,checked_privilege) THEN
          RAISE EXCEPTION 'Generation administrator sequence privilege mismatch';
        END IF;
      ELSIF has_table_privilege(target,relation_info.oid,checked_privilege) IS DISTINCT FROM expected
        OR has_table_privilege(target,relation_info.oid,checked_privilege||' WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'Generation administrator table privilege mismatch: %.% %',relation_info.nspname,relation_info.relname,checked_privilege;
      END IF;
    END LOOP;
    FOR column_info IN SELECT a.attnum,a.attname FROM pg_attribute a
      WHERE a.attrelid=relation_info.oid AND a.attnum>0 AND NOT a.attisdropped AND relation_info.relkind<>'S'
    LOOP
      FOREACH checked_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        expected := relation_info.nspname='public' AND relation_info.relkind='r'
          AND COALESCE((allowed_columns->relation_info.relname->checked_privilege) ? column_info.attname,false);
        IF has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege) IS DISTINCT FROM expected
          OR has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege||' WITH GRANT OPTION') THEN
          RAISE EXCEPTION 'Generation administrator column privilege mismatch';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- Exact pinned direct column ACLs; missing, extra and future grants fail closed.
  -- PUBLIC grants to an already-allowed column do not change the target's
  -- effective rights. Reject the public exposure independently before COMMIT.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0) THEN
    RAISE EXCEPTION 'Generation administrator public data ACL contract mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=target)
    OR (SELECT count(*) FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE a.grantee=target)<>45
    OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE a.grantee=target AND
      (n.nspname<>'public' OR c.relkind<>'r' OR col.attnum<=0 OR col.attisdropped
        OR a.grantor<>c.relowner OR a.is_grantable
        OR NOT COALESCE((allowed_columns->c.relname->a.privilege_type) ? col.attname,false)))
    OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,target)) THEN
    RAISE EXCEPTION 'Generation administrator direct ACL contract mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=target)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Generation administrator function privilege contract mismatch';
  END IF;
END;
$generation_admin_verify$;
COMMIT;
