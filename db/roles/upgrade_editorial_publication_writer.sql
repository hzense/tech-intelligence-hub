-- Writer-only 0032 capability upgrade. Execute only through the protected
-- maintenance runner, which owns BEGIN/COMMIT, target/run/SHA/evidence binding,
-- search_path, timeouts, the complete schema contract and ACL-diff verification.
-- The runner sets hzense.editorial_capability_operation to 'plan' (READ ONLY)
-- or 'grant' (READ WRITE); a missing/unknown mode is rejected.
-- No role creation, password, role attribute, reader grant, flag or data changes.
-- The only net-new capabilities are exactly:
--   editorial_signal_revisions.publication_basis: SELECT, INSERT
--   signal_generation_runs.snapshot: SELECT
-- snapshot includes the complete private generation input/configuration snapshot;
-- this grant is not limited to its publication-policy member.
DO $editorial_publication_writer$
DECLARE
  target pg_catalog.pg_roles%ROWTYPE;
  operation text;
  role_name text;
  pass integer;
  automatic_granted boolean;
  expected_capabilities text[];
  actual_capabilities text[];
  reader_acl_before jsonb;
  reader_acl_current jsonb;
  read_insert_columns jsonb := $columns${
    "editorial_signal_revisions": ["request_id","run_id","owner_id","candidate_index","revision","material_hash","action","content","request_hash","created_at"],
    "entities": ["id","name","type","status","aliases"],
    "person_profiles": ["entity_id","entity_type"],
    "organization_profiles": ["entity_id","entity_type"]
  }$columns$::jsonb;
  read_columns jsonb := $columns${
    "signal_generation_runs": ["id","owner_id","status","deleted_at"],
    "topics": ["id","title","runtime_enabled","status"]
  }$columns$::jsonb;
BEGIN
  IF pg_catalog.regexp_replace(pg_catalog.current_setting('search_path'),'\s','','g')<>'pg_catalog,pg_temp'
  THEN RAISE EXCEPTION 'Restricted maintenance search path required'; END IF;
  operation := pg_catalog.current_setting('hzense.editorial_capability_operation',true);
  IF operation IS NULL OR operation NOT IN ('plan','grant')
  THEN RAISE EXCEPTION 'Reviewed editorial capability operation required'; END IF;
  IF operation='plan' AND pg_catalog.current_setting('transaction_read_only')<>'on'
  THEN RAISE EXCEPTION 'Editorial capability plan must be read only'; END IF;
  IF operation='grant' AND pg_catalog.current_setting('transaction_read_only')<>'off'
  THEN RAISE EXCEPTION 'Editorial capability grant must be writable'; END IF;
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925)
  THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
  THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations
    WHERE name='0032_automatic_signal_publication.sql'
      AND checksum='9807cc0184def7bf808d1c7cbe4dad6f0bc6aed92958a700169cb793e46deb85')
  THEN RAISE EXCEPTION 'Verified migration 0032 required'; END IF;
  IF to_regclass('public.entities') IS NULL OR to_regclass('public.person_profiles') IS NULL
    OR to_regclass('public.organization_profiles') IS NULL
  THEN RAISE EXCEPTION 'Entity profile schema required'; END IF;

  -- Both roles must already have the reviewed resource/unified capabilities.
  -- The reader is checked before any write and again after the writer grant.
  -- The writer accepts exactly its old OR fully upgraded capability set;
  -- missing, partial and unrelated capabilities are rejected, never repaired.
  FOR pass IN 0..(CASE WHEN operation='plan' THEN 0 ELSE 1 END) LOOP
    FOREACH role_name IN ARRAY ARRAY['hzense_editorial_reader','hzense_editorial_writer'] LOOP
      SELECT * INTO STRICT target FROM pg_roles WHERE rolname=role_name;
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
      THEN RAISE EXCEPTION 'Restricted editorial role required'; END IF;
      IF NOT has_database_privilege(target.oid,current_database(),'CONNECT')
        OR has_database_privilege(target.oid,current_database(),'CONNECT WITH GRANT OPTION,CREATE,TEMPORARY')
        OR EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
          WHERE a.grantee=target.oid AND (d.datname<>current_database() OR a.privilege_type<>'CONNECT' OR a.is_grantable))
        OR NOT has_schema_privilege(target.oid,'public','USAGE')
        OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
          AND (has_schema_privilege(target.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION')
            OR (n.nspname<>'public' AND has_schema_privilege(target.oid,n.oid,'USAGE'))))
        OR EXISTS (SELECT 1 FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(l.lomacl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_tablespace t CROSS JOIN LATERAL aclexplode(t.spcacl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_foreign_server f CROSS JOIN LATERAL aclexplode(f.srvacl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_foreign_data_wrapper f CROSS JOIN LATERAL aclexplode(f.fdwacl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,target.oid))
        OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
          WHERE a.grantee=target.oid AND (role_name='hzense_editorial_writer' OR a.privilege_type<>'SELECT' OR a.is_grantable))
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
            AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'SELECT,UPDATE,USAGE')
              WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(target.oid,c.oid,
                CASE WHEN role_name='hzense_editorial_writer' THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                  ELSE 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN' END)
              ELSE false END)
        OR EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a
          WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=target.oid OR (a.grantee=0 AND NOT EXISTS(
            SELECT 1 FROM aclexplode(COALESCE(
              (SELECT p.initprivs FROM pg_init_privs p WHERE p.classoid='pg_proc'::regclass AND p.objoid=f.oid AND p.objsubid=0),
              CASE WHEN f.oid<16384 AND f.proowner=10 THEN acldefault('f',f.proowner) ELSE NULL::aclitem[] END
            )) initial WHERE initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
        OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
          WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=target.oid OR (a.grantee=0
            AND NOT (n.nspname='information_schema' AND n.oid<16384 AND n.nspowner=10 AND a.grantor=10 AND a.privilege_type='USAGE' AND NOT a.is_grantable)
            AND NOT EXISTS(
            SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
            WHERE p.classoid='pg_namespace'::regclass AND p.objoid=n.oid AND p.objsubid=0
              AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
        OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE (n.nspname~'^pg_' OR n.nspname='information_schema')
          AND (a.grantee=target.oid OR (a.grantee=0
            AND NOT (n.nspname='information_schema' AND n.oid<16384 AND c.oid<16384 AND c.relowner=10 AND a.grantor=10
              AND a.privilege_type='SELECT' AND NOT a.is_grantable
              AND (c.relkind='v' OR (c.relkind='r' AND c.relname IN ('sql_features','sql_implementation_info','sql_parts','sql_sizing'))))
            AND NOT EXISTS(
            SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
            WHERE p.classoid='pg_class'::regclass AND p.objoid=c.oid AND p.objsubid=0
              AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
        OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
          WHERE (n.nspname~'^pg_' OR n.nspname='information_schema') AND (a.grantee=target.oid OR (a.grantee=0 AND NOT EXISTS(
            SELECT 1 FROM pg_init_privs p CROSS JOIN LATERAL aclexplode(p.initprivs) initial
            WHERE p.classoid='pg_class'::regclass AND p.objoid=c.oid AND p.objsubid=col.attnum
              AND initial.grantee=0 AND initial.privilege_type=a.privilege_type AND initial.is_grantable=a.is_grantable))))
        OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target.oid,p.oid,'EXECUTE')
          AND NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.objid=p.oid AND d.deptype='e'
              AND e.extname='vector' AND e.extversion='0.8.6' AND e.extnamespace=n.oid AND n.nspname='public'
              AND ((p.proowner=e.extowner AND e.extowner=10)
                OR (pg_get_userbyid(p.proowner)='cloud_admin' AND pg_get_userbyid(e.extowner)='neondb_owner'))
              AND NOT p.prosecdef AND p.proconfig IS NULL
              AND NOT has_function_privilege(target.oid,p.oid,'EXECUTE WITH GRANT OPTION')
              AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=target.oid OR (a.grantee=0 AND a.is_grantable))
              AND (SELECT count(*) FROM pg_depend members WHERE members.refclassid='pg_extension'::regclass
                AND members.refobjid=e.oid AND members.classid='pg_proc'::regclass AND members.deptype='e')=118))
      THEN RAISE EXCEPTION 'Unsafe ambient authority'; END IF;
      IF role_name='hzense_editorial_writer' THEN
        automatic_granted := pass=1 OR has_column_privilege(target.oid,'public.editorial_signal_revisions','publication_basis','SELECT');
        SELECT array_agg(value ORDER BY value) INTO expected_capabilities FROM (
          SELECT 'public|'||e.key||'|'||c.name||'|'||p.privilege AS value
          FROM jsonb_each(read_insert_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
            CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege)
          UNION ALL
          SELECT 'public|'||e.key||'|'||c.name||'|SELECT'
          FROM jsonb_each(read_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(name)
          UNION ALL SELECT 'public|editorial_signal_revisions|unified_content|INSERT'
          UNION ALL SELECT 'public|editorial_signal_revisions|publication_basis|SELECT' WHERE automatic_granted
          UNION ALL SELECT 'public|editorial_signal_revisions|publication_basis|INSERT' WHERE automatic_granted
          UNION ALL SELECT 'public|signal_generation_runs|snapshot|SELECT' WHERE automatic_granted
        ) expected;
      ELSE
        SELECT array_agg(value ORDER BY value) INTO expected_capabilities FROM (
          SELECT 'public|editorial_public_signals|'||unnest(ARRAY['signal_id','revision','content','published_at','publication_basis'])||'|SELECT' AS value
          UNION ALL SELECT 'public|legacy_public_signals|'||unnest(ARRAY['signal_id','content','content_hash'])||'|SELECT'
          UNION ALL SELECT 'public|unified_public_signals|'||unnest(ARRAY['signal_id','version','origin','publication_basis','content','recorded_at'])||'|SELECT'
          UNION ALL SELECT 'public|unified_public_status|ready|SELECT'
        ) expected;
      END IF;
      SELECT array_agg(n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege ORDER BY n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege)
        INTO actual_capabilities
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
      WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
        AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(target.oid,c.oid,a.attnum,p.privilege);
      IF actual_capabilities IS DISTINCT FROM expected_capabilities
        OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
          WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
            AND a.attnum>0 AND NOT a.attisdropped
            AND has_column_privilege(target.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION'))
      THEN RAISE EXCEPTION 'Editorial effective column ACL mismatch'; END IF;
      IF role_name='hzense_editorial_writer' THEN
        SELECT array_agg(n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege_type ORDER BY n.nspname||'|'||c.relname||'|'||a.attname||'|'||p.privilege_type)
          INTO actual_capabilities
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN LATERAL aclexplode(a.attacl) p WHERE p.grantee=target.oid AND NOT p.is_grantable;
        IF actual_capabilities IS DISTINCT FROM expected_capabilities
        THEN RAISE EXCEPTION 'Editorial writer direct column ACL mismatch'; END IF;
      ELSE
        -- Retain the reader's existing direct ACL entries in a canonical
        -- catalog projection, including valid table-level SELECT on public views.
        -- The outer runner additionally verifies the complete cluster ACL diff.
        SELECT COALESCE(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)
          INTO reader_acl_current FROM (
          SELECT jsonb_build_array('database',d.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable) AS value
            FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('schema',n.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('relation',c.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('column',c.attrelid,c.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('routine',p.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('type',t.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a WHERE a.grantee=target.oid
          UNION ALL SELECT jsonb_build_array('default',d.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
            FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee=target.oid
        ) direct_acl;
        IF pass=0 THEN reader_acl_before := reader_acl_current;
        ELSIF reader_acl_before IS DISTINCT FROM reader_acl_current
        THEN RAISE EXCEPTION 'Editorial reader ACL changed'; END IF;
      END IF;
    END LOOP;
    IF pass=0 AND operation='grant' THEN
      GRANT SELECT(publication_basis), INSERT(publication_basis) ON public.editorial_signal_revisions TO hzense_editorial_writer;
      GRANT SELECT(snapshot) ON public.signal_generation_runs TO hzense_editorial_writer;
    END IF;
  END LOOP;
END;
$editorial_publication_writer$;
