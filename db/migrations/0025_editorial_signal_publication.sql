-- Human confirmation is a separate publication basis. It grants no verified
-- evidence, entity links, verifier attestations or qualified-publication permit.
CREATE UNIQUE INDEX signal_generation_id_owner_uq ON public.signal_generation_runs(id,owner_id);
CREATE TABLE public.editorial_signal_revisions (
  request_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  candidate_index integer NOT NULL CHECK (candidate_index BETWEEN 0 AND 4),
  revision integer NOT NULL CHECK (revision > 0),
  material_hash text NOT NULL CHECK (material_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action IN ('draft','publish','withdraw')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  request_hash text NOT NULL CHECK (request_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id,owner_id) REFERENCES public.signal_generation_runs(id,owner_id),
  UNIQUE (run_id,candidate_index,revision)
);
CREATE FUNCTION public.hzense_guard_editorial_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'editorial_signal_revisions'
    OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE'
    OR NOT ((TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE','DELETE'))
      OR (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')) THEN
    RAISE EXCEPTION 'Invalid editorial history trigger attachment' USING ERRCODE='55000';
  END IF;
  RAISE EXCEPTION 'Editorial history is append-only' USING ERRCODE='55000';
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_editorial_history() FROM PUBLIC;
CREATE TRIGGER editorial_signal_revisions_guard_trg BEFORE UPDATE OR DELETE ON public.editorial_signal_revisions
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_editorial_history();
CREATE TRIGGER editorial_signal_revisions_no_truncate_trg BEFORE TRUNCATE ON public.editorial_signal_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_editorial_history();
ALTER TABLE public.editorial_signal_revisions ENABLE ALWAYS TRIGGER editorial_signal_revisions_guard_trg;
ALTER TABLE public.editorial_signal_revisions ENABLE ALWAYS TRIGGER editorial_signal_revisions_no_truncate_trg;
-- Shares the generation deletion lock with the editorial writer. A generation
-- task must remain available while one of its candidates is publicly visible.
CREATE FUNCTION public.hzense_guard_editorial_generation_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $delete_guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_generation_runs'
    OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Invalid editorial deletion trigger attachment' USING ERRCODE='55000';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(OLD.id::text,0));
    IF EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (candidate_index) action
        FROM public.editorial_signal_revisions WHERE run_id=OLD.id
        ORDER BY candidate_index,revision DESC
      ) latest WHERE action='publish'
    ) THEN
      RAISE EXCEPTION 'published_candidate_delete_forbidden' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$delete_guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_editorial_generation_delete() FROM PUBLIC;
CREATE TRIGGER signal_generation_editorial_delete_guard_trg BEFORE UPDATE ON public.signal_generation_runs
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_editorial_generation_delete();
ALTER TABLE public.signal_generation_runs ENABLE ALWAYS TRIGGER signal_generation_editorial_delete_guard_trg;
CREATE VIEW public.editorial_public_signals WITH (security_barrier=true) AS
SELECT 'editorial-' || md5(latest.run_id::text || ':' || latest.candidate_index::text) AS signal_id,
  latest.revision, latest.content, latest.created_at AS published_at
FROM (
  SELECT DISTINCT ON (run_id,candidate_index) run_id,candidate_index,revision,action,content,created_at
  FROM public.editorial_signal_revisions
  ORDER BY run_id,candidate_index,revision DESC
) latest
WHERE latest.action='publish';
REVOKE ALL ON public.editorial_signal_revisions,public.editorial_public_signals FROM PUBLIC;
DO $private_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public' AND r.relname IN ('editorial_signal_revisions','editorial_public_signals') AND a.grantee<>r.relowner)
  THEN RAISE EXCEPTION 'Editorial relations require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
