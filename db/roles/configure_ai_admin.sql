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
GRANT SELECT ON public.ai_connections,public.ai_connection_versions,public.ai_profiles,
  public.ai_profile_versions,public.ai_probe_runs TO hzense_ai_admin;
GRANT INSERT (id,revision,name,protocol,base_url,enabled,settings,encrypted_key,created_at,updated_at) ON public.ai_connections TO hzense_ai_admin;
GRANT UPDATE (revision,name,protocol,base_url,enabled,settings,encrypted_key,updated_at) ON public.ai_connections TO hzense_ai_admin;
GRANT INSERT (connection_id,revision,snapshot,created_at) ON public.ai_connection_versions TO hzense_ai_admin;
GRANT INSERT (id,revision,name,stages,created_at,updated_at) ON public.ai_profiles TO hzense_ai_admin;
GRANT UPDATE (revision,name,stages,updated_at) ON public.ai_profiles TO hzense_ai_admin;
GRANT INSERT (profile_id,revision,snapshot,created_at) ON public.ai_profile_versions TO hzense_ai_admin;
GRANT INSERT (id,connection_id,connection_revision,kind,model_id,fingerprint,status,configuration,reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,created_at,finished_at) ON public.ai_probe_runs TO hzense_ai_admin;
GRANT UPDATE (status,reserved_microusd,charged_microusd,input_tokens,output_tokens,result,error_code,finished_at) ON public.ai_probe_runs TO hzense_ai_admin;
COMMIT;
