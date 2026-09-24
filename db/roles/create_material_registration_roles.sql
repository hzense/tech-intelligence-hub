-- Manual reviewed role creation only. Never run from migration/startup/probes.
-- Creates passwordless restricted logins. Provision credentials privately through
-- the administrator's secret-management workflow; no password value is emitted.
-- Fails if either role exists; does not rotate credentials or repair existing roles.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='20s';
SET LOCAL createrole_self_grant='';
DO $owner$
BEGIN
 IF current_user<>session_user
   OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcreaterole)
 THEN RAISE EXCEPTION 'Authenticated database owner with role-creation authority required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('hzense_material_registrar','hzense_material_verifier'))
 THEN RAISE EXCEPTION 'Material role already exists; stop without replacing credentials or privileges'; END IF;
END;
$owner$;
CREATE ROLE hzense_material_registrar LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
CREATE ROLE hzense_material_verifier LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD NULL;
DO $empty$
DECLARE role_name text; target oid;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['hzense_material_registrar','hzense_material_verifier'] LOOP
   target := role_name::regrole;
   IF EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target OR m.roleid=target)
      AND (m.roleid=target AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
     OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target)
     OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target AND deptype IN ('o','a'))
   THEN RAISE EXCEPTION 'Unexpected role membership, settings, ownership or grants'; END IF;
 END LOOP;
END;
$empty$;
COMMIT;
