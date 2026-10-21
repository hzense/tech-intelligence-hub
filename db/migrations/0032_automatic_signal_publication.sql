-- Capability preparation only: no grants, task replay, publication or production cutover.
-- Historical revisions retain the original manual confirmation basis and hashes.
ALTER TABLE public.editorial_signal_revisions
  ADD COLUMN publication_basis text NOT NULL DEFAULT 'manual_confirmation',
  ADD CONSTRAINT editorial_signal_revisions_publication_basis_ck CHECK (
    publication_basis='manual_confirmation' OR
    (publication_basis='automatic_checks' AND action='publish' AND revision=1));

ALTER TABLE public.signal_versions DROP CONSTRAINT signal_versions_storage_shape_ck;
ALTER TABLE public.signal_versions ADD CONSTRAINT signal_versions_storage_shape_ck CHECK ((
    (schema_version='3.0.0' AND title IS NOT NULL AND type IS NOT NULL AND occurred_at IS NOT NULL AND date_precision IS NOT NULL AND date_basis IS NOT NULL AND captured_at IS NOT NULL AND summary IS NOT NULL AND importance IS NOT NULL AND strength IS NOT NULL AND confidence IS NOT NULL AND novelty IS NOT NULL
      AND content IS NULL AND publication_basis IS NULL AND lifecycle_status IS NULL AND recorded_at IS NULL AND source_record IS NULL AND source_record_hash IS NULL)
    OR
    (schema_version='4.0.0' AND title IS NULL AND type IS NULL AND occurred_at IS NULL AND date_precision IS NULL AND date_basis IS NULL AND captured_at IS NULL AND summary IS NULL AND analysis IS NULL AND importance IS NULL AND strength IS NULL AND confidence IS NULL AND novelty IS NULL AND legacy_status IS NULL
      AND jsonb_typeof(content)='object'
      AND lifecycle_status IN ('draft','published','withdrawn')
      AND ((lifecycle_status='draft' AND publication_basis IS NULL)
        OR (lifecycle_status IN ('published','withdrawn') AND
          ((origin='legacy_seed' AND publication_basis='legacy_import') OR
           (origin='ai_generation' AND publication_basis IN ('manual_confirmation','automatic_checks')))))
      AND (recorded_at IS NULL OR isfinite(recorded_at))
      AND jsonb_typeof(source_record)='object'
      AND source_record_hash COLLATE "C" ~ '^[a-f0-9]{64}$')
  ) IS TRUE);

CREATE FUNCTION public.hzense_guard_automatic_editorial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $auto$
DECLARE saved record; candidate jsonb;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'editorial_signal_revisions'
    OR TG_OP<>'INSERT' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' OR TG_NARGS<>0 THEN
    RAISE EXCEPTION 'invalid automatic publication trigger context' USING ERRCODE='55000';
  END IF;
  IF NEW.publication_basis<>'automatic_checks' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.run_id::text,0));
  SELECT snapshot,result INTO saved FROM public.signal_generation_runs
    WHERE id=NEW.run_id AND owner_id=NEW.owner_id AND status='completed' AND deleted_at IS NULL;
  IF NOT FOUND OR NEW.action<>'publish' OR NEW.revision<>1 OR NEW.unified_content IS NULL
    OR saved.snapshot#>>'{publication,mode}' IS DISTINCT FROM 'automatic'
    OR saved.snapshot#>>'{publication,policy}' IS DISTINCT FROM 'auto-publication-v1'
    OR EXISTS(SELECT 1 FROM public.editorial_signal_revisions
      WHERE run_id=NEW.run_id AND candidate_index=NEW.candidate_index) THEN
    RAISE EXCEPTION 'automatic publication not authorized' USING ERRCODE='23514';
  END IF;
  SELECT value INTO candidate FROM jsonb_array_elements(saved.result->'candidates')
    WHERE value->>'index'=NEW.candidate_index::text;
  IF candidate IS NULL OR candidate->>'title' IS DISTINCT FROM NEW.content->>'title'
    OR candidate->>'summary' IS DISTINCT FROM NEW.content->>'summary'
    OR jsonb_typeof(NEW.content->'sourceUrls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.content->'sourceUrls')=0
    OR jsonb_typeof(saved.snapshot#>'{publication,sourceUrls}') IS DISTINCT FROM 'array'
    OR NOT ((saved.snapshot#>'{publication,sourceUrls}') @> (NEW.content->'sourceUrls')) THEN
    RAISE EXCEPTION 'automatic publication content mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$auto$;
REVOKE ALL ON FUNCTION public.hzense_guard_automatic_editorial() FROM PUBLIC;
CREATE TRIGGER editorial_automatic_guard_trg BEFORE INSERT ON public.editorial_signal_revisions
FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_automatic_editorial();
ALTER TABLE public.editorial_signal_revisions ENABLE ALWAYS TRIGGER editorial_automatic_guard_trg;

CREATE OR REPLACE FUNCTION public.hzense_write_unified_editorial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $$
DECLARE sid text; source jsonb; payload jsonb; previous integer; state text; basis text;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'editorial_signal_revisions'
    OR TG_OP<>'INSERT' OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW' OR TG_NARGS<>0 THEN
    RAISE EXCEPTION 'invalid unified trigger context' USING ERRCODE='55000';
  END IF;
  IF NEW.unified_content IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.unified_signal_cutover WHERE singleton AND ready) THEN
    RAISE EXCEPTION 'unified storage not ready' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(NEW.unified_content) IS DISTINCT FROM 'object'
    OR NEW.unified_content->>'title' IS DISTINCT FROM NEW.content->>'title'
    OR NEW.unified_content->>'summary' IS DISTINCT FROM NEW.content->>'summary'
    OR NEW.unified_content->>'occurred_at' IS DISTINCT FROM NEW.content->>'eventDate'
    OR NEW.unified_content->'topics' IS DISTINCT FROM NEW.content->'topics'
    OR NEW.unified_content->>'type' IS DISTINCT FROM NEW.content->>'signalType' THEN
    RAISE EXCEPTION 'unified content mismatch' USING ERRCODE='23514';
  END IF;
  sid := 'editorial-' || md5(NEW.run_id::text || ':' || NEW.candidate_index::text);
  -- Same per-run serialization key as the application; also protects direct SQL.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.run_id::text,0));
  SELECT latest_version INTO previous FROM public.signals WHERE id=sid FOR UPDATE;
  IF COALESCE(previous,0)<>NEW.revision-1 THEN
    RAISE EXCEPTION 'unified revision conflict' USING ERRCODE='40001';
  END IF;
  IF NEW.action='withdraw' AND NOT EXISTS(SELECT 1 FROM public.signal_versions
    WHERE signal_id=sid AND version=previous AND lifecycle_status='published'
      AND content=NEW.unified_content) THEN
    RAISE EXCEPTION 'unified withdrawal conflict' USING ERRCODE='23514';
  END IF;
  IF NEW.action='draft' AND EXISTS(SELECT 1 FROM public.signal_versions
    WHERE signal_id=sid AND version=previous AND lifecycle_status='published') THEN
    RAISE EXCEPTION 'unified published draft forbidden' USING ERRCODE='23514';
  END IF;
  source := jsonb_build_object('request_id',NEW.request_id,'run_id',NEW.run_id,
    'owner_id',NEW.owner_id,'candidate_index',NEW.candidate_index,'revision',NEW.revision,
    'material_hash',NEW.material_hash,'action',NEW.action,'content',NEW.content,
    'request_hash',NEW.request_hash,'created_at',to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  IF NEW.publication_basis='automatic_checks' THEN
    source := source || jsonb_build_object('publication_basis','automatic_checks');
  END IF;
  state := CASE NEW.action WHEN 'publish' THEN 'published' WHEN 'withdraw' THEN 'withdrawn' ELSE 'draft' END;
  basis := CASE WHEN NEW.action='draft' THEN NULL ELSE NEW.publication_basis END;
  payload := jsonb_build_object('signal_id',sid,'version',NEW.revision,'schema_version','4.0.0',
    'origin','ai_generation','publication_basis',basis,'status',state,
    'recorded_at',source->'created_at',
    'source_record',jsonb_build_object('table','editorial_signal_revisions','key',NEW.request_id),
    'source_record_hash',encode(sha256(convert_to(public.hzense_unified_canonical(source),'UTF8')),'hex'),
    'content',NEW.unified_content);
  IF previous IS NULL THEN
    INSERT INTO public.signals(id,storage_schema,origin,latest_version,status,captured_at,metadata)
    VALUES(sid,'4.0.0','ai_generation',NEW.revision,NULL,NULL,NULL);
  ELSE
    UPDATE public.signals SET latest_version=NEW.revision WHERE id=sid;
  END IF;
  INSERT INTO public.signal_versions(signal_id,version,schema_version,origin,content,
    publication_basis,lifecycle_status,recorded_at,source_record,source_record_hash,content_hash,revision_reason)
  VALUES(sid,NEW.revision,'4.0.0','ai_generation',NEW.unified_content,basis,state,NEW.created_at,
    payload->'source_record',payload->>'source_record_hash',
    encode(sha256(convert_to(public.hzense_unified_canonical(payload),'UTF8')),'hex'),CASE NEW.publication_basis WHEN 'automatic_checks' THEN 'Automatic publication checks' ELSE 'Editorial confirmation' END);
  RETURN NULL;
END
$$;

CREATE OR REPLACE VIEW public.editorial_public_signals WITH (security_barrier=true) AS
SELECT 'editorial-' || md5(latest.run_id::text || ':' || latest.candidate_index::text) AS signal_id,
  latest.revision, latest.content, latest.created_at AS published_at, latest.publication_basis
FROM (
  SELECT DISTINCT ON (run_id,candidate_index) run_id,candidate_index,revision,action,content,created_at,publication_basis
  FROM public.editorial_signal_revisions ORDER BY run_id,candidate_index,revision DESC
) latest WHERE latest.action='publish';

