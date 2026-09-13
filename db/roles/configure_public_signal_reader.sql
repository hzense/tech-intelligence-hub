-- Optional V3 reader increment, AFTER the legacy Runtime role has been verified
-- and migration 0012 validated. Existing legacy FTS preflight intentionally does
-- not accept these new capabilities; use the V3 contract after this transition.
-- No raw/private Signal tables, seal function or publisher locks are granted.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $reader$
DECLARE target pg_roles%ROWTYPE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF session_user<>current_user OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>current_user THEN
    RAISE EXCEPTION 'Authenticated database owner required';
  END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname='hzense_runtime';
  IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolsuper OR target.rolcreatedb
    OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN RAISE EXCEPTION 'Verified restricted Runtime role required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0012_current_signal_publication.sql') THEN RAISE EXCEPTION 'Verified 0012 required'; END IF;
END;
$reader$;
GRANT SELECT ON TABLE public.current_public_signals TO hzense_runtime;
GRANT EXECUTE ON FUNCTION public.hzense_public_signal_is_current(uuid) TO hzense_runtime;
COMMIT;
