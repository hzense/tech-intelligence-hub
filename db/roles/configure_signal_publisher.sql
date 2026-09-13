-- Explicit opt-in provisioning, never run from web startup or a migration.
-- Run as authenticated database/migration owner after exact schema verification.
-- An administrator must pre-create an EMPTY LOGIN NOINHERIT CONNECTION LIMIT 2
-- hzense_publisher role. This deliberately refuses existing ACLs instead of
-- silently repairing/overwriting them. No role, password or PUBLIC changes.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $publisher$
DECLARE target pg_roles%ROWTYPE; database_owner oid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  SELECT datdba INTO database_owner FROM pg_database WHERE datname=current_database();
  IF session_user<>current_user OR pg_get_userbyid(database_owner)<>current_user THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname='hzense_publisher';
  IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN
    RAISE EXCEPTION 'Pre-create a restricted hzense_publisher LOGIN NOINHERIT CONNECTION LIMIT 2';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=target.oid OR roleid=target.oid)
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN
    RAISE EXCEPTION 'Publisher must have no ownership, memberships, settings or existing direct ACLs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0012_current_signal_publication.sql') THEN
    RAISE EXCEPTION 'Verify migration 0012 before publisher provisioning';
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
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_publisher',current_database());
END;
$publisher$;
GRANT USAGE ON SCHEMA public TO hzense_publisher;
GRANT USAGE ON TYPE public.signal_type, public.signal_status TO hzense_publisher;
GRANT SELECT ON public.sources,public.entities,public.topics,public.person_profiles,public.organization_profiles,
  public.signals,public.public_source_evidence,public.signal_versions,public.signal_version_evidence,
  public.signal_version_people,public.signal_version_organizations,public.signal_version_topics,public.signal_event_identities,
  public.signal_publication_control,public.signal_publication_tasks,public.signal_publication_authorizations,public.signal_publication_runs,
  public.signal_publication_state,public.signal_publication_outbox,public.signal_qualified_publication_receipts,
  public.signal_candidate_verifications,public.signal_candidate_assembly_receipts,public.signal_verification_dependency_seals,
  public.signal_publication_permits,public.hzense_schema_migrations,public.current_public_signals TO hzense_publisher;
GRANT INSERT (signal_id,version,schema_version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash) ON public.signal_versions TO hzense_publisher;
GRANT INSERT (signal_id,version,evidence_id,claim,relation) ON public.signal_version_evidence TO hzense_publisher;
GRANT INSERT (signal_id,version,person_id,evidence_id,event_role,verification_status) ON public.signal_version_people TO hzense_publisher;
GRANT INSERT (signal_id,version,organization_id,evidence_id,event_role,verification_status) ON public.signal_version_organizations TO hzense_publisher;
GRANT INSERT (signal_id,version,topic_id) ON public.signal_version_topics TO hzense_publisher;
GRANT INSERT (event_id,request_key,request_fingerprint,signal_id,expected_revision,publication_revision,content_version,status,reason_code,occurred_at) ON public.signal_publication_outbox TO hzense_publisher;
GRANT INSERT (signal_id,publication_revision,content_version,status,event_id,occurred_at) ON public.signal_publication_state TO hzense_publisher;
GRANT UPDATE (publication_revision,content_version,status,event_id,occurred_at) ON public.signal_publication_state TO hzense_publisher;
GRANT INSERT (request_key,request_fingerprint,signal_id,source_version,target_version,run_id,lease_owner,fencing_token) ON public.signal_qualified_publication_receipts TO hzense_publisher;
GRANT INSERT (event_id,verification_id,dependency_seal) ON public.signal_publication_permits TO hzense_publisher;
GRANT EXECUTE ON FUNCTION public.hzense_lock_publication_controls(uuid),public.hzense_lock_publication_dependencies(text,integer),public.hzense_public_signal_is_current(uuid) TO hzense_publisher;
COMMIT;
