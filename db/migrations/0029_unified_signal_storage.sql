-- Unified storage phase B: additive, no backfill, grants or public reader cutover.
-- Keep the 3.0 dependency-seal projection byte-for-byte compatible with 0028.
CREATE OR REPLACE FUNCTION public.hzense_signal_dependency_seal(p_signal_id text, p_source_version integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp SET timezone = 'UTC'
AS $seal$
  WITH identity_row AS (
    SELECT * FROM public.signal_event_identities WHERE signal_id=p_signal_id
  ), evidence_ids AS (
    SELECT evidence_id FROM public.signal_version_evidence
    WHERE signal_id=p_signal_id AND version IN (p_source_version, (SELECT basis_version FROM identity_row))
  ), people_ids AS (
    SELECT person_id FROM public.signal_version_people WHERE signal_id=p_signal_id AND version=p_source_version
  ), organization_ids AS (
    SELECT organization_id FROM public.signal_version_organizations WHERE signal_id=p_signal_id AND version=p_source_version
  )
  SELECT jsonb_build_object(
    'snapshot', (SELECT to_jsonb(r)-ARRAY['content','publication_basis','lifecycle_status','recorded_at','source_record','source_record_hash']::text[] FROM public.signal_versions r WHERE signal_id=p_signal_id AND version=p_source_version),
    'identity', (SELECT to_jsonb(r) FROM identity_row r),
    'evidence_links', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY version, evidence_id COLLATE "C") FROM public.signal_version_evidence r WHERE signal_id=p_signal_id AND version IN (p_source_version, (SELECT basis_version FROM identity_row))), '[]'::jsonb),
    'people_links', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY person_id COLLATE "C", evidence_id COLLATE "C") FROM public.signal_version_people r WHERE signal_id=p_signal_id AND version=p_source_version), '[]'::jsonb),
    'organization_links', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY organization_id COLLATE "C", evidence_id COLLATE "C") FROM public.signal_version_organizations r WHERE signal_id=p_signal_id AND version=p_source_version), '[]'::jsonb),
    'topic_links', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY topic_id COLLATE "C") FROM public.signal_version_topics r WHERE signal_id=p_signal_id AND version=p_source_version), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id COLLATE "C") FROM public.sources r WHERE id IN (SELECT source_id FROM public.public_source_evidence WHERE id IN (SELECT evidence_id FROM evidence_ids))), '[]'::jsonb),
    'evidence', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id COLLATE "C") FROM public.public_source_evidence r WHERE id IN (SELECT evidence_id FROM evidence_ids)), '[]'::jsonb),
    'entities', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id COLLATE "C") FROM public.entities r WHERE id IN (SELECT person_id FROM people_ids UNION SELECT organization_id FROM organization_ids)), '[]'::jsonb),
    'person_profiles', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY entity_id COLLATE "C") FROM public.person_profiles r WHERE entity_id IN (SELECT person_id FROM people_ids)), '[]'::jsonb),
    'organization_profiles', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY entity_id COLLATE "C") FROM public.organization_profiles r WHERE entity_id IN (SELECT organization_id FROM organization_ids)), '[]'::jsonb),
    'topics', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id COLLATE "C") FROM public.topics r WHERE id IN (SELECT topic_id FROM public.signal_version_topics WHERE signal_id=p_signal_id AND version=p_source_version)), '[]'::jsonb)
  );
$seal$;
-- Existing 3.0 snapshots keep their bytes and sealing guards. New 4.0 writes are
-- restricted to the table owner until a separately reviewed writer is introduced.
ALTER TABLE public.signals
  ADD COLUMN storage_schema text NOT NULL DEFAULT '3.0.0',
  ADD COLUMN origin text,
  ADD COLUMN latest_version integer,
  ALTER COLUMN title DROP NOT NULL,
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN occurred_at DROP NOT NULL,
  ALTER COLUMN captured_at DROP NOT NULL,
  ALTER COLUMN source_id DROP NOT NULL,
  ALTER COLUMN source_url DROP NOT NULL,
  ALTER COLUMN summary DROP NOT NULL,
  ALTER COLUMN importance DROP NOT NULL,
  ALTER COLUMN strength DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN novelty DROP NOT NULL,
  ALTER COLUMN metadata DROP NOT NULL,
  ADD CONSTRAINT signals_storage_shape_ck CHECK ((
    (storage_schema='3.0.0' AND origin IS NULL AND latest_version IS NULL
      AND title IS NOT NULL AND type IS NOT NULL AND status IS NOT NULL AND occurred_at IS NOT NULL AND captured_at IS NOT NULL AND source_id IS NOT NULL AND source_url IS NOT NULL AND summary IS NOT NULL AND importance IS NOT NULL AND strength IS NOT NULL AND confidence IS NOT NULL AND novelty IS NOT NULL AND metadata IS NOT NULL)
    OR
    (storage_schema='4.0.0' AND origin IN ('legacy_seed','ai_generation')
      AND latest_version>0 AND id COLLATE "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(id)<=200
      AND title IS NULL AND type IS NULL AND status IS NULL AND occurred_at IS NULL AND captured_at IS NULL AND source_id IS NULL AND source_url IS NULL AND summary IS NULL AND importance IS NULL AND strength IS NULL AND confidence IS NULL AND novelty IS NULL AND metadata IS NULL)
  ) IS TRUE);
-- Legacy defaults remain for old writers; the new writer must explicitly insert
-- NULL status/captured_at/metadata rather than accepting legacy defaults.

ALTER TABLE public.signal_versions
  ALTER COLUMN title DROP NOT NULL,
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN occurred_at DROP NOT NULL,
  ALTER COLUMN date_precision DROP NOT NULL,
  ALTER COLUMN date_basis DROP NOT NULL,
  ALTER COLUMN captured_at DROP NOT NULL,
  ALTER COLUMN summary DROP NOT NULL,
  ALTER COLUMN importance DROP NOT NULL,
  ALTER COLUMN strength DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN novelty DROP NOT NULL,
  ADD COLUMN content jsonb,
  ADD COLUMN publication_basis text,
  ADD COLUMN lifecycle_status text,
  ADD COLUMN recorded_at timestamptz,
  ADD COLUMN source_record jsonb,
  ADD COLUMN source_record_hash text,
  DROP CONSTRAINT signal_versions_schema_version_ck,
  DROP CONSTRAINT signal_versions_origin_ck,
  DROP CONSTRAINT signal_versions_legacy_status_ck,
  ADD CONSTRAINT signal_versions_schema_version_ck CHECK (schema_version IN ('3.0.0','4.0.0')),
  ADD CONSTRAINT signal_versions_origin_ck CHECK (
    (schema_version='3.0.0' AND origin IN ('legacy_seed','pipeline','manual')) OR
    (schema_version='4.0.0' AND origin IN ('legacy_seed','ai_generation'))),
  ADD CONSTRAINT signal_versions_legacy_status_ck CHECK (
    schema_version<>'3.0.0' OR ((origin='legacy_seed')=(legacy_status IS NOT NULL))),
  ADD CONSTRAINT signal_versions_storage_shape_ck CHECK ((
    (schema_version='3.0.0' AND title IS NOT NULL AND type IS NOT NULL AND occurred_at IS NOT NULL AND date_precision IS NOT NULL AND date_basis IS NOT NULL AND captured_at IS NOT NULL AND summary IS NOT NULL AND importance IS NOT NULL AND strength IS NOT NULL AND confidence IS NOT NULL AND novelty IS NOT NULL
      AND content IS NULL AND publication_basis IS NULL AND lifecycle_status IS NULL AND recorded_at IS NULL AND source_record IS NULL AND source_record_hash IS NULL)
    OR
    (schema_version='4.0.0' AND title IS NULL AND type IS NULL AND occurred_at IS NULL AND date_precision IS NULL AND date_basis IS NULL AND captured_at IS NULL AND summary IS NULL AND analysis IS NULL AND importance IS NULL AND strength IS NULL AND confidence IS NULL AND novelty IS NULL AND legacy_status IS NULL
      AND jsonb_typeof(content)='object'
      AND lifecycle_status IN ('draft','published','withdrawn')
      AND ((lifecycle_status='draft' AND publication_basis IS NULL)
        OR (lifecycle_status IN ('published','withdrawn') AND
          ((origin='legacy_seed' AND publication_basis='legacy_import') OR
           (origin='ai_generation' AND publication_basis='manual_confirmation'))))
      AND (recorded_at IS NULL OR isfinite(recorded_at))
      AND jsonb_typeof(source_record)='object'
      AND source_record_hash COLLATE "C" ~ '^[a-f0-9]{64}$')
  ) IS TRUE);

ALTER TABLE public.signals ADD CONSTRAINT signals_latest_version_fk
  FOREIGN KEY (id,latest_version) REFERENCES public.signal_versions(signal_id,version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.hzense_guard_unified_signal_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  parent public.signals%ROWTYPE;
  owner_name name;
  row_schema text;
  value jsonb;
  key_name text;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW'
    OR TG_NARGS<>0 OR TG_OP NOT IN ('INSERT','UPDATE','DELETE')
    OR TG_TABLE_NAME NOT IN ('signals','signal_versions') THEN
    RAISE EXCEPTION 'Invalid unified storage guard attachment' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='signals' THEN
    IF TG_OP='UPDATE' AND (NEW.storage_schema IS DISTINCT FROM OLD.storage_schema
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.origin IS DISTINCT FROM OLD.origin) THEN
      RAISE EXCEPTION 'Signal storage identity cannot change' USING ERRCODE='55000';
    END IF;
    row_schema := CASE WHEN TG_OP='DELETE' THEN OLD.storage_schema ELSE NEW.storage_schema END;
  ELSE
    SELECT * INTO parent FROM public.signals WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.signal_id ELSE NEW.signal_id END;
    row_schema := CASE WHEN TG_OP='DELETE' THEN OLD.schema_version ELSE NEW.schema_version END;
    IF parent.id IS NULL OR parent.storage_schema IS DISTINCT FROM row_schema
      OR (row_schema='4.0.0' AND parent.origin IS DISTINCT FROM
        CASE WHEN TG_OP='DELETE' THEN OLD.origin ELSE NEW.origin END) THEN
      RAISE EXCEPTION 'Signal version storage identity mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF row_schema='4.0.0' THEN
    SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
    IF current_user IS DISTINCT FROM owner_name THEN
      RAISE EXCEPTION 'Unified Signal writer is not enabled' USING ERRCODE='42501';
    END IF;
    IF TG_TABLE_NAME='signal_versions' AND TG_OP<>'DELETE' THEN
      -- Storage envelope only. The application contract remains the full content
      -- validator; no general-purpose writer or public publication is enabled.
      IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'object'
        OR NOT (NEW.content ?& ARRAY['title','summary','type','occurred_at','captured_at',
          'importance','confidence','novelty','people','organizations','topics','sources','related_entities'])
        OR (SELECT count(*) FROM jsonb_object_keys(NEW.content))<>13
        OR jsonb_typeof(NEW.content->'title') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW.content->'summary') IS DISTINCT FROM 'string'
        OR btrim(NEW.content->>'title')='' OR btrim(NEW.content->>'summary')=''
      THEN RAISE EXCEPTION 'Invalid unified content envelope' USING ERRCODE='23514'; END IF;
      FOREACH key_name IN ARRAY ARRAY['people','organizations','topics','sources','related_entities'] LOOP
        IF jsonb_typeof(NEW.content->key_name) IS DISTINCT FROM 'array'
          OR jsonb_array_length(NEW.content->key_name)>1000 THEN
          RAISE EXCEPTION 'Invalid unified content array' USING ERRCODE='23514';
        END IF;
      END LOOP;
      FOREACH key_name IN ARRAY ARRAY['importance','confidence','novelty'] LOOP
        value := NEW.content->key_name;
        IF value<>'null'::jsonb THEN
          IF jsonb_typeof(value)<>'number' THEN
            RAISE EXCEPTION 'Invalid unified score' USING ERRCODE='23514';
          END IF;
          IF (key_name='importance' AND ((value::text)::numeric NOT BETWEEN 1 AND 5 OR
            (value::text)::numeric<>trunc((value::text)::numeric)))
            OR (key_name<>'importance' AND (value::text)::numeric NOT BETWEEN 0 AND 1) THEN
            RAISE EXCEPTION 'Invalid unified score range' USING ERRCODE='23514';
          END IF;
        END IF;
      END LOOP;
      IF jsonb_typeof(NEW.source_record) IS DISTINCT FROM 'object'
        OR NOT (NEW.source_record ?& ARRAY['table','key'])
        OR (SELECT count(*) FROM jsonb_object_keys(NEW.source_record))<>2
        OR jsonb_typeof(NEW.source_record->'key') IS DISTINCT FROM 'string'
        OR btrim(NEW.source_record->>'key')=''
        OR (NEW.source_record->>'table') IS DISTINCT FROM
          (CASE NEW.origin WHEN 'legacy_seed' THEN 'legacy_signal_archive' ELSE 'editorial_signal_revisions' END)
      THEN RAISE EXCEPTION 'Invalid unified source record' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard$;

CREATE FUNCTION public.hzense_guard_unified_signal_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  signal_key text;
  parent public.signals%ROWTYPE;
  maximum integer;
  version_count bigint;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW'
    OR TG_NARGS<>0 OR TG_OP NOT IN ('INSERT','UPDATE','DELETE')
    OR TG_TABLE_NAME NOT IN ('signals','signal_versions') THEN
    RAISE EXCEPTION 'Invalid unified head guard attachment' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='signals' THEN
    signal_key:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE signal_key:=CASE WHEN TG_OP='DELETE' THEN OLD.signal_id ELSE NEW.signal_id END; END IF;
  SELECT * INTO parent FROM public.signals WHERE id=signal_key;
  IF parent.storage_schema='4.0.0' THEN
    SELECT max(version),count(*) INTO maximum,version_count FROM public.signal_versions WHERE signal_id=signal_key;
    IF maximum IS DISTINCT FROM parent.latest_version OR version_count<>maximum THEN
      RAISE EXCEPTION 'Unified head must point to complete latest history' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$guard$;

-- All existing publication paths remain 3.0-only, including master edges.
CREATE FUNCTION public.hzense_guard_legacy_signal_link() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW'
    OR TG_NARGS<>0 OR TG_OP NOT IN ('INSERT','UPDATE')
    OR TG_TABLE_NAME NOT IN ('signal_topics','signal_entities','signal_version_evidence',
      'signal_version_people','signal_version_organizations','signal_version_topics',
      'signal_publication_outbox','signal_publication_state','candidate_review_conversions') THEN
    RAISE EXCEPTION 'Invalid legacy link guard attachment' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.signals WHERE id=NEW.signal_id AND storage_schema<>'3.0.0') THEN
    RAISE EXCEPTION 'Unified versions cannot use legacy publication paths' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_unified_signal_storage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_guard_unified_signal_head() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_guard_legacy_signal_link() FROM PUBLIC;
CREATE TRIGGER signals_unified_storage_trg BEFORE INSERT OR UPDATE OR DELETE ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_unified_signal_storage();
CREATE CONSTRAINT TRIGGER signals_unified_head_trg AFTER INSERT OR UPDATE OR DELETE ON public.signals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_unified_signal_head();
ALTER TABLE public.signals ENABLE ALWAYS TRIGGER signals_unified_storage_trg;
ALTER TABLE public.signals ENABLE ALWAYS TRIGGER signals_unified_head_trg;
CREATE TRIGGER signal_versions_unified_storage_trg BEFORE INSERT OR UPDATE OR DELETE ON public.signal_versions
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_unified_signal_storage();
CREATE CONSTRAINT TRIGGER signal_versions_unified_head_trg AFTER INSERT OR UPDATE OR DELETE ON public.signal_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_unified_signal_head();
ALTER TABLE public.signal_versions ENABLE ALWAYS TRIGGER signal_versions_unified_storage_trg;
ALTER TABLE public.signal_versions ENABLE ALWAYS TRIGGER signal_versions_unified_head_trg;
CREATE TRIGGER signal_topics_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_topics
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_topics ENABLE ALWAYS TRIGGER signal_topics_legacy_link_trg;
CREATE TRIGGER signal_entities_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_entities
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_entities ENABLE ALWAYS TRIGGER signal_entities_legacy_link_trg;
CREATE TRIGGER signal_version_evidence_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_version_evidence
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_version_evidence ENABLE ALWAYS TRIGGER signal_version_evidence_legacy_link_trg;
CREATE TRIGGER signal_version_people_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_version_people
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_version_people ENABLE ALWAYS TRIGGER signal_version_people_legacy_link_trg;
CREATE TRIGGER signal_version_organizations_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_version_organizations
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_version_organizations ENABLE ALWAYS TRIGGER signal_version_organizations_legacy_link_trg;
CREATE TRIGGER signal_version_topics_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_version_topics
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_version_topics ENABLE ALWAYS TRIGGER signal_version_topics_legacy_link_trg;
CREATE TRIGGER signal_publication_outbox_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_publication_outbox
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_publication_outbox ENABLE ALWAYS TRIGGER signal_publication_outbox_legacy_link_trg;
CREATE TRIGGER signal_publication_state_legacy_link_trg BEFORE INSERT OR UPDATE ON public.signal_publication_state
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.signal_publication_state ENABLE ALWAYS TRIGGER signal_publication_state_legacy_link_trg;
CREATE TRIGGER candidate_review_conversions_legacy_link_trg BEFORE INSERT OR UPDATE ON public.candidate_review_conversions
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_legacy_signal_link();
ALTER TABLE public.candidate_review_conversions ENABLE ALWAYS TRIGGER candidate_review_conversions_legacy_link_trg;
