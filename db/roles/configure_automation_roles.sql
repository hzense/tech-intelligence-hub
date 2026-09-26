-- Apply manually as the authenticated migration/database owner after a full
-- read-only schema verification. Grants only private scheduling state to the
-- admin role and published, filtered insight DTOs to the public reader role.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
DO $guard$
DECLARE target pg_roles%ROWTYPE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925)
  THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
  THEN RAISE EXCEPTION 'Authenticated migration owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations WHERE name = '0026_automation_tasks.sql')
  THEN RAISE EXCEPTION 'Verified migration 0026 required'; END IF;
  IF to_regclass('public.automation_configs') IS NULL
    OR to_regclass('public.automation_runs') IS NULL
    OR to_regclass('public.published_topic_insights') IS NULL
  THEN RAISE EXCEPTION 'Required automation relations missing'; END IF;
  FOR target IN SELECT * FROM pg_roles WHERE rolname IN ('hzense_automation_admin', 'hzense_insight_reader') LOOP
    IF NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit <> 2 OR target.rolconfig IS NOT NULL
      OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
      OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE (m.member = target.oid OR m.roleid = target.oid)
        AND (m.roleid = target.oid AND pg_get_userbyid(m.member) = 'neondb_owner'
          AND pg_get_userbyid(m.grantor) = 'cloud_admin' AND m.admin_option
          AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
      OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = target.oid)
      OR EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass
        AND refobjid = target.oid AND deptype IN ('o', 'a'))
    THEN RAISE EXCEPTION 'Both roles must be empty, restricted direct logins'; END IF;
    IF has_database_privilege(target.oid, current_database(), 'CREATE,TEMPORARY')
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
        AND has_schema_privilege(target.oid, oid, 'CREATE'))
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(target.oid, c.oid, 'SELECT,UPDATE,USAGE')
            ELSE has_table_privilege(target.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_any_column_privilege(target.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') END)
    THEN RAISE EXCEPTION 'Unsafe ambient privileges'; END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), target.rolname);
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('hzense_automation_admin', 'hzense_insight_reader')) <> 2
  THEN RAISE EXCEPTION 'Both pre-created automation roles required'; END IF;
END;
$guard$;
GRANT USAGE ON SCHEMA public TO hzense_automation_admin, hzense_insight_reader;
GRANT SELECT (id,owner_id,revision,config,enabled,next_run_at,created_at,updated_at),
      INSERT (id,owner_id,revision,config,enabled,next_run_at,created_at,updated_at),
      UPDATE (revision,config,enabled,next_run_at,updated_at)
  ON public.automation_configs TO hzense_automation_admin;
GRANT SELECT (id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,frozen_inputs,error_code,
              lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,cost_source,publication_status,
              published_at,created_at,started_at,finished_at),
      INSERT (id,config_id,owner_id,config_revision,snapshot,slot,trigger,status,phase,result,frozen_inputs,error_code,
              lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,cost_source,publication_status,
              published_at,created_at,started_at,finished_at),
      UPDATE (status,phase,result,frozen_inputs,error_code,lease_token,lease_until,budget_day,reserved_microusd,
              charged_microusd,cost_source,publication_status,published_at,started_at,finished_at)
  ON public.automation_runs TO hzense_automation_admin;
GRANT SELECT (id,result,published_at) ON public.published_topic_insights TO hzense_insight_reader;
COMMIT;
