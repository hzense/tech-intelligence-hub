-- GENERATED from candidate-pipeline-role.mjs; opt-in manual maintenance only.
-- Pre-create all three EMPTY LOGIN NOINHERIT CONNECTION LIMIT 2 roles.
-- Only Neon's cloud_admin -> neondb_owner ADMIN-only management edge is accepted;
-- no INHERIT/SET, outbound memberships, or other incoming members are allowed.
-- No credentials, role creation, task authorization, safety-switch changes or production execution.
-- Strictly refuses ambient application/table/column/function permissions rather than repairing PUBLIC.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $owner$
BEGIN
 IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
 IF current_user<>session_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0021_candidate_review_attestations.sql') THEN RAISE EXCEPTION 'Verify migration 0021 first'; END IF;
END;
$owner$;
DO $empty$
DECLARE t pg_catalog.pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO t FROM pg_catalog.pg_roles WHERE rolname='hzense_candidate_assembler';
 IF NOT FOUND OR NOT t.rolcanlogin OR t.rolconnlimit<>2 OR t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Pre-create an empty restricted hzense_candidate_assembler'; END IF;
 IF has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(t.oid,n.oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient database/schema grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE has_table_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN RAISE EXCEPTION 'Ambient application data grants are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_candidate_assembler', current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO hzense_candidate_assembler;
GRANT SELECT ON public.sources TO hzense_candidate_assembler;
GRANT SELECT ON public.entities TO hzense_candidate_assembler;
GRANT SELECT ON public.topics TO hzense_candidate_assembler;
GRANT SELECT ON public.person_profiles TO hzense_candidate_assembler;
GRANT SELECT ON public.organization_profiles TO hzense_candidate_assembler;
GRANT SELECT ON public.signals TO hzense_candidate_assembler;
GRANT SELECT ON public.public_source_evidence TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_versions TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_version_evidence TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_version_people TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_version_organizations TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_version_topics TO hzense_candidate_assembler;
GRANT SELECT ON public.signal_event_identities TO hzense_candidate_assembler;
GRANT SELECT ON public.hzense_schema_migrations TO hzense_candidate_assembler;
GRANT SELECT ON public.candidate_reviews TO hzense_candidate_assembler;
GRANT SELECT ON public.candidate_review_conversions TO hzense_candidate_assembler;
GRANT SELECT (id,owner_id,status,deleted_at,snapshot,source_hash,result) ON public.signal_generation_runs TO hzense_candidate_assembler;
GRANT INSERT (id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty,metadata) ON public.signals TO hzense_candidate_assembler;
GRANT INSERT (signal_id,version,schema_version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash) ON public.signal_versions TO hzense_candidate_assembler;
GRANT INSERT (signal_id,version,evidence_id,claim,relation) ON public.signal_version_evidence TO hzense_candidate_assembler;
GRANT INSERT (signal_id,version,person_id,evidence_id,event_role) ON public.signal_version_people TO hzense_candidate_assembler;
GRANT INSERT (signal_id,version,organization_id,evidence_id,event_role) ON public.signal_version_organizations TO hzense_candidate_assembler;
GRANT INSERT (signal_id,version,topic_id) ON public.signal_version_topics TO hzense_candidate_assembler;
GRANT INSERT (signal_id,event_key,basis_version,basis_evidence_id,identity_basis) ON public.signal_event_identities TO hzense_candidate_assembler;
GRANT INSERT (request_key,review_id,owner_id,signal_id,source_version) ON public.candidate_review_conversions TO hzense_candidate_assembler;
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (WITH target AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='hzense_candidate_assembler'),
  plan AS (SELECT '{"select":["sources","entities","topics","person_profiles","organization_profiles","signals","public_source_evidence","signal_versions","signal_version_evidence","signal_version_people","signal_version_organizations","signal_version_topics","signal_event_identities","hzense_schema_migrations","candidate_reviews","candidate_review_conversions"],"readColumns":{"signal_generation_runs":["id","owner_id","status","deleted_at","snapshot","source_hash","result"]},"insert":{"signals":["id","title","type","occurred_at","captured_at","source_id","source_url","summary","importance","strength","confidence","novelty","metadata"],"signal_versions":["signal_id","version","schema_version","title","type","occurred_at","date_precision","date_basis","captured_at","summary","analysis","importance","strength","confidence","novelty","revision_reason","origin","legacy_status","content_hash"],"signal_version_evidence":["signal_id","version","evidence_id","claim","relation"],"signal_version_people":["signal_id","version","person_id","evidence_id","event_role"],"signal_version_organizations":["signal_id","version","organization_id","evidence_id","event_role"],"signal_version_topics":["signal_id","version","topic_id"],"signal_event_identities":["signal_id","event_key","basis_version","basis_evidence_id","identity_basis"],"candidate_review_conversions":["request_key","review_id","owner_id","signal_id","source_version"]},"update":{},"functions":[]}'::jsonb AS acl),
  relations AS (SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S'))
  SELECT COALESCE((SELECT

    t.rolcanlogin AND t.rolconnlimit=2 AND NOT (t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype='o')
    AND has_database_privilege(t.oid,current_database(),'CONNECT')
    AND NOT has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION')
    AND has_schema_privilege(t.oid,'public','USAGE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(t.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION') OR (n.nspname<>'public' AND has_schema_privilege(t.oid,n.oid,'USAGE'))))
    AND NOT EXISTS(SELECT 1 FROM (
      SELECT jsonb_array_elements_text(p.acl->'select') AS name UNION SELECT jsonb_object_keys(p.acl->'readColumns')
      UNION SELECT jsonb_object_keys(p.acl->'insert') UNION SELECT jsonb_object_keys(p.acl->'update')) e
      WHERE to_regclass('public.'||e.name) IS NULL)
    AND NOT EXISTS(SELECT 1 FROM (SELECT 'readColumns' AS kind UNION ALL SELECT 'insert' UNION ALL SELECT 'update') k
      CROSS JOIN LATERAL jsonb_each(p.acl->k.kind) tab CROSS JOIN LATERAL jsonb_array_elements_text(tab.value) col
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||tab.key) AND a.attname=col.value AND a.attnum>0 AND NOT a.attisdropped))
    AND NOT EXISTS(SELECT 1 FROM relations c CROSS JOIN LATERAL aclexplode(acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)) priv
      WHERE CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,priv.privilege_type)
      ELSE has_table_privilege(t.oid,c.oid,priv.privilege_type) IS DISTINCT FROM (c.nspname='public' AND c.relkind IN ('r','v') AND priv.privilege_type='SELECT' AND (p.acl->'select')?c.relname::text)
        OR has_table_privilege(t.oid,c.oid,priv.privilege_type||' WITH GRANT OPTION') END)
    AND NOT EXISTS(SELECT 1 FROM relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name)
      WHERE c.relkind<>'S' AND a.attnum>0 AND NOT a.attisdropped AND (
      has_column_privilege(t.oid,c.oid,a.attnum,priv.name) IS DISTINCT FROM COALESCE(c.nspname='public' AND c.relkind IN ('r','v') AND CASE priv.name
        WHEN 'SELECT' THEN (p.acl->'select')?c.relname::text OR (p.acl->'readColumns'->c.relname::text)?a.attname::text
        WHEN 'INSERT' THEN (p.acl->'insert'->c.relname::text)?a.attname::text
        WHEN 'UPDATE' THEN (p.acl->'update'->c.relname::text)?a.attname::text ELSE false END,false)
      OR has_column_privilege(t.oid,c.oid,a.attnum,priv.name||' WITH GRANT OPTION')))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') f WHERE to_regprocedure(f.value) IS NULL OR NOT has_function_privilege(t.oid,to_regprocedure(f.value),'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
        has_function_privilege(t.oid,f.oid,'EXECUTE WITH GRANT OPTION') OR (
        has_function_privilege(t.oid,f.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') allowed WHERE to_regprocedure(allowed.value)=f.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid AND d.deptype='e'))))

    FROM target t CROSS JOIN plan p),false) AS safe) audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'hzense_candidate_assembler effective ACL contract mismatch'; END IF;
END;
$verify$;
DO $empty$
DECLARE t pg_catalog.pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO t FROM pg_catalog.pg_roles WHERE rolname='hzense_candidate_verifier';
 IF NOT FOUND OR NOT t.rolcanlogin OR t.rolconnlimit<>2 OR t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Pre-create an empty restricted hzense_candidate_verifier'; END IF;
 IF has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(t.oid,n.oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient database/schema grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE has_table_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN RAISE EXCEPTION 'Ambient application data grants are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_candidate_verifier', current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO hzense_candidate_verifier;
GRANT SELECT ON public.sources TO hzense_candidate_verifier;
GRANT SELECT ON public.entities TO hzense_candidate_verifier;
GRANT SELECT ON public.topics TO hzense_candidate_verifier;
GRANT SELECT ON public.person_profiles TO hzense_candidate_verifier;
GRANT SELECT ON public.organization_profiles TO hzense_candidate_verifier;
GRANT SELECT ON public.signals TO hzense_candidate_verifier;
GRANT SELECT ON public.public_source_evidence TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_versions TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_version_evidence TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_version_people TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_version_organizations TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_version_topics TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_event_identities TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_candidate_verifications TO hzense_candidate_verifier;
GRANT SELECT ON public.signal_candidate_assembly_receipts TO hzense_candidate_verifier;
GRANT SELECT ON public.candidate_review_attestations TO hzense_candidate_verifier;
GRANT INSERT (signal_id,version,schema_version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash) ON public.signal_versions TO hzense_candidate_verifier;
GRANT INSERT (signal_id,version,evidence_id,claim,relation) ON public.signal_version_evidence TO hzense_candidate_verifier;
GRANT INSERT (signal_id,version,person_id,evidence_id,event_role,verification_status) ON public.signal_version_people TO hzense_candidate_verifier;
GRANT INSERT (signal_id,version,organization_id,evidence_id,event_role,verification_status) ON public.signal_version_organizations TO hzense_candidate_verifier;
GRANT INSERT (signal_id,version,topic_id) ON public.signal_version_topics TO hzense_candidate_verifier;
GRANT INSERT (verification_id,signal_id,source_version,source_content_hash,bundle_fingerprint,verifier_id,policy_version,report_hash,decision,checks,verified_at,expires_at) ON public.signal_candidate_verifications TO hzense_candidate_verifier;
GRANT INSERT (request_key,request_fingerprint,verification_id,signal_id,source_version,target_version,content_hash) ON public.signal_candidate_assembly_receipts TO hzense_candidate_verifier;
GRANT INSERT (verification_id,review_id,owner_id,key_id,payload,signature) ON public.candidate_review_attestations TO hzense_candidate_verifier;
GRANT UPDATE (verification_id) ON public.signal_candidate_verifications TO hzense_candidate_verifier;
GRANT EXECUTE ON FUNCTION public.hzense_lock_publication_dependencies(text,integer) TO hzense_candidate_verifier;
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (WITH target AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='hzense_candidate_verifier'),
  plan AS (SELECT '{"select":["sources","entities","topics","person_profiles","organization_profiles","signals","public_source_evidence","signal_versions","signal_version_evidence","signal_version_people","signal_version_organizations","signal_version_topics","signal_event_identities","signal_candidate_verifications","signal_candidate_assembly_receipts","candidate_review_attestations"],"readColumns":{},"insert":{"signal_versions":["signal_id","version","schema_version","title","type","occurred_at","date_precision","date_basis","captured_at","summary","analysis","importance","strength","confidence","novelty","revision_reason","origin","legacy_status","content_hash"],"signal_version_evidence":["signal_id","version","evidence_id","claim","relation"],"signal_version_people":["signal_id","version","person_id","evidence_id","event_role","verification_status"],"signal_version_organizations":["signal_id","version","organization_id","evidence_id","event_role","verification_status"],"signal_version_topics":["signal_id","version","topic_id"],"signal_candidate_verifications":["verification_id","signal_id","source_version","source_content_hash","bundle_fingerprint","verifier_id","policy_version","report_hash","decision","checks","verified_at","expires_at"],"signal_candidate_assembly_receipts":["request_key","request_fingerprint","verification_id","signal_id","source_version","target_version","content_hash"],"candidate_review_attestations":["verification_id","review_id","owner_id","key_id","payload","signature"]},"update":{"signal_candidate_verifications":["verification_id"]},"functions":["public.hzense_lock_publication_dependencies(text,integer)"]}'::jsonb AS acl),
  relations AS (SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S'))
  SELECT COALESCE((SELECT

    t.rolcanlogin AND t.rolconnlimit=2 AND NOT (t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype='o')
    AND has_database_privilege(t.oid,current_database(),'CONNECT')
    AND NOT has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION')
    AND has_schema_privilege(t.oid,'public','USAGE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(t.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION') OR (n.nspname<>'public' AND has_schema_privilege(t.oid,n.oid,'USAGE'))))
    AND NOT EXISTS(SELECT 1 FROM (
      SELECT jsonb_array_elements_text(p.acl->'select') AS name UNION SELECT jsonb_object_keys(p.acl->'readColumns')
      UNION SELECT jsonb_object_keys(p.acl->'insert') UNION SELECT jsonb_object_keys(p.acl->'update')) e
      WHERE to_regclass('public.'||e.name) IS NULL)
    AND NOT EXISTS(SELECT 1 FROM (SELECT 'readColumns' AS kind UNION ALL SELECT 'insert' UNION ALL SELECT 'update') k
      CROSS JOIN LATERAL jsonb_each(p.acl->k.kind) tab CROSS JOIN LATERAL jsonb_array_elements_text(tab.value) col
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||tab.key) AND a.attname=col.value AND a.attnum>0 AND NOT a.attisdropped))
    AND NOT EXISTS(SELECT 1 FROM relations c CROSS JOIN LATERAL aclexplode(acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)) priv
      WHERE CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,priv.privilege_type)
      ELSE has_table_privilege(t.oid,c.oid,priv.privilege_type) IS DISTINCT FROM (c.nspname='public' AND c.relkind IN ('r','v') AND priv.privilege_type='SELECT' AND (p.acl->'select')?c.relname::text)
        OR has_table_privilege(t.oid,c.oid,priv.privilege_type||' WITH GRANT OPTION') END)
    AND NOT EXISTS(SELECT 1 FROM relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name)
      WHERE c.relkind<>'S' AND a.attnum>0 AND NOT a.attisdropped AND (
      has_column_privilege(t.oid,c.oid,a.attnum,priv.name) IS DISTINCT FROM COALESCE(c.nspname='public' AND c.relkind IN ('r','v') AND CASE priv.name
        WHEN 'SELECT' THEN (p.acl->'select')?c.relname::text OR (p.acl->'readColumns'->c.relname::text)?a.attname::text
        WHEN 'INSERT' THEN (p.acl->'insert'->c.relname::text)?a.attname::text
        WHEN 'UPDATE' THEN (p.acl->'update'->c.relname::text)?a.attname::text ELSE false END,false)
      OR has_column_privilege(t.oid,c.oid,a.attnum,priv.name||' WITH GRANT OPTION')))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') f WHERE to_regprocedure(f.value) IS NULL OR NOT has_function_privilege(t.oid,to_regprocedure(f.value),'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
        has_function_privilege(t.oid,f.oid,'EXECUTE WITH GRANT OPTION') OR (
        has_function_privilege(t.oid,f.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') allowed WHERE to_regprocedure(allowed.value)=f.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid AND d.deptype='e'))))
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc f ON f.oid=g.tgfoid
      WHERE g.tgrelid='public.signal_candidate_verifications'::regclass AND g.tgname='signal_candidate_verifications_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=31 AND g.tgnargs=0 AND g.tgqual IS NULL AND NOT g.tgisinternal
      AND f.oid='public.hzense_guard_candidate_verification()'::regprocedure AND NOT f.prosecdef
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \t\n\r\v\f'),'UTF8')),'hex')='a0ad241633a4ef614a26924d35394e04bd96b95d8e971ae4ba964b651c81be22')
    FROM target t CROSS JOIN plan p),false) AS safe) audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'hzense_candidate_verifier effective ACL contract mismatch'; END IF;
END;
$verify$;
DO $empty$
DECLARE t pg_catalog.pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO t FROM pg_catalog.pg_roles WHERE rolname='hzense_publication_controller';
 IF NOT FOUND OR NOT t.rolcanlogin OR t.rolconnlimit<>2 OR t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Pre-create an empty restricted hzense_publication_controller'; END IF;
 IF has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(t.oid,n.oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient database/schema grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE has_table_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN RAISE EXCEPTION 'Ambient application data grants are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_publication_controller', current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO hzense_publication_controller;
GRANT SELECT ON public.signal_publication_runs TO hzense_publication_controller;
GRANT SELECT ON public.signal_publication_tasks TO hzense_publication_controller;
GRANT SELECT ON public.signal_publication_control TO hzense_publication_controller;
GRANT SELECT ON public.signal_publication_authorizations TO hzense_publication_controller;
GRANT INSERT (run_id,task_id,principal_id,original_intent) ON public.signal_publication_runs TO hzense_publication_controller;
GRANT UPDATE (status,fencing_token,lease_owner,lease_expires_at) ON public.signal_publication_runs TO hzense_publication_controller;
GRANT EXECUTE ON FUNCTION public.hzense_lock_candidate_publication_task(uuid,uuid) TO hzense_publication_controller;
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (WITH target AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='hzense_publication_controller'),
  plan AS (SELECT '{"select":["signal_publication_runs","signal_publication_tasks","signal_publication_control","signal_publication_authorizations"],"readColumns":{},"insert":{"signal_publication_runs":["run_id","task_id","principal_id","original_intent"]},"update":{"signal_publication_runs":["status","fencing_token","lease_owner","lease_expires_at"]},"functions":["public.hzense_lock_candidate_publication_task(uuid,uuid)"]}'::jsonb AS acl),
  relations AS (SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S'))
  SELECT COALESCE((SELECT

    t.rolcanlogin AND t.rolconnlimit=2 AND NOT (t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype='o')
    AND has_database_privilege(t.oid,current_database(),'CONNECT')
    AND NOT has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION')
    AND has_schema_privilege(t.oid,'public','USAGE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(t.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION') OR (n.nspname<>'public' AND has_schema_privilege(t.oid,n.oid,'USAGE'))))
    AND NOT EXISTS(SELECT 1 FROM (
      SELECT jsonb_array_elements_text(p.acl->'select') AS name UNION SELECT jsonb_object_keys(p.acl->'readColumns')
      UNION SELECT jsonb_object_keys(p.acl->'insert') UNION SELECT jsonb_object_keys(p.acl->'update')) e
      WHERE to_regclass('public.'||e.name) IS NULL)
    AND NOT EXISTS(SELECT 1 FROM (SELECT 'readColumns' AS kind UNION ALL SELECT 'insert' UNION ALL SELECT 'update') k
      CROSS JOIN LATERAL jsonb_each(p.acl->k.kind) tab CROSS JOIN LATERAL jsonb_array_elements_text(tab.value) col
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||tab.key) AND a.attname=col.value AND a.attnum>0 AND NOT a.attisdropped))
    AND NOT EXISTS(SELECT 1 FROM relations c CROSS JOIN LATERAL aclexplode(acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)) priv
      WHERE CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,priv.privilege_type)
      ELSE has_table_privilege(t.oid,c.oid,priv.privilege_type) IS DISTINCT FROM (c.nspname='public' AND c.relkind IN ('r','v') AND priv.privilege_type='SELECT' AND (p.acl->'select')?c.relname::text)
        OR has_table_privilege(t.oid,c.oid,priv.privilege_type||' WITH GRANT OPTION') END)
    AND NOT EXISTS(SELECT 1 FROM relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name)
      WHERE c.relkind<>'S' AND a.attnum>0 AND NOT a.attisdropped AND (
      has_column_privilege(t.oid,c.oid,a.attnum,priv.name) IS DISTINCT FROM COALESCE(c.nspname='public' AND c.relkind IN ('r','v') AND CASE priv.name
        WHEN 'SELECT' THEN (p.acl->'select')?c.relname::text OR (p.acl->'readColumns'->c.relname::text)?a.attname::text
        WHEN 'INSERT' THEN (p.acl->'insert'->c.relname::text)?a.attname::text
        WHEN 'UPDATE' THEN (p.acl->'update'->c.relname::text)?a.attname::text ELSE false END,false)
      OR has_column_privilege(t.oid,c.oid,a.attnum,priv.name||' WITH GRANT OPTION')))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') f WHERE to_regprocedure(f.value) IS NULL OR NOT has_function_privilege(t.oid,to_regprocedure(f.value),'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
        has_function_privilege(t.oid,f.oid,'EXECUTE WITH GRANT OPTION') OR (
        has_function_privilege(t.oid,f.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') allowed WHERE to_regprocedure(allowed.value)=f.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid AND d.deptype='e'))))

    FROM target t CROSS JOIN plan p),false) AS safe) audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'hzense_publication_controller effective ACL contract mismatch'; END IF;
END;
$verify$;
COMMIT;
