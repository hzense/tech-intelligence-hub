-- Manual, reviewed role creation after the 0026 migration. Never invoked by
-- startup, probes or migrations. Credentials are provisioned privately later.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
SET LOCAL createrole_self_grant = '';
DO $guard$
BEGIN
  IF session_user <> current_user
    OR current_user <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcreaterole)
  THEN RAISE EXCEPTION 'Authenticated database owner with role creation authority required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations WHERE name = '0026_automation_tasks.sql')
  THEN RAISE EXCEPTION 'Verified migration 0026 required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('hzense_automation_admin', 'hzense_insight_reader'))
  THEN RAISE EXCEPTION 'Automation role already exists; stop without replacing privileges or credentials'; END IF;
END;
$guard$;
CREATE ROLE hzense_automation_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
CREATE ROLE hzense_insight_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
COMMIT;
