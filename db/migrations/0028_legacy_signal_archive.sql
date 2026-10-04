-- Preserve historical Seed records without inventing a generation run, a
-- removed strength score, or an evidence-qualified publication. Runtime roles
-- receive no privileges here; the protected migration grants the public view.
CREATE TABLE public.legacy_signal_archive (
  signal_id text PRIMARY KEY,
  signal jsonb NOT NULL,
  "references" jsonb NOT NULL,
  projection jsonb NOT NULL,
  content_hash text NOT NULL,
  record_hash text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_signal_archive_id_ck CHECK (signal_id COLLATE "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT legacy_signal_archive_signal_ck CHECK (jsonb_typeof(signal) = 'object'),
  CONSTRAINT legacy_signal_archive_signal_id_ck CHECK ((signal->>'id') IS NOT DISTINCT FROM signal_id),
  CONSTRAINT legacy_signal_archive_references_ck CHECK (jsonb_typeof("references") = 'object'),
  CONSTRAINT legacy_signal_archive_projection_ck CHECK (
    projection = 'null'::jsonb OR
    (jsonb_typeof(projection) = 'object' AND (projection->>'id') IS NOT DISTINCT FROM signal_id)
  ),
  CONSTRAINT legacy_signal_archive_hash_ck CHECK (content_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT legacy_signal_archive_record_hash_ck CHECK (record_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT legacy_signal_archive_imported_at_ck CHECK (isfinite(imported_at))
);
CREATE FUNCTION public.hzense_guard_legacy_signal_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'legacy_signal_archive'
    OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE'
    OR NOT ((TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE','DELETE'))
      OR (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')) THEN
    RAISE EXCEPTION 'Invalid legacy Signal archive trigger attachment' USING ERRCODE='55000';
  END IF;
  RAISE EXCEPTION 'Legacy Signal archive is immutable' USING ERRCODE='55000';
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_legacy_signal_archive() FROM PUBLIC;
CREATE TRIGGER legacy_signal_archive_guard_trg BEFORE UPDATE OR DELETE ON public.legacy_signal_archive
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_archive();
CREATE TRIGGER legacy_signal_archive_no_truncate_trg BEFORE TRUNCATE ON public.legacy_signal_archive
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_legacy_signal_archive();
ALTER TABLE public.legacy_signal_archive ENABLE ALWAYS TRIGGER legacy_signal_archive_guard_trg;
ALTER TABLE public.legacy_signal_archive ENABLE ALWAYS TRIGGER legacy_signal_archive_no_truncate_trg;
CREATE VIEW public.legacy_public_signals WITH (security_barrier=true) AS
SELECT signal_id, projection AS content, content_hash
FROM public.legacy_signal_archive
WHERE signal->>'status' IN ('accepted','reviewed')
  AND signal_id NOT LIKE 'editorial-%'
  AND jsonb_typeof(projection) = 'object';
REVOKE ALL ON public.legacy_signal_archive, public.legacy_public_signals FROM PUBLIC;
DO $private_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public' AND r.relname IN ('legacy_signal_archive','legacy_public_signals') AND a.grantee<>r.relowner)
  THEN RAISE EXCEPTION 'Legacy Signal archive requires owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
