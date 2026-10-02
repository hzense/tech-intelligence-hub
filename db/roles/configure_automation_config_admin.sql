-- Manual, reviewed admin-only authorization on production main / hzense after
-- independent 0026 schema verification. Authenticate directly as this database's
-- owner (currently hzense_migrator); CREATEROLE is neither needed nor granted.
-- Pre-create the EMPTY restricted login using create_automation_config_admin.sql
-- under its separate Neon authority. This transaction never creates roles or
-- changes passwords. Existing rights or unsafe ambient ACLs stop the operation;
-- do not repair other roles/PUBLIC or retry by dropping the pre-created role.
-- No public insight reader is created or authorized, and no AI is called.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
DO $guard$
DECLARE target pg_roles%ROWTYPE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925)
  THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF current_database() <> 'hzense' OR session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
  THEN RAISE EXCEPTION 'Authenticated hzense database owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations WHERE name = '0026_automation_tasks.sql')
  THEN RAISE EXCEPTION 'Verified migration 0026 required'; END IF;
  IF to_regclass('public.automation_configs') IS NULL
    OR to_regclass('public.automation_runs') IS NULL
  THEN RAISE EXCEPTION 'Required automation relations missing'; END IF;
  SELECT * INTO STRICT target FROM pg_roles WHERE rolname = 'hzense_automation_admin';
  IF NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit <> 2 OR target.rolconfig IS NOT NULL
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE (m.member = target.oid OR m.roleid = target.oid)
      AND (m.roleid = target.oid AND pg_get_userbyid(m.member) = 'neondb_owner'
        AND pg_get_userbyid(m.grantor) = 'cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = target.oid)
    OR EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = target.oid AND deptype IN ('o', 'a'))
  THEN RAISE EXCEPTION 'Automation admin must be an empty, restricted direct login'; END IF;
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
END;
$guard$;
GRANT USAGE ON SCHEMA public TO hzense_automation_admin;
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
-- GRANT may emit only a warning if the owner cannot grant an object privilege.
-- Compare effective rights and exact direct ACLs before committing; any missing
-- or additional capability rolls back every grant in this transaction. This
-- detects drift visible now, not future changes: keep the maintenance freeze.
DO $verify_acl$
DECLARE
  target oid := 'hzense_automation_admin'::regrole;
  target_role pg_roles%ROWTYPE;
  relation_info record;
  column_info record;
  checked_privilege text;
  expected boolean;
  read_insert_columns jsonb := $columns${
    "automation_configs": ["id","owner_id","revision","config","enabled","next_run_at","created_at","updated_at"],
    "automation_runs": ["id","config_id","owner_id","config_revision","snapshot","slot","trigger","status","phase","result","frozen_inputs","error_code","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","cost_source","publication_status","published_at","created_at","started_at","finished_at"]
  }$columns$::jsonb;
  update_columns jsonb := $columns${
    "automation_configs": ["revision","config","enabled","next_run_at","updated_at"],
    "automation_runs": ["status","phase","result","frozen_inputs","error_code","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","cost_source","publication_status","published_at","started_at","finished_at"]
  }$columns$::jsonb;
BEGIN
  SELECT * INTO STRICT target_role FROM pg_roles WHERE oid = target;
  IF NOT target_role.rolcanlogin OR target_role.rolinherit OR target_role.rolconnlimit <> 2
    OR target_role.rolconfig IS NOT NULL OR target_role.rolsuper OR target_role.rolcreatedb
    OR target_role.rolcreaterole OR target_role.rolreplication OR target_role.rolbypassrls
    OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = target)
    OR EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = target
      AND (deptype = 'o' OR (deptype = 'a' AND (
        classid NOT IN ('pg_database'::regclass, 'pg_namespace'::regclass, 'pg_class'::regclass)
        OR dbid NOT IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))))))
  THEN RAISE EXCEPTION 'Automation admin role contract mismatch'; END IF;
  IF (SELECT count(*) FROM pg_auth_members WHERE member = target OR roleid = target) > 1
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE (m.member = target OR m.roleid = target)
      AND (m.roleid = target AND pg_get_userbyid(m.member) = 'neondb_owner'
        AND pg_get_userbyid(m.grantor) = 'cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  THEN RAISE EXCEPTION 'Automation admin membership contract mismatch'; END IF;
  IF NOT has_database_privilege(target, current_database(), 'CONNECT')
    OR has_database_privilege(target, current_database(), 'CONNECT WITH GRANT OPTION,CREATE,TEMPORARY')
    OR (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee = target) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE d.datname = current_database() AND a.grantee = target AND a.privilege_type = 'CONNECT' AND NOT a.is_grantable)
  THEN RAISE EXCEPTION 'Automation admin database privilege contract mismatch'; END IF;
  -- PUBLIC rights apply to NOINHERIT logins. Exempt only the exact provider
  -- reserved-database shapes already accepted by the application's role guard.
  IF EXISTS (SELECT 1 FROM pg_database d WHERE d.datname <> current_database() AND d.datallowconn
    AND has_database_privilege(target, d.oid, 'CONNECT,CREATE,TEMPORARY')
    AND NOT (
      pg_get_userbyid(d.datdba) = 'cloud_admin' AND d.datconnlimit = -1
      AND NOT has_database_privilege(target, d.oid, 'CONNECT WITH GRANT OPTION,CREATE,CREATE WITH GRANT OPTION,TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
        WHERE a.grantee = target OR (a.grantee = 0 AND a.is_grantable))
      AND ((d.datname = 'postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND has_database_privilege(target, d.oid, 'CONNECT') AND has_database_privilege(target, d.oid, 'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = 0) = ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname = 'template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(target, d.oid, 'CONNECT') AND NOT has_database_privilege(target, d.oid, 'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = 0) = ARRAY['CONNECT']::text[]))))
  THEN RAISE EXCEPTION 'Automation admin has unsafe privileges on another connectable database'; END IF;
  IF NOT has_schema_privilege(target, 'public', 'USAGE')
    OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND (has_schema_privilege(target, n.oid, 'CREATE,USAGE WITH GRANT OPTION')
        OR (n.nspname <> 'public' AND has_schema_privilege(target, n.oid, 'USAGE'))))
    OR (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee = target) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname = 'public' AND a.grantee = target AND a.privilege_type = 'USAGE' AND NOT a.is_grantable)
  THEN RAISE EXCEPTION 'Automation admin schema privilege contract mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0, target))
  THEN RAISE EXCEPTION 'Unsafe ambient default privileges'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee = target)
  THEN RAISE EXCEPTION 'Automation admin must have no direct table or sequence privileges'; END IF;
  FOR relation_info IN
    SELECT c.oid,c.relname,c.relkind,c.relowner,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
  LOOP
    -- Enumerate PostgreSQL's privileges rather than omit newer table rights.
    FOR checked_privilege IN SELECT a.privilege_type FROM aclexplode(acldefault(
      CASE WHEN relation_info.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, relation_info.relowner)) a
    LOOP
      IF relation_info.relkind = 'S' THEN
        IF has_sequence_privilege(target, relation_info.oid, checked_privilege)
        THEN RAISE EXCEPTION 'Automation admin effective sequence privilege contract mismatch'; END IF;
      ELSIF has_table_privilege(target, relation_info.oid, checked_privilege)
      THEN RAISE EXCEPTION 'Automation admin effective table privilege contract mismatch'; END IF;
    END LOOP;
    FOR column_info IN SELECT a.attnum,a.attname FROM pg_attribute a
      WHERE a.attrelid = relation_info.oid AND a.attnum > 0 AND NOT a.attisdropped AND relation_info.relkind <> 'S'
    LOOP
      FOREACH checked_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        expected := relation_info.nspname = 'public' AND relation_info.relkind = 'r' AND CASE
          WHEN checked_privilege IN ('SELECT','INSERT') THEN COALESCE((read_insert_columns->relation_info.relname)?column_info.attname, false)
          WHEN checked_privilege = 'UPDATE' THEN COALESCE((update_columns->relation_info.relname)?column_info.attname, false)
          ELSE false END;
        IF has_column_privilege(target, relation_info.oid, column_info.attnum, checked_privilege) IS DISTINCT FROM expected
          OR has_column_privilege(target, relation_info.oid, column_info.attnum, checked_privilege || ' WITH GRANT OPTION')
        THEN RAISE EXCEPTION 'Automation admin effective column privilege contract mismatch on %.%.%',
          relation_info.nspname, relation_info.relname, column_info.attname; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS (
    WITH expected_acl AS (
      SELECT 'public'::name AS schema_name,e.key::name AS table_name,c.column_name::name AS column_name,p.privilege_name
      FROM jsonb_each(read_insert_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(column_name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege_name)
      UNION ALL
      SELECT 'public'::name,e.key::name,c.column_name::name,'UPDATE'
      FROM jsonb_each(update_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(column_name)
    ), actual_acl AS (
      SELECT n.nspname AS schema_name,c.relname AS table_name,col.attname AS column_name,a.privilege_type AS privilege_name,a.is_grantable
      FROM pg_attribute col JOIN pg_class c ON c.oid = col.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE a.grantee = target
    )
    SELECT 1 FROM (
      (SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl WHERE NOT is_grantable)
      UNION ALL
      (SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl)
    ) difference
  ) THEN RAISE EXCEPTION 'Automation admin direct column ACL contract mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee = target)
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND has_function_privilege(target, p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_extension'::regclass AND d.objid = p.oid AND d.deptype = 'e'
          AND e.extname = 'vector' AND e.extversion = '0.8.6' AND e.extnamespace = n.oid AND n.nspname = 'public'
          AND ((p.proowner = e.extowner AND e.extowner = 10)
            OR (pg_get_userbyid(p.proowner) = 'cloud_admin' AND pg_get_userbyid(e.extowner) = 'neondb_owner'))
          AND NOT p.prosecdef AND p.proconfig IS NULL
          AND NOT has_function_privilege(target, p.oid, 'EXECUTE WITH GRANT OPTION')
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = target OR (a.grantee = 0 AND a.is_grantable))
          AND (SELECT count(*) FROM pg_depend members WHERE members.refclassid = 'pg_extension'::regclass
            AND members.refobjid = e.oid AND members.classid = 'pg_proc'::regclass AND members.deptype = 'e') = 118))
  THEN RAISE EXCEPTION 'Automation admin function privilege contract mismatch'; END IF;
END;
$verify_acl$;
COMMIT;
