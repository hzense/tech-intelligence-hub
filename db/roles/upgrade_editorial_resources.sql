-- Reviewed capability-only upgrade. Existing entity metadata is never writable.
-- The protected production maintenance operation separately binds this exact
-- script, current main/CI, target, backup and run-bound approval.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
DO $upgrade$
DECLARE
  target pg_roles%ROWTYPE;
  pass integer;
  resources_granted boolean;
  expected_capabilities text[];
  actual_capabilities text[];
  read_insert_columns jsonb := $columns${
    "editorial_signal_revisions": ["request_id","run_id","owner_id","candidate_index","revision","material_hash","action","content","request_hash","created_at"]
  }$columns$::jsonb;
  read_columns jsonb := $columns${
    "signal_generation_runs": ["id","owner_id","status","deleted_at"],
    "topics": ["id","title","runtime_enabled","status"]
  }$columns$::jsonb;
  resource_columns jsonb := $columns${
    "entities": ["id","name","type","status","aliases"],
    "person_profiles": ["entity_id","entity_type"],
    "organization_profiles": ["entity_id","entity_type"]
  }$columns$::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925)
  THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
  THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations
    WHERE name='0025_editorial_signal_publication.sql'
      AND checksum='d4ce2249d08f675cf0ea4a614790aa5c1cc2e793998a545a76a60f898a97e2ae')
  THEN RAISE EXCEPTION 'Verified migration 0025 required'; END IF;
  IF to_regclass('public.entities') IS NULL OR to_regclass('public.person_profiles') IS NULL
    OR to_regclass('public.organization_profiles') IS NULL
  THEN RAISE EXCEPTION 'Entity profile schema required'; END IF;
  SELECT * INTO STRICT target FROM pg_roles WHERE rolname='hzense_editorial_writer';
  IF NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2 OR target.rolconfig IS NOT NULL
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
    OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
      AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid
      AND (deptype='o' OR (deptype='a' AND (classid NOT IN ('pg_database'::regclass,'pg_namespace'::regclass,'pg_class'::regclass)
        OR dbid NOT IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))))))
  THEN RAISE EXCEPTION 'Restricted editorial writer role required'; END IF;
  IF NOT has_database_privilege(target.oid,current_database(),'CONNECT')
    OR has_database_privilege(target.oid,current_database(),'CONNECT WITH GRANT OPTION,CREATE,TEMPORARY')
    OR EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE a.grantee=target.oid AND (d.datname<>current_database() OR a.privilege_type<>'CONNECT' OR a.is_grantable))
    OR NOT has_schema_privilege(target.oid,'public','USAGE')
    OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(target.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION')
        OR (n.nspname<>'public' AND has_schema_privilege(target.oid,n.oid,'USAGE'))))
    OR EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,target.oid))
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=target.oid)
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
        AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'SELECT,UPDATE,USAGE')
          WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          ELSE false END)
  THEN RAISE EXCEPTION 'Unsafe ambient authority'; END IF;

  -- Verify exact effective and direct column permissions before AND after the
  -- grant, including grant options. An already completed upgrade is idempotent;
  -- a partial upgrade or any unrelated privilege is rejected, never repaired.
  FOR pass IN 0..1 LOOP
    resources_granted := pass=1 OR has_column_privilege(target.oid,'public.entities','name','SELECT');
    SELECT array_agg(value ORDER BY value) INTO expected_capabilities FROM (
      SELECT 'public|'||e.key||'|'||c.name||'|'||p.privilege AS value
      FROM jsonb_each(read_insert_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege)
      UNION ALL
      SELECT 'public|'||e.key||'|'||c.name||'|SELECT'
      FROM jsonb_each(read_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
      UNION ALL
      SELECT 'public|'||e.key||'|'||c.name||'|'||p.privilege
      FROM jsonb_each(resource_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege) WHERE resources_granted
    ) expected;
    SELECT array_agg(n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege ORDER BY n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege)
      INTO actual_capabilities
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
      AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(target.oid,c.oid,a.attnum,p.privilege);
    IF actual_capabilities IS DISTINCT FROM expected_capabilities
    THEN RAISE EXCEPTION 'Editorial writer effective column ACL mismatch'; END IF;
    SELECT array_agg(n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege_type ORDER BY n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege_type)
      INTO actual_capabilities
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) p WHERE p.grantee=target.oid AND NOT p.is_grantable;
    IF actual_capabilities IS DISTINCT FROM expected_capabilities
      OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
        WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
          AND a.attnum>0 AND NOT a.attisdropped
          AND has_column_privilege(target.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION'))
    THEN RAISE EXCEPTION 'Editorial writer direct column ACL mismatch'; END IF;
    IF pass=0 THEN
      GRANT SELECT(id,name,type,status,aliases), INSERT(id,name,type,status,aliases) ON public.entities TO hzense_editorial_writer;
      GRANT SELECT(entity_id,entity_type), INSERT(entity_id,entity_type) ON public.person_profiles, public.organization_profiles TO hzense_editorial_writer;
    END IF;
  END LOOP;
END;
$upgrade$;
COMMIT;
