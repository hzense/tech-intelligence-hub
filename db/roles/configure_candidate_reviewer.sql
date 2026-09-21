-- Opt-in reviewed SQL only; never executed by migration, startup or diagnostics.
-- Pre-create an empty LOGIN NOINHERIT CONNECTION LIMIT 2 role, no credentials here.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $reviewer$
DECLARE target pg_roles%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
 IF session_user<>current_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Database owner required'; END IF;
 SELECT * INTO target FROM pg_roles WHERE rolname='hzense_candidate_reviewer';
 IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2 OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN RAISE EXCEPTION 'Restricted pre-created reviewer required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=target.oid) OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid) OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Role must be empty'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0020_candidate_reviews.sql') OR NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0021_candidate_review_attestations.sql') THEN RAISE EXCEPTION 'Verify migrations 0020 and 0021 first'; END IF;
 IF has_database_privilege(target.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema' AND has_schema_privilege(target.oid,oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient capabilities'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S','p') AND (CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE has_table_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END)) THEN RAISE EXCEPTION 'Role has ambient data access'; END IF;
END;
$reviewer$;
GRANT USAGE ON SCHEMA public TO hzense_candidate_reviewer;
GRANT SELECT(id,request_id,owner_id,run_id,candidate_index,revision,material_hash,fingerprint,decision,note,draft,created_at),INSERT(id,request_id,owner_id,run_id,candidate_index,revision,material_hash,fingerprint,decision,note,draft,created_at) ON public.candidate_reviews TO hzense_candidate_reviewer;
GRANT SELECT(id,owner_id,status,deleted_at,snapshot,source_hash,result) ON public.signal_generation_runs TO hzense_candidate_reviewer;
GRANT SELECT(id,name,type,url,trust_score,active,allowed_hosts) ON public.sources TO hzense_candidate_reviewer;
GRANT SELECT(id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status,created_xid) ON public.public_source_evidence TO hzense_candidate_reviewer;
GRANT SELECT(id,type,name,status,aliases,metadata,created_at,updated_at) ON public.entities TO hzense_candidate_reviewer;
GRANT SELECT(entity_id,entity_type) ON public.person_profiles,public.organization_profiles TO hzense_candidate_reviewer;
GRANT SELECT(id,title,parent_id,status,metadata,runtime_enabled) ON public.topics TO hzense_candidate_reviewer;
-- Conversion receipts and formal Signal writes use a separately approved writer.
COMMIT;
