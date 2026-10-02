-- Manual Neon-only role creation after 0026 was independently verified on hzense.
-- Run on the reviewed production main branch / neondb as neondb_owner.
-- neondb does not contain the application's private tables or migration ledger.
-- This creates only a restricted, password-less login, with no business ACLs.
-- Never invoke from migrations, startup or probes. Set its password privately
-- only after the separate owner-authorized configuration and read-only checks.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
-- Retain only Neon's mandatory ADMIN-only creator management edge.
SET LOCAL createrole_self_grant = '';
DO $guard$
BEGIN
  IF current_database() <> 'neondb' OR session_user <> 'neondb_owner' OR current_user <> session_user
    OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND pg_get_userbyid(datdba) = current_user)
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper)
  THEN RAISE EXCEPTION 'Expected authenticated neondb owner on the reviewed Neon main branch'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hzense_automation_admin')
  THEN RAISE EXCEPTION 'Automation admin role already exists; stop without replacing privileges or credentials'; END IF;
END;
$guard$;
CREATE ROLE hzense_automation_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
DO $verify_creator$
DECLARE target oid := 'hzense_automation_admin'::regrole;
BEGIN
  IF (SELECT count(*) FROM pg_auth_members WHERE member = target OR roleid = target) <> 1
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE (m.member = target OR m.roleid = target)
      AND (m.roleid = target AND pg_get_userbyid(m.member) = 'neondb_owner'
        AND pg_get_userbyid(m.grantor) = 'cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
  THEN RAISE EXCEPTION 'Unexpected automation admin membership; role creation rolled back'; END IF;
END;
$verify_creator$;
COMMIT;
