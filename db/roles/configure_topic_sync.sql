-- HZense Topic projection writer privilege contract.
--
-- Preconditions:
--   1. Connect to the intended database as its owner and the owner of the
--      migration-created public objects. Do not run this as hzense_topic_sync.
--   2. The provider/cluster administrator has already created the fixed role
--      hzense_topic_sync with its credential and the attributes asserted below.
--   3. Migrations through 0002_topic_projection.sql have been applied and fully
--      verified. Freeze owner/migrator DDL for the rest of the maintenance window.
--
-- Scope:
--   This transaction changes ACLs only in current_database(). ALTER DEFAULT
--   PRIVILEGES changes current_user defaults both globally (all schemas in this
--   database) and in public. PUBLIC database/schema revocations affect every
--   non-owner role in this database. Grant any other reviewed role its own direct
--   privileges separately.
--
-- This file deliberately contains no role creation, password, URL or secret.

BEGIN;

DO $hzense_topic_sync_lock$
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925) THEN
    RAISE EXCEPTION
      'HZense migration/Topic-sync advisory lock is busy; aborting role configuration';
  END IF;
END
$hzense_topic_sync_lock$;

DO $hzense_topic_sync_guard$
DECLARE
  target_database name := current_database();
  database_owner name;
  sync_role pg_roles%ROWTYPE;
BEGIN
  SELECT pg_get_userbyid(database_info.datdba)
    INTO database_owner
  FROM pg_database AS database_info
  WHERE database_info.datname = target_database;

  IF session_user <> current_user THEN
    RAISE EXCEPTION
      'Run as the authenticated database/migration owner without SET ROLE; session_user=%, current_user=%',
      session_user,
      current_user;
  END IF;
  IF current_user = 'hzense_topic_sync' THEN
    RAISE EXCEPTION 'Do not run the privilege configurator as hzense_topic_sync';
  END IF;
  IF database_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION
      'Run as owner of current_database(); database=%, owner=%, current_user=%',
      target_database,
      database_owner,
      current_user;
  END IF;

  SELECT role_info.*
    INTO sync_role
  FROM pg_roles AS role_info
  WHERE role_info.rolname = 'hzense_topic_sync';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Provider/cluster administrator must create role hzense_topic_sync before this script';
  END IF;
  IF NOT sync_role.rolcanlogin
     OR sync_role.rolinherit
     OR sync_role.rolconnlimit <> 2
     OR sync_role.rolsuper
     OR sync_role.rolcreatedb
     OR sync_role.rolcreaterole
     OR sync_role.rolreplication
     OR sync_role.rolbypassrls THEN
    RAISE EXCEPTION
      'hzense_topic_sync must be LOGIN NOINHERIT CONNECTION LIMIT 2 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership_info
    WHERE membership_info.member = sync_role.oid
  ) THEN
    RAISE EXCEPTION 'hzense_topic_sync must not be a member of any role';
  END IF;
  IF database_owner = sync_role.rolname THEN
    RAISE EXCEPTION 'hzense_topic_sync must not own the target database';
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
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS column_info
    WHERE column_info.attrelid = 'public.topics'::regclass
      AND column_info.attname = 'runtime_enabled'
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped
  ) THEN
    RAISE EXCEPTION
      '0002_topic_projection.sql must be applied and verified before role configuration';
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
    WHERE type_info.oid = 'public.topic_status'::regtype
      AND pg_get_userbyid(type_info.typowner) <> current_user
  ) THEN
    RAISE EXCEPTION
      'Run as the migration owner of every public relation and public.topic_status';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace_info
    WHERE namespace_info.nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND (
        pg_get_userbyid(namespace_info.nspowner) = sync_role.rolname
        OR has_schema_privilege(sync_role.rolname, namespace_info.oid, 'USAGE')
        OR has_schema_privilege(sync_role.rolname, namespace_info.oid, 'CREATE')
      )
  ) THEN
    RAISE EXCEPTION
      'hzense_topic_sync already has access to a non-public application schema; remove it before configuration';
  END IF;

  EXECUTE format(
    'REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC',
    target_database
  );
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    target_database,
    sync_role.rolname
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    target_database,
    sync_role.rolname
  );
END
$hzense_topic_sync_guard$;

-- Remove inherited PUBLIC reachability and any earlier direct grants before
-- installing the reviewed public-schema allowlist.
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM hzense_topic_sync;
GRANT USAGE ON SCHEMA public TO hzense_topic_sync;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM hzense_topic_sync;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM hzense_topic_sync;

-- Table-level REVOKE does not remove independent column ACLs.
DO $hzense_topic_sync_columns$
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
      'hzense_topic_sync'
    );
  END LOOP;
END
$hzense_topic_sync_columns$;

REVOKE ALL PRIVILEGES ON TYPE public.topic_status FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TYPE public.topic_status FROM hzense_topic_sync;

GRANT USAGE ON TYPE public.topic_status TO hzense_topic_sync;
GRANT SELECT ON TABLE public.hzense_schema_migrations TO hzense_topic_sync;
GRANT SELECT, INSERT, UPDATE ON TABLE public.topics TO hzense_topic_sync;

-- Keep future migration-owned objects closed. PostgreSQL's built-in PUBLIC
-- defaults for functions and types are global; clear the current migration
-- owner's global defaults first, then clear any public-schema additions.
-- Any future runtime role must get independently reviewed direct grants.
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON TABLES FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES
  REVOKE USAGE ON TYPES FROM hzense_topic_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE ON TYPES FROM hzense_topic_sync;

-- Fail the transaction if the effective ACL differs from the preflight contract.
DO $hzense_topic_sync_postcondition$
DECLARE
  target_database name := current_database();
  sync_role_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'hzense_topic_sync');
  relation_info record;
BEGIN
  IF NOT has_database_privilege('hzense_topic_sync', target_database, 'CONNECT')
     OR has_database_privilege('hzense_topic_sync', target_database, 'CONNECT WITH GRANT OPTION')
     OR has_database_privilege('hzense_topic_sync', target_database, 'CREATE')
     OR has_database_privilege('hzense_topic_sync', target_database, 'TEMPORARY') THEN
    RAISE EXCEPTION 'hzense_topic_sync database privileges are not CONNECT-only';
  END IF;
  IF NOT has_schema_privilege('hzense_topic_sync', 'public', 'USAGE')
     OR has_schema_privilege('hzense_topic_sync', 'public', 'USAGE WITH GRANT OPTION')
     OR has_schema_privilege('hzense_topic_sync', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'hzense_topic_sync public Schema privileges are not USAGE-only';
  END IF;
  IF NOT has_type_privilege('hzense_topic_sync', 'public.topic_status', 'USAGE')
     OR has_type_privilege(
       'hzense_topic_sync',
       'public.topic_status',
       'USAGE WITH GRANT OPTION'
     ) THEN
    RAISE EXCEPTION 'hzense_topic_sync topic_status privileges are not USAGE-only';
  END IF;

  FOR relation_info IN
    SELECT table_info.oid,
           table_info.relname
    FROM pg_class AS table_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
    WHERE namespace_info.nspname = 'public'
      AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF relation_info.relname = 'topics' THEN
      IF NOT has_table_privilege('hzense_topic_sync', relation_info.oid, 'SELECT')
         OR NOT has_table_privilege('hzense_topic_sync', relation_info.oid, 'INSERT')
         OR NOT has_table_privilege('hzense_topic_sync', relation_info.oid, 'UPDATE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'DELETE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRUNCATE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'REFERENCES')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRIGGER')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'MAINTAIN') THEN
        RAISE EXCEPTION 'hzense_topic_sync topics privileges differ from SELECT/INSERT/UPDATE';
      END IF;
    ELSIF relation_info.relname = 'hzense_schema_migrations' THEN
      IF NOT has_table_privilege('hzense_topic_sync', relation_info.oid, 'SELECT')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'INSERT')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'UPDATE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'DELETE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRUNCATE')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'REFERENCES')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRIGGER')
         OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'MAINTAIN') THEN
        RAISE EXCEPTION 'hzense_topic_sync migration-history privileges differ from SELECT';
      END IF;
    ELSIF has_table_privilege('hzense_topic_sync', relation_info.oid, 'SELECT')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'INSERT')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'UPDATE')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'DELETE')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRUNCATE')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'REFERENCES')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'TRIGGER')
       OR has_table_privilege('hzense_topic_sync', relation_info.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION
        'hzense_topic_sync has privileges on unrelated public relation %',
        relation_info.relname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS sequence_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = sequence_info.relnamespace
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND sequence_info.relkind = 'S'
      AND (
        has_sequence_privilege('hzense_topic_sync', sequence_info.oid, 'USAGE')
        OR has_sequence_privilege('hzense_topic_sync', sequence_info.oid, 'SELECT')
        OR has_sequence_privilege('hzense_topic_sync', sequence_info.oid, 'UPDATE')
      )
  ) THEN
    RAISE EXCEPTION 'hzense_topic_sync must not have Sequence privileges';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS table_info
    JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
    JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
    CROSS JOIN LATERAL aclexplode(column_info.attacl) AS acl_info
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped
      AND acl_info.grantee IN (0, sync_role_oid)
  ) THEN
    RAISE EXCEPTION 'PUBLIC or hzense_topic_sync column privileges remain';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS default_acl
    CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
    WHERE acl_info.grantee IN (0, sync_role_oid)
      AND default_acl.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
  ) THEN
    RAISE EXCEPTION
      'PUBLIC or hzense_topic_sync future Table/Sequence/Function/Type grants remain for the migration owner';
  END IF;
END
$hzense_topic_sync_postcondition$;

COMMIT;
