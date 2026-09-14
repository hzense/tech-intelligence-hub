-- Neon-only credential creation candidate: the administrator must submit it.
-- Run on production main / neondb as neondb_owner after reviewing the target.
-- Never run automatically in production from migrations, startup, CI or a probe.
-- Creates only a new login: no AI table grants and no existing password change.
-- The result is a SECRET. Keep it out of chat, files, screenshots and Git.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
SET LOCAL password_encryption = 'scram-sha-256';
-- PostgreSQL still retains its bootstrap-superuser ADMIN-only creator grant.
-- Disable optional creator self-grants; do not try to revoke the retained grant.
SET LOCAL createrole_self_grant = '';
DO $guard$
BEGIN
  IF current_database()<>'neondb' OR session_user<>'neondb_owner' OR current_user<>session_user
    OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)=current_user)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcreaterole AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Expected authenticated neondb owner on the reviewed Neon main branch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hzense_ai_admin') THEN
    RAISE EXCEPTION 'AI role already exists; stop without rotating or overwriting its password';
  END IF;
END;
$guard$;
CREATE TEMP TABLE ai_setup_result(password text) ON COMMIT DROP;
DO $create$
DECLARE
  new_password text := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text,'UTF8')),'hex');
  target oid;
BEGIN
  EXECUTE format('CREATE ROLE hzense_ai_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',new_password);
  target := 'hzense_ai_admin'::regrole;
  IF (SELECT count(*) FROM pg_auth_members WHERE member=target OR roleid=target)<>1
    OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target OR m.roleid=target)
      AND NOT (m.roleid=target AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)) THEN
    RAISE EXCEPTION 'Unexpected AI role membership; credential creation rolled back';
  END IF;
  INSERT INTO pg_temp.ai_setup_result VALUES (new_password);
END;
$create$;
-- In Neon SQL Editor, open this SELECT result tab after COMMIT succeeds.
-- Build the approved pooled HZENSE_AI_DATABASE_URL with this password.
SELECT password AS "HZENSE_AI_DATABASE_PASSWORD - SECRET" FROM pg_temp.ai_setup_result;
COMMIT;
