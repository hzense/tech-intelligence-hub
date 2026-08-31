-- HZense Runtime Topic projection reader privilege contract.
--
-- Preconditions:
--   1. Connect to the intended database as its owner and the owner of the
--      migration-created public objects. Do not run this as hzense_runtime.
--   2. The provider/cluster administrator has already created hzense_runtime
--      with the fixed attributes asserted below, a separate credential, and
--      default_transaction_read_only=on. The restricted Migrator deliberately
--      cannot and must not ALTER ROLE.
--   3. Migrations through 0002_topic_projection.sql have been applied and fully
--      verified. Freeze owner/migrator DDL while configuring and verifying ACLs.
--
-- The only data grant is column-level SELECT on the five reviewed Topic
-- projection columns. Provider-owned SECURITY INVOKER extension routines (for
-- example pgvector) may retain their built-in PUBLIC EXECUTE privilege; they do
-- not bypass the table ACL. Application routines, SECURITY DEFINER routines,
-- direct routine grants and grant options remain forbidden.
--
-- This file contains no role creation, ALTER ROLE, password, URL or secret.

BEGIN;

DO $hzense_runtime_lock$
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925) THEN
    RAISE EXCEPTION
      'HZense migration/role-configuration advisory lock is busy; aborting Runtime reader configuration';
  END IF;
END
$hzense_runtime_lock$;

DO $hzense_runtime_guard$
DECLARE
  target_database name := current_database();
  target_database_oid oid;
  database_owner name;
  runtime_role pg_roles%ROWTYPE;
BEGIN
  SELECT database_info.oid,
         pg_get_userbyid(database_info.datdba)
    INTO target_database_oid,
         database_owner
  FROM pg_database AS database_info
  WHERE database_info.datname = target_database;

  IF session_user <> current_user THEN
    RAISE EXCEPTION
      'Run as the authenticated database/migration owner without SET ROLE; session_user=%, current_user=%',
      session_user,
      current_user;
  END IF;
  IF current_user = 'hzense_runtime' THEN
    RAISE EXCEPTION 'Do not run the privilege configurator as hzense_runtime';
  END IF;
  IF database_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'Run as owner of current_database(); database=%, owner=%, current_user=%',
      target_database,
      database_owner,
      current_user;
  END IF;

  SELECT role_info.*
    INTO runtime_role
  FROM pg_roles AS role_info
  WHERE role_info.rolname = 'hzense_runtime';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Provider/cluster administrator must create role hzense_runtime before this script';
  END IF;
  IF NOT runtime_role.rolcanlogin
     OR runtime_role.rolinherit
     OR runtime_role.rolconnlimit <> 20
     OR runtime_role.rolsuper
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'hzense_runtime must be LOGIN NOINHERIT CONNECTION LIMIT 20 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership_info
    WHERE membership_info.member = runtime_role.oid
       OR membership_info.roleid = runtime_role.oid
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must have no incoming or outgoing role memberships';
  END IF;
  IF database_owner = runtime_role.rolname THEN
    RAISE EXCEPTION 'hzense_runtime must not own the target database';
  END IF;
  IF NOT (CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = runtime_role.oid
        AND role_setting.setdatabase = target_database_oid
        AND EXISTS (
          SELECT 1
          FROM unnest(role_setting.setconfig) AS configured_value(value)
          WHERE configured_value.value LIKE 'default_transaction_read_only=%'
        )
    )
    THEN EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = runtime_role.oid
        AND role_setting.setdatabase = target_database_oid
        AND role_setting.setconfig
          @> ARRAY['default_transaction_read_only=on']::text[]
    )
    ELSE COALESCE(runtime_role.rolconfig, ARRAY[]::text[])
      @> ARRAY['default_transaction_read_only=on']::text[]
  END) THEN
    RAISE EXCEPTION
      'Provider/cluster administrator must set default_transaction_read_only=on for hzense_runtime';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_database AS database_info
    WHERE database_info.oid <> target_database_oid
      AND database_info.datallowconn
      AND (
        has_database_privilege(runtime_role.rolname, database_info.oid, 'CONNECT')
        OR has_database_privilege(runtime_role.rolname, database_info.oid, 'CREATE')
        OR has_database_privilege(runtime_role.rolname, database_info.oid, 'TEMPORARY')
      )
  ) THEN
    RAISE EXCEPTION
      'Provider/cluster administrator must remove hzense_runtime privileges from every other connectable database';
  END IF;

  IF to_regclass('public.hzense_schema_migrations') IS NULL
     OR to_regclass('public.topics') IS NULL
     OR to_regtype('public.topic_status') IS NULL THEN
    RAISE EXCEPTION
      'Required migration objects are missing in current_database(): public.hzense_schema_migrations, public.topics or public.topic_status';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.hzense_schema_migrations
    WHERE name = '0002_topic_projection.sql'
  ) OR (
    SELECT count(*)
    FROM pg_attribute AS column_info
    WHERE column_info.attrelid = 'public.topics'::regclass
      AND column_info.attname = ANY (
        ARRAY['id', 'title', 'parent_id', 'status', 'runtime_enabled']::name[]
      )
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped
  ) <> 5 THEN
    RAISE EXCEPTION
      '0002_topic_projection.sql and all five Runtime Topic columns must exist before role configuration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
    WHERE namespace_info.nspname = 'public'
      AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND pg_get_userbyid(relation_info.relowner) <> current_user
  ) OR EXISTS (
    SELECT 1
    FROM pg_type AS type_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND type_info.typtype = 'e'
      AND pg_get_userbyid(type_info.typowner) <> current_user
  ) THEN
    RAISE EXCEPTION
      'Run as the migration owner of every public relation and public.topic_status';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_inherits AS inheritance_info
    JOIN pg_class AS parent_info ON parent_info.oid = inheritance_info.inhparent
    JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_info.relnamespace
    JOIN pg_class AS child_info ON child_info.oid = inheritance_info.inhrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_info.relnamespace
    WHERE (
      parent_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND parent_namespace.nspname !~ '^pg_temp_[0-9]+$'
      AND parent_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
    ) OR (
      child_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND child_namespace.nspname !~ '^pg_temp_[0-9]+$'
      AND child_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
    )
  ) THEN
    RAISE EXCEPTION
      'Runtime reader forbids PostgreSQL table inheritance in application schemas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
    WHERE namespace_info.nspname = 'public'
      AND pg_get_userbyid(routine_info.proowner) <> current_user
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS extension_dependency
        JOIN pg_extension AS extension_info
          ON extension_info.oid = extension_dependency.refobjid
        WHERE extension_dependency.classid = 'pg_proc'::regclass
          AND extension_dependency.objid = routine_info.oid
          AND extension_dependency.deptype = 'e'
          AND extension_info.extname = 'vector'
          AND routine_info.proowner = extension_info.extowner
          AND extension_info.extowner <> runtime_role.oid
          AND pg_get_userbyid(extension_info.extowner) <> current_user
      )
  ) THEN
    RAISE EXCEPTION
      'Non-pgvector public routines must be owned by the migration owner before Runtime ACL configuration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace_info
    WHERE namespace_info.nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND (
        pg_get_userbyid(namespace_info.nspowner) = runtime_role.rolname
        OR has_schema_privilege(runtime_role.rolname, namespace_info.oid, 'USAGE')
        OR has_schema_privilege(runtime_role.rolname, namespace_info.oid, 'CREATE')
      )
  ) THEN
    RAISE EXCEPTION
      'hzense_runtime already has access to a non-public application schema; remove it before configuration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace_info
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND pg_get_userbyid(namespace_info.nspowner) = runtime_role.rolname
  ) OR EXISTS (
    SELECT 1
    FROM pg_class AS relation_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND pg_get_userbyid(relation_info.relowner) = runtime_role.rolname
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc AS routine_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND pg_get_userbyid(routine_info.proowner) = runtime_role.rolname
  ) OR EXISTS (
    SELECT 1
    FROM pg_type AS type_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND pg_get_userbyid(type_info.typowner) = runtime_role.rolname
  ) OR EXISTS (
    SELECT 1
    FROM pg_extension AS extension_info
    WHERE pg_get_userbyid(extension_info.extowner) = runtime_role.rolname
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must not own database schema objects';
  END IF;

  EXECUTE format(
    'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC',
    target_database
  );
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    target_database,
    runtime_role.rolname
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    target_database,
    runtime_role.rolname
  );
END
$hzense_runtime_guard$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM hzense_runtime;
GRANT USAGE ON SCHEMA public TO hzense_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM hzense_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM hzense_runtime;

DO $hzense_runtime_columns$
DECLARE
  relation_info record;
BEGIN
  FOR relation_info IN
    SELECT namespace_info.nspname AS schema_name,
           table_info.relname AS relation_name,
           string_agg(format('%I', column_info.attname), ', ' ORDER BY column_info.attnum)
             AS column_list
    FROM pg_class AS table_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
    JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
    WHERE namespace_info.nspname = 'public'
      AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped
    GROUP BY namespace_info.nspname, table_info.relname
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM PUBLIC',
      relation_info.column_list,
      relation_info.schema_name,
      relation_info.relation_name
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM %I',
      relation_info.column_list,
      relation_info.schema_name,
      relation_info.relation_name,
      'hzense_runtime'
    );
  END LOOP;
END
$hzense_runtime_columns$;

DO $hzense_runtime_enum_types$
DECLARE
  type_info record;
BEGIN
  FOR type_info IN
    SELECT namespace_info.nspname AS schema_name,
           enum_info.typname AS type_name
    FROM pg_type AS enum_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = enum_info.typnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND enum_info.typtype = 'e'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM PUBLIC',
      type_info.schema_name,
      type_info.type_name
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM %I',
      type_info.schema_name,
      type_info.type_name,
      'hzense_runtime'
    );
  END LOOP;
END
$hzense_runtime_enum_types$;

GRANT USAGE ON TYPE public.topic_status TO hzense_runtime;

DO $hzense_runtime_routines$
DECLARE
  routine_info record;
BEGIN
  FOR routine_info IN
    SELECT namespace_info.nspname AS schema_name,
           procedure_info.proname AS routine_name,
           pg_get_function_identity_arguments(procedure_info.oid) AS identity_arguments
    FROM pg_proc AS procedure_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = procedure_info.pronamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND pg_get_userbyid(procedure_info.proowner) = current_user
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS extension_dependency
        WHERE extension_dependency.classid = 'pg_proc'::regclass
          AND extension_dependency.objid = procedure_info.oid
          AND extension_dependency.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ROUTINE %I.%I(%s) FROM PUBLIC',
      routine_info.schema_name,
      routine_info.routine_name,
      routine_info.identity_arguments
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ROUTINE %I.%I(%s) FROM %I',
      routine_info.schema_name,
      routine_info.routine_name,
      routine_info.identity_arguments,
      'hzense_runtime'
    );
  END LOOP;
END
$hzense_runtime_routines$;

GRANT SELECT (id, title, parent_id, status, runtime_enabled)
  ON TABLE public.topics TO hzense_runtime;

ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON TABLES FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE ON TYPES FROM hzense_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE ON TYPES FROM hzense_runtime;

DO $hzense_runtime_postcondition$
DECLARE
  target_database name := current_database();
  target_database_oid oid := (
    SELECT oid FROM pg_database WHERE datname = current_database()
  );
  runtime_role_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'hzense_runtime');
  readable_columns text[] := ARRAY['id', 'parent_id', 'runtime_enabled', 'status', 'title'];
  effective_readable_columns text[];
BEGIN
  IF NOT has_database_privilege('hzense_runtime', target_database, 'CONNECT')
     OR has_database_privilege('hzense_runtime', target_database, 'CONNECT WITH GRANT OPTION')
     OR has_database_privilege('hzense_runtime', target_database, 'CREATE')
     OR has_database_privilege('hzense_runtime', target_database, 'TEMPORARY') THEN
    RAISE EXCEPTION 'hzense_runtime database privileges are not CONNECT-only';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_database AS database_info
    WHERE database_info.oid <> target_database_oid
      AND database_info.datallowconn
      AND (
        has_database_privilege('hzense_runtime', database_info.oid, 'CONNECT')
        OR has_database_privilege('hzense_runtime', database_info.oid, 'CREATE')
        OR has_database_privilege('hzense_runtime', database_info.oid, 'TEMPORARY')
      )
  ) THEN
    RAISE EXCEPTION
      'hzense_runtime has privileges on another connectable database';
  END IF;
  IF NOT has_schema_privilege('hzense_runtime', 'public', 'USAGE')
     OR has_schema_privilege('hzense_runtime', 'public', 'USAGE WITH GRANT OPTION')
     OR has_schema_privilege('hzense_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'hzense_runtime public Schema privileges are not USAGE-only';
  END IF;
  IF NOT has_type_privilege('hzense_runtime', 'public.topic_status', 'USAGE')
     OR has_type_privilege(
       'hzense_runtime',
       'public.topic_status',
       'USAGE WITH GRANT OPTION'
     ) THEN
    RAISE EXCEPTION 'hzense_runtime topic_status privileges are not USAGE-only';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_type AS type_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND type_info.typtype = 'e'
      AND type_info.oid <> 'public.topic_status'::regtype
      AND (
        has_type_privilege('hzense_runtime', type_info.oid, 'USAGE')
        OR has_type_privilege(
          'hzense_runtime',
          type_info.oid,
          'USAGE WITH GRANT OPTION'
        )
      )
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must not have USAGE on other application enum Types';
  END IF;
  IF NOT (CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = runtime_role_oid
        AND role_setting.setdatabase = target_database_oid
        AND EXISTS (
          SELECT 1
          FROM unnest(role_setting.setconfig) AS configured_value(value)
          WHERE configured_value.value LIKE 'default_transaction_read_only=%'
        )
    )
    THEN EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS role_setting
      WHERE role_setting.setrole = runtime_role_oid
        AND role_setting.setdatabase = target_database_oid
        AND role_setting.setconfig
          @> ARRAY['default_transaction_read_only=on']::text[]
    )
    ELSE COALESCE(
      (SELECT rolconfig FROM pg_roles WHERE rolname = 'hzense_runtime'),
      ARRAY[]::text[]
    ) @> ARRAY['default_transaction_read_only=on']::text[]
  END) THEN
    RAISE EXCEPTION 'hzense_runtime default_transaction_read_only setting changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS table_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
    CROSS JOIN unnest(
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    ) AS privilege_info(privilege)
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        has_table_privilege('hzense_runtime', table_info.oid, privilege_info.privilege)
        OR has_table_privilege(
          'hzense_runtime',
          table_info.oid,
          privilege_info.privilege || ' WITH GRANT OPTION'
        )
      )
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must not receive table-level privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_inherits AS inheritance_info
    JOIN pg_class AS parent_info ON parent_info.oid = inheritance_info.inhparent
    JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_info.relnamespace
    JOIN pg_class AS child_info ON child_info.oid = inheritance_info.inhrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_info.relnamespace
    WHERE (
      parent_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND parent_namespace.nspname !~ '^pg_temp_[0-9]+$'
      AND parent_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
    ) OR (
      child_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND child_namespace.nspname !~ '^pg_temp_[0-9]+$'
      AND child_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
    )
  ) THEN
    RAISE EXCEPTION
      'Runtime reader forbids PostgreSQL table inheritance in application schemas';
  END IF;

  SELECT array_agg(column_info.attname::text ORDER BY column_info.attname)
    INTO effective_readable_columns
  FROM pg_attribute AS column_info
  WHERE column_info.attrelid = 'public.topics'::regclass
    AND column_info.attnum > 0
    AND NOT column_info.attisdropped
    AND has_column_privilege(
      'hzense_runtime',
      column_info.attrelid,
      column_info.attnum,
      'SELECT'
    );
  IF effective_readable_columns IS DISTINCT FROM readable_columns THEN
    RAISE EXCEPTION
      'hzense_runtime readable Topic columns differ from id/title/parent_id/status/runtime_enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS table_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
    JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'])
      AS privilege_info(privilege)
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped
      AND (
        has_column_privilege(
          'hzense_runtime',
          table_info.oid,
          column_info.attnum,
          privilege_info.privilege
        )
        OR has_column_privilege(
          'hzense_runtime',
          table_info.oid,
          column_info.attnum,
          privilege_info.privilege || ' WITH GRANT OPTION'
        )
      )
      AND NOT (
        namespace_info.nspname = 'public'
        AND table_info.relname = 'topics'
        AND column_info.attname::text = ANY (readable_columns)
        AND privilege_info.privilege = 'SELECT'
        AND NOT has_column_privilege(
          'hzense_runtime',
          table_info.oid,
          column_info.attnum,
          'SELECT WITH GRANT OPTION'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'hzense_runtime has column privileges outside the five non-grantable Topic SELECT grants';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS sequence_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = sequence_info.relnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND sequence_info.relkind = 'S'
      AND (
        has_sequence_privilege('hzense_runtime', sequence_info.oid, 'USAGE')
        OR has_sequence_privilege('hzense_runtime', sequence_info.oid, 'SELECT')
        OR has_sequence_privilege('hzense_runtime', sequence_info.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must not have Sequence privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
    LEFT JOIN pg_depend AS extension_dependency
      ON extension_dependency.classid = 'pg_proc'::regclass
     AND extension_dependency.objid = routine_info.oid
     AND extension_dependency.deptype = 'e'
    LEFT JOIN pg_extension AS extension_info
      ON extension_info.oid = extension_dependency.refobjid
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND has_function_privilege('hzense_runtime', routine_info.oid, 'EXECUTE')
      AND (
        extension_info.oid IS NULL
        OR extension_info.extname <> 'vector'
        OR routine_info.proowner <> extension_info.extowner
        OR extension_info.extowner = runtime_role_oid
        OR pg_get_userbyid(extension_info.extowner) = current_user
        OR routine_info.prosecdef
        OR has_function_privilege(
          'hzense_runtime',
          routine_info.oid,
          'EXECUTE WITH GRANT OPTION'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'hzense_runtime can execute an application, SECURITY DEFINER or grantable routine';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
    CROSS JOIN LATERAL aclexplode(routine_info.proacl) AS acl_info
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND acl_info.grantee = runtime_role_oid
  ) THEN
    RAISE EXCEPTION 'hzense_runtime must not receive direct routine grants';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS default_acl
    CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
    WHERE default_acl.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
      AND acl_info.grantee IN (0, runtime_role_oid)
  ) THEN
    RAISE EXCEPTION
      'PUBLIC or hzense_runtime future Table/Sequence/Function/Type grants remain for the migration owner';
  END IF;
END
$hzense_runtime_postcondition$;

COMMIT;
