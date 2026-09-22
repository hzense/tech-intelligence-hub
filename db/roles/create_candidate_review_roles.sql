-- Neon-only credential creation candidate: the administrator must submit it.
-- Run on production main / neondb as neondb_owner after reviewing the target.
-- Never run automatically in production from migrations, startup, CI or a probe.
-- Creates four new empty logins; grants are applied later on main / hzense.
-- The result contains SECRETS. Keep it out of chat, files, screenshots and Git.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
SET LOCAL password_encryption = 'scram-sha-256';
SET LOCAL createrole_self_grant = '';
DO $guard$
DECLARE
  role_name text;
BEGIN
  IF current_database()<>'neondb' OR session_user<>'neondb_owner' OR current_user<>session_user
    OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)=current_user)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcreaterole AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Expected authenticated neondb owner on the reviewed Neon main branch';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'hzense_candidate_reviewer',
    'hzense_candidate_assembler',
    'hzense_candidate_verifier',
    'hzense_publication_controller'
  ] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION '% already exists; stop without rotating or overwriting its password', role_name;
    END IF;
  END LOOP;
END;
$guard$;
CREATE TEMP TABLE candidate_role_setup_result(
  role_name text PRIMARY KEY,
  password text NOT NULL
) ON COMMIT DROP;
DO $create$
DECLARE
  role_name text;
  new_password text;
  target oid;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'hzense_candidate_reviewer',
    'hzense_candidate_assembler',
    'hzense_candidate_verifier',
    'hzense_publication_controller'
  ] LOOP
    new_password := encode(sha256(convert_to(
      gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text || role_name,
      'UTF8'
    )),'hex');
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L',
      role_name,
      new_password
    );
    target := role_name::regrole;
    IF (SELECT count(*) FROM pg_auth_members WHERE member=target OR roleid=target)<>1
      OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target OR m.roleid=target)
        AND NOT (m.roleid=target AND pg_get_userbyid(m.member)='neondb_owner'
          AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
          AND NOT m.inherit_option AND NOT m.set_option))
      OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target)
      OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass
        AND refobjid=target AND deptype IN ('o','a')) THEN
      RAISE EXCEPTION 'Unexpected membership, setting or ownership for %; credential creation rolled back', role_name;
    END IF;
    INSERT INTO pg_temp.candidate_role_setup_result VALUES (role_name,new_password);
  END LOOP;
END;
$create$;
-- In Neon SQL Editor, save each value directly as the corresponding Production
-- database URL credential. Do not copy the result into chat or a local file.
SELECT role_name,password AS "DATABASE_PASSWORD - SECRET"
FROM pg_temp.candidate_role_setup_result
ORDER BY role_name;
COMMIT;
