-- Opt-in reviewed provisioning, never run by application startup or migration.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $guard$
DECLARE target pg_roles%ROWTYPE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user<>current_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Database owner required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0025_editorial_signal_publication.sql') THEN RAISE EXCEPTION 'Verify migration 0025 first'; END IF;
  FOR target IN SELECT * FROM pg_roles WHERE rolname IN ('hzense_editorial_writer','hzense_editorial_reader') LOOP
    IF NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2 OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN RAISE EXCEPTION 'Restricted editorial role required'; END IF;
    IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=target.oid) OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid) OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Role must be empty'; END IF;
    IF has_database_privilege(target.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(target.oid,oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient capabilities'; END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),target.rolname);
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('hzense_editorial_writer','hzense_editorial_reader'))<>2 THEN RAISE EXCEPTION 'Both pre-created editorial roles required'; END IF;
END;
$guard$;
GRANT USAGE ON SCHEMA public TO hzense_editorial_writer,hzense_editorial_reader;
GRANT SELECT(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at),
  INSERT(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at)
  ON public.editorial_signal_revisions TO hzense_editorial_writer;
GRANT SELECT(id,owner_id,status,deleted_at) ON public.signal_generation_runs TO hzense_editorial_writer;
GRANT SELECT(id,title,runtime_enabled,status) ON public.topics TO hzense_editorial_writer;
GRANT SELECT ON public.editorial_public_signals TO hzense_editorial_reader;
COMMIT;
