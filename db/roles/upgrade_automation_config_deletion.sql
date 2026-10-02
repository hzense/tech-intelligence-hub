-- Separately approve after deploying the 0026/0027-compatible application and
-- applying/verifying 0027 under a fresh maintenance authorization. Keep the
-- maintenance freeze until the role guard and live configuration read pass.
-- Run as the authenticated owner of the target database. No passwords, role
-- creation, PUBLIC repair, AI calls, data deletion, or table-level grants.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
DO $upgrade$
DECLARE
  target pg_roles%ROWTYPE;
  pass integer;
  deletion_granted boolean;
  expected_capabilities text[];
  actual_capabilities text[];
  read_insert_columns jsonb := $columns${
    "automation_configs": ["id","owner_id","revision","config","enabled","next_run_at","created_at","updated_at"],
    "automation_runs": ["id","config_id","owner_id","config_revision","snapshot","slot","trigger","status","phase","result","frozen_inputs","error_code","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","cost_source","publication_status","published_at","created_at","started_at","finished_at"]
  }$columns$::jsonb;
  update_columns jsonb := $columns${
    "automation_configs": ["revision","config","enabled","next_run_at","updated_at"],
    "automation_runs": ["status","phase","result","frozen_inputs","error_code","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","cost_source","publication_status","published_at","started_at","finished_at"]
  }$columns$::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925)
  THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
  THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations
    WHERE name='0027_automation_config_deletion.sql'
      AND checksum='d395736de66cc66868dbe5ef1ac5a3ad6f724c2c8c77476c3e6e111682cf1ee5')
  THEN RAISE EXCEPTION 'Verified migration 0027 required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='automation_configs' AND c.relkind='r'
      AND a.attname='deleted_at' AND a.attnum>0 AND NOT a.attisdropped
      AND a.atttypid='timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
      AND a.attgenerated='' AND a.attidentity='')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.automation_configs'::regclass
      AND conname='automation_configs_deleted_state_check' AND contype='c' AND convalidated)
  THEN RAISE EXCEPTION 'Soft deletion schema required'; END IF;
  SELECT * INTO STRICT target FROM pg_roles WHERE rolname='hzense_automation_admin';
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
  THEN RAISE EXCEPTION 'Restricted automation admin role required'; END IF;
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
    deletion_granted := pass=1 OR (
      has_column_privilege(target.oid,'public.automation_configs','deleted_at','SELECT')
      AND has_column_privilege(target.oid,'public.automation_configs','deleted_at','UPDATE'));
    SELECT array_agg(value ORDER BY value) INTO expected_capabilities FROM (
      SELECT 'public|'||e.key||'|'||c.name||'|'||p.privilege AS value
      FROM jsonb_each(read_insert_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege)
      UNION ALL
      SELECT 'public|'||e.key||'|'||c.name||'|UPDATE'
      FROM jsonb_each(update_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
      UNION ALL SELECT 'public|automation_configs|deleted_at|'||p.privilege
        FROM (VALUES ('SELECT'),('UPDATE')) p(privilege) WHERE deletion_granted
    ) expected;
    SELECT array_agg(n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege ORDER BY n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege)
      INTO actual_capabilities
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
    WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
      AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(target.oid,c.oid,a.attnum,p.privilege);
    IF actual_capabilities IS DISTINCT FROM expected_capabilities
    THEN RAISE EXCEPTION 'Automation admin effective column ACL mismatch'; END IF;
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
    THEN RAISE EXCEPTION 'Automation admin direct column ACL mismatch'; END IF;
    IF pass=0 THEN
      GRANT SELECT (deleted_at), UPDATE (deleted_at) ON public.automation_configs TO hzense_automation_admin;
    END IF;
  END LOOP;
END;
$upgrade$;
COMMIT;
