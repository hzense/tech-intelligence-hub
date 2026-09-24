-- Generated from material-registration-role.mjs. Manual reviewed maintenance only.
-- Pre-create EMPTY restricted roles. This script never creates or prints credentials.
-- Requires applied migration 0023; no existing reader/reviewer roles are changed.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='20s';
DO $owner$
BEGIN
 IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
 IF current_user<>session_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0023_candidate_materials.sql') THEN RAISE EXCEPTION 'Verify migration 0023 first'; END IF;
END;
$owner$;
DO $empty$
DECLARE target pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO target FROM pg_roles WHERE rolname='hzense_material_registrar';
 IF NOT FOUND OR NOT target.rolcanlogin OR target.rolconnlimit<>2 OR target.rolconfig IS NOT NULL
   OR target.rolsuper OR target.rolinherit OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
   OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
     AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
       AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
   OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
   OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a'))
 THEN RAISE EXCEPTION 'Pre-create an empty restricted hzense_material_registrar'; END IF;
 IF has_database_privilege(target.oid,current_database(),'CREATE,TEMPORARY')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(target.oid,oid,'CREATE'))
 THEN RAISE EXCEPTION 'Unsafe ambient database/schema privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
   AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'SELECT,UPDATE,USAGE')
     ELSE has_table_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END)
 THEN RAISE EXCEPTION 'Ambient application data privileges are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_material_registrar',current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO hzense_material_registrar;
GRANT EXECUTE ON FUNCTION public.hzense_lock_material_dependencies(uuid,text) TO hzense_material_registrar;
GRANT SELECT (id,owner_id,run_id,candidate_index,base_material_hash,bundle_hash,fingerprint,bundle,created_at) ON public.candidate_material_requests TO hzense_material_registrar;
GRANT INSERT (id,owner_id,run_id,candidate_index,base_material_hash,bundle_hash,fingerprint,bundle) ON public.candidate_material_requests TO hzense_material_registrar;
GRANT SELECT (id,request_id,owner_id,plan_hash,plan,attestation,received_at) ON public.candidate_material_reports TO hzense_material_registrar;
GRANT SELECT (id,request_id,report_id,owner_id,plan_hash,stage,created_at) ON public.candidate_material_receipts TO hzense_material_registrar;
GRANT INSERT (id,request_id,report_id,owner_id,plan_hash,stage) ON public.candidate_material_receipts TO hzense_material_registrar;
GRANT SELECT (id,owner_id,status,deleted_at,snapshot,source_hash,result) ON public.signal_generation_runs TO hzense_material_registrar;
GRANT SELECT (id,type,name,status,aliases,metadata,created_at,updated_at) ON public.entities TO hzense_material_registrar;
GRANT INSERT (id,type,name,status,aliases) ON public.entities TO hzense_material_registrar;
GRANT SELECT (id,name,type,url,trust_score,active,allowed_hosts) ON public.sources TO hzense_material_registrar;
GRANT INSERT (id,name,type,url,trust_score,active,allowed_hosts) ON public.sources TO hzense_material_registrar;
GRANT SELECT (id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status) ON public.public_source_evidence TO hzense_material_registrar;
GRANT INSERT (id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at) ON public.public_source_evidence TO hzense_material_registrar;
GRANT SELECT (entity_id,entity_type) ON public.person_profiles TO hzense_material_registrar;
GRANT INSERT (entity_id,entity_type) ON public.person_profiles TO hzense_material_registrar;
GRANT SELECT (entity_id,entity_type) ON public.organization_profiles TO hzense_material_registrar;
GRANT INSERT (entity_id,entity_type) ON public.organization_profiles TO hzense_material_registrar;
GRANT SELECT (id,title,status,runtime_enabled) ON public.topics TO hzense_material_registrar;
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (WITH allowed(table_name,column_name,privilege) AS (VALUES ('candidate_material_requests','id','SELECT'),('candidate_material_requests','owner_id','SELECT'),('candidate_material_requests','run_id','SELECT'),('candidate_material_requests','candidate_index','SELECT'),('candidate_material_requests','base_material_hash','SELECT'),('candidate_material_requests','bundle_hash','SELECT'),('candidate_material_requests','fingerprint','SELECT'),('candidate_material_requests','bundle','SELECT'),('candidate_material_requests','created_at','SELECT'),('candidate_material_requests','id','INSERT'),('candidate_material_requests','owner_id','INSERT'),('candidate_material_requests','run_id','INSERT'),('candidate_material_requests','candidate_index','INSERT'),('candidate_material_requests','base_material_hash','INSERT'),('candidate_material_requests','bundle_hash','INSERT'),('candidate_material_requests','fingerprint','INSERT'),('candidate_material_requests','bundle','INSERT'),('candidate_material_reports','id','SELECT'),('candidate_material_reports','request_id','SELECT'),('candidate_material_reports','owner_id','SELECT'),('candidate_material_reports','plan_hash','SELECT'),('candidate_material_reports','plan','SELECT'),('candidate_material_reports','attestation','SELECT'),('candidate_material_reports','received_at','SELECT'),('candidate_material_receipts','id','SELECT'),('candidate_material_receipts','request_id','SELECT'),('candidate_material_receipts','report_id','SELECT'),('candidate_material_receipts','owner_id','SELECT'),('candidate_material_receipts','plan_hash','SELECT'),('candidate_material_receipts','stage','SELECT'),('candidate_material_receipts','created_at','SELECT'),('candidate_material_receipts','id','INSERT'),('candidate_material_receipts','request_id','INSERT'),('candidate_material_receipts','report_id','INSERT'),('candidate_material_receipts','owner_id','INSERT'),('candidate_material_receipts','plan_hash','INSERT'),('candidate_material_receipts','stage','INSERT'),('signal_generation_runs','id','SELECT'),('signal_generation_runs','owner_id','SELECT'),('signal_generation_runs','status','SELECT'),('signal_generation_runs','deleted_at','SELECT'),('signal_generation_runs','snapshot','SELECT'),('signal_generation_runs','source_hash','SELECT'),('signal_generation_runs','result','SELECT'),('entities','id','SELECT'),('entities','type','SELECT'),('entities','name','SELECT'),('entities','status','SELECT'),('entities','aliases','SELECT'),('entities','metadata','SELECT'),('entities','created_at','SELECT'),('entities','updated_at','SELECT'),('entities','id','INSERT'),('entities','type','INSERT'),('entities','name','INSERT'),('entities','status','INSERT'),('entities','aliases','INSERT'),('sources','id','SELECT'),('sources','name','SELECT'),('sources','type','SELECT'),('sources','url','SELECT'),('sources','trust_score','SELECT'),('sources','active','SELECT'),('sources','allowed_hosts','SELECT'),('sources','id','INSERT'),('sources','name','INSERT'),('sources','type','INSERT'),('sources','url','INSERT'),('sources','trust_score','INSERT'),('sources','active','INSERT'),('sources','allowed_hosts','INSERT'),('public_source_evidence','id','SELECT'),('public_source_evidence','source_id','SELECT'),('public_source_evidence','source_url','SELECT'),('public_source_evidence','locator','SELECT'),('public_source_evidence','excerpt','SELECT'),('public_source_evidence','content_hash','SELECT'),('public_source_evidence','captured_at','SELECT'),('public_source_evidence','source_published_at','SELECT'),('public_source_evidence','verification_status','SELECT'),('public_source_evidence','id','INSERT'),('public_source_evidence','source_id','INSERT'),('public_source_evidence','source_url','INSERT'),('public_source_evidence','locator','INSERT'),('public_source_evidence','excerpt','INSERT'),('public_source_evidence','content_hash','INSERT'),('public_source_evidence','captured_at','INSERT'),('public_source_evidence','source_published_at','INSERT'),('person_profiles','entity_id','SELECT'),('person_profiles','entity_type','SELECT'),('person_profiles','entity_id','INSERT'),('person_profiles','entity_type','INSERT'),('organization_profiles','entity_id','SELECT'),('organization_profiles','entity_type','SELECT'),('organization_profiles','entity_id','INSERT'),('organization_profiles','entity_type','INSERT'),('topics','id','SELECT'),('topics','title','SELECT'),('topics','status','SELECT'),('topics','runtime_enabled','SELECT'))
  SELECT true
  AND r.rolcanlogin AND r.rolconnlimit=2 AND r.rolconfig IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
    AND (m.roleid=r.oid AND pg_get_userbyid(m.member)='neondb_owner'
      AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
  AND NOT has_database_privilege(r.oid,current_database(),'CREATE,TEMPORARY')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(r.oid,oid,'CREATE'))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND (
      c.relowner=r.oid OR EXISTS(SELECT 1 FROM aclexplode(acldefault('r',c.relowner)) p
        WHERE has_table_privilege(r.oid,c.oid,p.privilege_type))))
  AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND (has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) IS DISTINCT FROM EXISTS(
      SELECT 1 FROM allowed e WHERE n.nspname='public' AND c.relkind='r' AND e.table_name=c.relname AND e.column_name=a.attname AND e.privilege=p.privilege)
      OR has_column_privilege(r.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION')))
  AND NOT EXISTS(SELECT 1 FROM allowed e WHERE NOT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname=e.table_name AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(r.oid,c.oid,a.attnum,e.privilege)))
  AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (c.relowner=r.oid OR has_sequence_privilege(r.oid,c.oid,'SELECT,UPDATE,USAGE')))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND p.oid<>to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AND has_database_privilege(r.oid,current_database(),'CONNECT')
  AND NOT has_database_privilege(r.oid,current_database(),'CONNECT WITH GRANT OPTION')
  AND has_schema_privilege(r.oid,'public','USAGE')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'
    AND (has_schema_privilege(r.oid,oid,'USAGE WITH GRANT OPTION') OR (nspname<>'public' AND has_schema_privilege(r.oid,oid,'USAGE'))))
  AND NOT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')
  AND has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE')
  AND NOT has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE WITH GRANT OPTION')
  AND EXISTS(SELECT 1 FROM pg_proc f
    WHERE f.oid=to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')
      AND f.prosecdef AND f.prorettype='pg_catalog.void'::regtype AND f.provolatile='v' AND NOT f.proleakproof
      AND f.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND f.proowner=(SELECT relowner FROM pg_class WHERE oid='public.candidate_material_reports'::regclass)
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='2031433da68f682b63b04c7a4df3acdc909ac4fd48e4b9ae54c0b9a96e355f79')
  AND EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.public_source_evidence'::regclass AND a.attname='verification_status'
      AND pg_get_expr(d.adbin,d.adrelid)='''pending''::text')
  AND EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname='hzense_guard_candidate_material_receipt_insert' AND f.pronargs=0 AND NOT f.prosecdef
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='71fd78e41b3b8c0e874345beb45a72a7083515d014bdc67d3f4d85b5557a7609') AND EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname='hzense_guard_candidate_materials' AND f.pronargs=0 AND NOT f.prosecdef
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='e74a8ee4afa92acfe7da1d783a848b965be602aa070794afd9b342fd0e93693c')
  AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_insert_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=7 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_material_receipt_insert') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_requests' AND g.tgname='candidate_material_requests_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_requests' AND g.tgname='candidate_material_requests_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_reports' AND g.tgname='candidate_material_reports_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_reports' AND g.tgname='candidate_material_reports_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials')
  AS safe
  FROM pg_roles r WHERE r.rolname='hzense_material_registrar') audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'hzense_material_registrar effective ACL or guard mismatch'; END IF;
END;
$verify$;
DO $empty$
DECLARE target pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO target FROM pg_roles WHERE rolname='hzense_material_verifier';
 IF NOT FOUND OR NOT target.rolcanlogin OR target.rolconnlimit<>2 OR target.rolconfig IS NOT NULL
   OR target.rolsuper OR target.rolinherit OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
   OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
     AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
       AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
   OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
   OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a'))
 THEN RAISE EXCEPTION 'Pre-create an empty restricted hzense_material_verifier'; END IF;
 IF has_database_privilege(target.oid,current_database(),'CREATE,TEMPORARY')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(target.oid,oid,'CREATE'))
 THEN RAISE EXCEPTION 'Unsafe ambient database/schema privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
   AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'SELECT,UPDATE,USAGE')
     ELSE has_table_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END)
 THEN RAISE EXCEPTION 'Ambient application data privileges are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_material_verifier',current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO hzense_material_verifier;
GRANT EXECUTE ON FUNCTION public.hzense_lock_material_dependencies(uuid,text) TO hzense_material_verifier;
GRANT SELECT (id,owner_id,run_id,candidate_index,base_material_hash,bundle_hash,fingerprint,bundle,created_at) ON public.candidate_material_requests TO hzense_material_verifier;
GRANT SELECT (id,request_id,owner_id,plan_hash,plan,attestation,received_at) ON public.candidate_material_reports TO hzense_material_verifier;
GRANT INSERT (id,request_id,owner_id,plan_hash,plan,attestation) ON public.candidate_material_reports TO hzense_material_verifier;
GRANT SELECT (id,request_id,report_id,owner_id,plan_hash,stage,created_at) ON public.candidate_material_receipts TO hzense_material_verifier;
GRANT INSERT (id,request_id,report_id,owner_id,plan_hash,stage) ON public.candidate_material_receipts TO hzense_material_verifier;
GRANT SELECT (id,owner_id,status,deleted_at,snapshot,source_hash,result) ON public.signal_generation_runs TO hzense_material_verifier;
GRANT SELECT (id,type,name,status,aliases,metadata,created_at,updated_at) ON public.entities TO hzense_material_verifier;
GRANT SELECT (id,name,type,url,trust_score,active,allowed_hosts) ON public.sources TO hzense_material_verifier;
GRANT SELECT (id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status) ON public.public_source_evidence TO hzense_material_verifier;
GRANT UPDATE (verification_status) ON public.public_source_evidence TO hzense_material_verifier;
GRANT SELECT (entity_id,entity_type) ON public.person_profiles TO hzense_material_verifier;
GRANT SELECT (entity_id,entity_type) ON public.organization_profiles TO hzense_material_verifier;
GRANT SELECT (id,title,status,runtime_enabled) ON public.topics TO hzense_material_verifier;
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (WITH allowed(table_name,column_name,privilege) AS (VALUES ('candidate_material_requests','id','SELECT'),('candidate_material_requests','owner_id','SELECT'),('candidate_material_requests','run_id','SELECT'),('candidate_material_requests','candidate_index','SELECT'),('candidate_material_requests','base_material_hash','SELECT'),('candidate_material_requests','bundle_hash','SELECT'),('candidate_material_requests','fingerprint','SELECT'),('candidate_material_requests','bundle','SELECT'),('candidate_material_requests','created_at','SELECT'),('candidate_material_reports','id','SELECT'),('candidate_material_reports','request_id','SELECT'),('candidate_material_reports','owner_id','SELECT'),('candidate_material_reports','plan_hash','SELECT'),('candidate_material_reports','plan','SELECT'),('candidate_material_reports','attestation','SELECT'),('candidate_material_reports','received_at','SELECT'),('candidate_material_reports','id','INSERT'),('candidate_material_reports','request_id','INSERT'),('candidate_material_reports','owner_id','INSERT'),('candidate_material_reports','plan_hash','INSERT'),('candidate_material_reports','plan','INSERT'),('candidate_material_reports','attestation','INSERT'),('candidate_material_receipts','id','SELECT'),('candidate_material_receipts','request_id','SELECT'),('candidate_material_receipts','report_id','SELECT'),('candidate_material_receipts','owner_id','SELECT'),('candidate_material_receipts','plan_hash','SELECT'),('candidate_material_receipts','stage','SELECT'),('candidate_material_receipts','created_at','SELECT'),('candidate_material_receipts','id','INSERT'),('candidate_material_receipts','request_id','INSERT'),('candidate_material_receipts','report_id','INSERT'),('candidate_material_receipts','owner_id','INSERT'),('candidate_material_receipts','plan_hash','INSERT'),('candidate_material_receipts','stage','INSERT'),('signal_generation_runs','id','SELECT'),('signal_generation_runs','owner_id','SELECT'),('signal_generation_runs','status','SELECT'),('signal_generation_runs','deleted_at','SELECT'),('signal_generation_runs','snapshot','SELECT'),('signal_generation_runs','source_hash','SELECT'),('signal_generation_runs','result','SELECT'),('entities','id','SELECT'),('entities','type','SELECT'),('entities','name','SELECT'),('entities','status','SELECT'),('entities','aliases','SELECT'),('entities','metadata','SELECT'),('entities','created_at','SELECT'),('entities','updated_at','SELECT'),('sources','id','SELECT'),('sources','name','SELECT'),('sources','type','SELECT'),('sources','url','SELECT'),('sources','trust_score','SELECT'),('sources','active','SELECT'),('sources','allowed_hosts','SELECT'),('public_source_evidence','id','SELECT'),('public_source_evidence','source_id','SELECT'),('public_source_evidence','source_url','SELECT'),('public_source_evidence','locator','SELECT'),('public_source_evidence','excerpt','SELECT'),('public_source_evidence','content_hash','SELECT'),('public_source_evidence','captured_at','SELECT'),('public_source_evidence','source_published_at','SELECT'),('public_source_evidence','verification_status','SELECT'),('public_source_evidence','verification_status','UPDATE'),('person_profiles','entity_id','SELECT'),('person_profiles','entity_type','SELECT'),('organization_profiles','entity_id','SELECT'),('organization_profiles','entity_type','SELECT'),('topics','id','SELECT'),('topics','title','SELECT'),('topics','status','SELECT'),('topics','runtime_enabled','SELECT'))
  SELECT true
  AND r.rolcanlogin AND r.rolconnlimit=2 AND r.rolconfig IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
    AND (m.roleid=r.oid AND pg_get_userbyid(m.member)='neondb_owner'
      AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
      AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
  AND NOT has_database_privilege(r.oid,current_database(),'CREATE,TEMPORARY')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(r.oid,oid,'CREATE'))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND (
      c.relowner=r.oid OR EXISTS(SELECT 1 FROM aclexplode(acldefault('r',c.relowner)) p
        WHERE has_table_privilege(r.oid,c.oid,p.privilege_type))))
  AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND (has_column_privilege(r.oid,c.oid,a.attnum,p.privilege) IS DISTINCT FROM EXISTS(
      SELECT 1 FROM allowed e WHERE n.nspname='public' AND c.relkind='r' AND e.table_name=c.relname AND e.column_name=a.attname AND e.privilege=p.privilege)
      OR has_column_privilege(r.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION')))
  AND NOT EXISTS(SELECT 1 FROM allowed e WHERE NOT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname=e.table_name AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(r.oid,c.oid,a.attnum,e.privilege)))
  AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (c.relowner=r.oid OR has_sequence_privilege(r.oid,c.oid,'SELECT,UPDATE,USAGE')))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND p.oid<>to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  AND has_database_privilege(r.oid,current_database(),'CONNECT')
  AND NOT has_database_privilege(r.oid,current_database(),'CONNECT WITH GRANT OPTION')
  AND has_schema_privilege(r.oid,'public','USAGE')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'
    AND (has_schema_privilege(r.oid,oid,'USAGE WITH GRANT OPTION') OR (nspname<>'public' AND has_schema_privilege(r.oid,oid,'USAGE'))))
  AND NOT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')
  AND has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE')
  AND NOT has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE WITH GRANT OPTION')
  AND EXISTS(SELECT 1 FROM pg_proc f
    WHERE f.oid=to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')
      AND f.prosecdef AND f.prorettype='pg_catalog.void'::regtype AND f.provolatile='v' AND NOT f.proleakproof
      AND f.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND f.proowner=(SELECT relowner FROM pg_class WHERE oid='public.candidate_material_reports'::regclass)
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='2031433da68f682b63b04c7a4df3acdc909ac4fd48e4b9ae54c0b9a96e355f79')
  AND EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.public_source_evidence'::regclass AND a.attname='verification_status'
      AND pg_get_expr(d.adbin,d.adrelid)='''pending''::text')
  AND EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname='hzense_guard_candidate_material_receipt_insert' AND f.pronargs=0 AND NOT f.prosecdef
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='71fd78e41b3b8c0e874345beb45a72a7083515d014bdc67d3f4d85b5557a7609') AND EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname='hzense_guard_candidate_materials' AND f.pronargs=0 AND NOT f.prosecdef
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='e74a8ee4afa92acfe7da1d783a848b965be602aa070794afd9b342fd0e93693c')
  AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_insert_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=7 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_material_receipt_insert') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_requests' AND g.tgname='candidate_material_requests_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_requests' AND g.tgname='candidate_material_requests_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_reports' AND g.tgname='candidate_material_reports_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_reports' AND g.tgname='candidate_material_reports_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=27 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials') AND EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='candidate_material_receipts' AND g.tgname='candidate_material_receipts_no_truncate_trg'
      AND g.tgenabled='A' AND g.tgtype=34 AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='hzense_guard_candidate_materials')
  AS safe
  FROM pg_roles r WHERE r.rolname='hzense_material_verifier') audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'hzense_material_verifier effective ACL or guard mismatch'; END IF;
END;
$verify$;
COMMIT;
