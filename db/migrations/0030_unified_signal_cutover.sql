-- Default closed. No business grants, backfill or cutover in this migration.
CREATE TABLE public.unified_signal_cutover (
  singleton boolean PRIMARY KEY CHECK (singleton),
  ready boolean NOT NULL DEFAULT false,
  plan_hash text,
  CHECK (((NOT ready AND plan_hash IS NULL) OR
    (ready AND plan_hash COLLATE "C" ~ '^[a-f0-9]{64}$')) IS TRUE)
);
INSERT INTO public.unified_signal_cutover(singleton) VALUES(true);
REVOKE ALL ON public.unified_signal_cutover FROM PUBLIC;
ALTER TABLE public.editorial_signal_revisions ADD COLUMN unified_content jsonb;

-- Canonical JSON shared with the JS plan: sorted object keys, no insignificant
-- whitespace. Inputs use finite JSON numbers and fixed ASCII property names.
CREATE FUNCTION public.hzense_unified_canonical(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,pg_temp
AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN '{' || COALESCE((SELECT string_agg(to_jsonb(key)::text || ':' ||
      public.hzense_unified_canonical(val), ',' ORDER BY key COLLATE "C")
      FROM jsonb_each(value) AS e(key,val)), '') || '}'
    WHEN 'array' THEN '[' || COALESCE((SELECT string_agg(public.hzense_unified_canonical(val), ',' ORDER BY ord)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val,ord)), '') || ']'
    ELSE value::text END
$$;

-- Trigger-only owner capability: the application receives INSERT on exactly one
-- additional input column, never direct writes to unified tables or EXECUTE.
CREATE FUNCTION public.hzense_write_unified_editorial() RETURNS trigger
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
  state := CASE NEW.action WHEN 'publish' THEN 'published' WHEN 'withdraw' THEN 'withdrawn' ELSE 'draft' END;
  basis := CASE WHEN NEW.action='draft' THEN NULL ELSE 'manual_confirmation' END;
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
    encode(sha256(convert_to(public.hzense_unified_canonical(payload),'UTF8')),'hex'),'Editorial confirmation');
  RETURN NULL;
END
$$;

-- Once activated, an old application cannot commit an audit-only publication.
CREATE FUNCTION public.hzense_require_unified_editorial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'editorial_signal_revisions'
    OR TG_OP<>'INSERT' OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW' OR TG_NARGS<>0 THEN
    RAISE EXCEPTION 'invalid unified trigger context' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.unified_signal_cutover WHERE singleton AND ready)
    AND NOT EXISTS(SELECT 1 FROM public.signal_versions v WHERE
      v.signal_id='editorial-' || md5(NEW.run_id::text || ':' || NEW.candidate_index::text)
      AND v.version=NEW.revision AND v.schema_version='4.0.0'
      AND v.source_record=jsonb_build_object('table','editorial_signal_revisions','key',NEW.request_id)
      AND v.content=NEW.unified_content) THEN
    RAISE EXCEPTION 'unified publication required' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.hzense_unified_canonical(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_write_unified_editorial() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_require_unified_editorial() FROM PUBLIC;
CREATE TRIGGER editorial_unified_write_trg AFTER INSERT ON public.editorial_signal_revisions
FOR EACH ROW EXECUTE FUNCTION public.hzense_write_unified_editorial();
CREATE CONSTRAINT TRIGGER editorial_unified_required_trg AFTER INSERT ON public.editorial_signal_revisions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hzense_require_unified_editorial();
ALTER TABLE public.editorial_signal_revisions ENABLE ALWAYS TRIGGER editorial_unified_write_trg;
ALTER TABLE public.editorial_signal_revisions ENABLE ALWAYS TRIGGER editorial_unified_required_trg;

CREATE VIEW public.unified_public_signals WITH (security_barrier=true) AS
SELECT s.id AS signal_id,v.version,v.origin,v.publication_basis,v.content,v.recorded_at
FROM public.signals s JOIN public.signal_versions v ON v.signal_id=s.id AND v.version=s.latest_version
WHERE s.storage_schema='4.0.0' AND v.schema_version='4.0.0' AND v.lifecycle_status='published'
AND EXISTS(SELECT 1 FROM public.unified_signal_cutover WHERE singleton AND ready);
CREATE VIEW public.unified_public_status WITH (security_barrier=true) AS
SELECT ready FROM public.unified_signal_cutover WHERE singleton;
REVOKE ALL ON public.unified_public_signals,public.unified_public_status FROM PUBLIC;
