-- Restricted public release: no historical verification is retroactively blessed.
-- These tables are private. Only the final security-barrier view is public DTO.
-- Existing receipt guard needs lock-only owner authority for its deferred
-- control checks; do not grant policy UPDATE just to acquire FOR SHARE locks.
-- Its reviewed trigger-only body and fixed search_path are unchanged.
ALTER FUNCTION public.hzense_guard_qualified_publication_receipt() SECURITY DEFINER;
CREATE TABLE signal_verification_dependency_seals (
  verification_id uuid PRIMARY KEY REFERENCES signal_candidate_verifications(verification_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  dependency_seal jsonb NOT NULL,
  invalidated boolean NOT NULL DEFAULT false,
  CONSTRAINT signal_verification_dependency_seals_object_ck CHECK (jsonb_typeof(dependency_seal) = 'object')
);
CREATE TABLE signal_publication_permits (
  event_id uuid PRIMARY KEY REFERENCES signal_publication_outbox(event_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  verification_id uuid NOT NULL REFERENCES signal_candidate_verifications(verification_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  dependency_seal jsonb NOT NULL,
  CONSTRAINT signal_publication_permits_object_ck CHECK (jsonb_typeof(dependency_seal) = 'object')
);

-- Full database JSONB values retain numeric precision. UTC pins timestamp output.
-- Immutable snapshots/edges are included; a seal is opaque, never a public payload.
CREATE FUNCTION public.hzense_signal_dependency_seal(p_signal_id text, p_source_version integer) RETURNS jsonb
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
    'snapshot', (SELECT to_jsonb(r) FROM public.signal_versions r WHERE signal_id=p_signal_id AND version=p_source_version),
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

-- Lock-only capabilities avoid UPDATE grants on mutable policy/dependency rows.
CREATE FUNCTION public.hzense_lock_publication_controls(p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $lock$
DECLARE routing public.signal_publication_runs%ROWTYPE;
BEGIN
  SELECT * INTO routing FROM public.signal_publication_runs WHERE run_id=p_run_id;
  PERFORM 1 FROM public.signal_publication_control WHERE singleton=true FOR SHARE;
  PERFORM 1 FROM public.signal_publication_tasks WHERE task_id=routing.task_id FOR SHARE;
  PERFORM 1 FROM public.signal_publication_authorizations WHERE task_id=routing.task_id AND principal_id=routing.principal_id FOR SHARE;
  PERFORM 1 FROM public.signal_publication_runs WHERE run_id=p_run_id FOR SHARE;
END;
$lock$;

CREATE FUNCTION public.hzense_lock_publication_dependencies(p_signal_id text, p_source_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $lock$
DECLARE evidence_ids text[]; person_ids text[]; organization_ids text[]; basis integer;
BEGIN
  PERFORM 1 FROM public.signals WHERE id=p_signal_id FOR UPDATE;
  PERFORM 1 FROM public.signal_versions WHERE signal_id=p_signal_id AND version=p_source_version FOR SHARE;
  SELECT basis_version INTO basis FROM public.signal_event_identities WHERE signal_id=p_signal_id FOR SHARE;
  SELECT array_agg(DISTINCT evidence_id) INTO evidence_ids FROM public.signal_version_evidence WHERE signal_id=p_signal_id AND version IN (p_source_version,basis);
  SELECT array_agg(DISTINCT person_id) INTO person_ids FROM public.signal_version_people WHERE signal_id=p_signal_id AND version=p_source_version;
  SELECT array_agg(DISTINCT organization_id) INTO organization_ids FROM public.signal_version_organizations WHERE signal_id=p_signal_id AND version=p_source_version;
  PERFORM 1 FROM public.sources WHERE id IN (SELECT source_id FROM public.public_source_evidence WHERE id=ANY(evidence_ids)) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.public_source_evidence WHERE id=ANY(evidence_ids) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.entities WHERE id=ANY(COALESCE(person_ids,'{}'::text[]) || COALESCE(organization_ids,'{}'::text[])) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.person_profiles WHERE entity_id=ANY(person_ids) ORDER BY entity_id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.organization_profiles WHERE entity_id=ANY(organization_ids) ORDER BY entity_id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.topics WHERE id IN (SELECT topic_id FROM public.signal_version_topics WHERE signal_id=p_signal_id AND version=p_source_version) ORDER BY id COLLATE "C" FOR SHARE;
END;
$lock$;

CREATE FUNCTION public.hzense_capture_verification_dependencies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_candidate_verifications'
    OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_OP <> 'INSERT' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid dependency capture attachment' USING ERRCODE='55000';
  END IF;
  PERFORM public.hzense_lock_publication_dependencies(NEW.signal_id,NEW.source_version);
  INSERT INTO public.signal_verification_dependency_seals(verification_id,dependency_seal)
    VALUES(NEW.verification_id,public.hzense_signal_dependency_seal(NEW.signal_id,NEW.source_version));
  RETURN NULL;
END;
$guard$;

CREATE FUNCTION public.hzense_guard_verification_dependency_seal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE verification public.signal_candidate_verifications%ROWTYPE;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_verification_dependency_seals'
    OR TG_WHEN <> 'BEFORE' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid dependency seal attachment' USING ERRCODE='55000';
  END IF;
  IF TG_LEVEL='ROW' AND TG_OP='INSERT' THEN
    SELECT * INTO verification FROM public.signal_candidate_verifications WHERE verification_id=NEW.verification_id;
    IF verification.created_xid IS DISTINCT FROM pg_catalog.pg_current_xact_id()
      OR NEW.invalidated IS DISTINCT FROM false
      OR NEW.dependency_seal IS DISTINCT FROM public.hzense_signal_dependency_seal(verification.signal_id,verification.source_version) THEN
      RAISE EXCEPTION 'Dependency seals require a new verification and exact database material' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_LEVEL='ROW' AND TG_OP='UPDATE' THEN
    IF NEW.verification_id IS NOT DISTINCT FROM OLD.verification_id
      AND NEW.dependency_seal IS NOT DISTINCT FROM OLD.dependency_seal
      AND (NEW.invalidated IS NOT DISTINCT FROM OLD.invalidated OR NEW.invalidated=true) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Dependency seals cannot be replaced, restored, deleted or truncated' USING ERRCODE='55000';
END;
$guard$;

-- Latch only affected existing seals. INSERT cannot replace a dependency because
-- existing references have non-cascading foreign keys; UPDATE/DELETE/TRUNCATE do.
CREATE FUNCTION public.hzense_invalidate_verification_dependencies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'STATEMENT' OR TG_NARGS <> 0
    OR TG_OP NOT IN ('UPDATE','DELETE','TRUNCATE')
    OR TG_TABLE_NAME NOT IN ('sources','public_source_evidence','entities','person_profiles','organization_profiles','topics') THEN
    RAISE EXCEPTION 'Invalid dependency invalidation attachment' USING ERRCODE='55000';
  END IF;
  UPDATE public.signal_verification_dependency_seals AS seal SET invalidated=true
    FROM public.signal_candidate_verifications AS verification
    WHERE seal.verification_id=verification.verification_id AND NOT seal.invalidated
      AND seal.dependency_seal IS DISTINCT FROM public.hzense_signal_dependency_seal(verification.signal_id,verification.source_version);
  RETURN NULL;
END;
$guard$;

CREATE FUNCTION public.hzense_guard_publication_permit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET timezone = 'UTC'
AS $guard$
DECLARE
  receipt public.signal_publication_outbox%ROWTYPE;
  qualified public.signal_qualified_publication_receipts%ROWTYPE;
  assembly public.signal_candidate_assembly_receipts%ROWTYPE;
  verification public.signal_candidate_verifications%ROWTYPE;
  seal public.signal_verification_dependency_seals%ROWTYPE;
  source_row jsonb; target_row jsonb; same_edges boolean; table_name text;
  run_row public.signal_publication_runs%ROWTYPE; allowed boolean;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_publication_permits' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid public permit attachment' USING ERRCODE='55000';
  END IF;
  IF TG_WHEN='BEFORE' AND ((TG_LEVEL='STATEMENT' AND TG_OP='TRUNCATE') OR (TG_LEVEL='ROW' AND TG_OP IN ('UPDATE','DELETE'))) THEN
    RAISE EXCEPTION 'Public permits are append-only' USING ERRCODE='55000';
  END IF;
  IF TG_LEVEL<>'ROW' OR TG_OP<>'INSERT' OR TG_WHEN NOT IN ('BEFORE','AFTER') THEN
    RAISE EXCEPTION 'Invalid public permit operation' USING ERRCODE='55000';
  END IF;
  SELECT * INTO receipt FROM public.signal_publication_outbox WHERE event_id=NEW.event_id;
  SELECT * INTO qualified FROM public.signal_qualified_publication_receipts WHERE request_key=receipt.request_key;
  SELECT * INTO verification FROM public.signal_candidate_verifications WHERE verification_id=NEW.verification_id;
  SELECT * INTO assembly FROM public.signal_candidate_assembly_receipts WHERE verification_id=NEW.verification_id;
  IF receipt.status IS DISTINCT FROM 'published' OR qualified.request_key IS NULL
    OR qualified.signal_id IS DISTINCT FROM receipt.signal_id OR qualified.target_version IS DISTINCT FROM receipt.content_version
    OR assembly.signal_id IS DISTINCT FROM receipt.signal_id OR assembly.target_version IS DISTINCT FROM qualified.source_version
    OR assembly.source_version IS DISTINCT FROM verification.source_version OR assembly.signal_id IS DISTINCT FROM verification.signal_id
    OR verification.decision IS DISTINCT FROM 'approved' OR verification.policy_version IS DISTINCT FROM 'candidate-verification-v1'
    OR verification.checks IS DISTINCT FROM '{"claims_supported":true,"people_disambiguated":true,"people_are_participants":true,"organizations_supported":true,"public_sources_cleared":true,"contradictions_resolved":true}'::jsonb
    OR verification.created_xid IS NULL OR verification.created_xid=pg_catalog.pg_current_xact_id() THEN
    RAISE EXCEPTION 'Public publication requires its exact approved assembly chain' USING ERRCODE='23514';
  END IF;
  PERFORM public.hzense_lock_publication_controls(qualified.run_id);
  PERFORM public.hzense_lock_publication_dependencies(receipt.signal_id,verification.source_version);
  SELECT * INTO run_row FROM public.signal_publication_runs WHERE run_id=qualified.run_id;
  SELECT global_control.publication_enabled AND task.publication_enabled AND task.policy='auto_publish' AND authorization_row.can_publish
    INTO allowed FROM public.signal_publication_control global_control
    JOIN public.signal_publication_tasks task ON task.task_id=run_row.task_id
    JOIN public.signal_publication_authorizations authorization_row ON authorization_row.task_id=run_row.task_id AND authorization_row.principal_id=run_row.principal_id
    WHERE global_control.singleton=true;
  IF allowed IS DISTINCT FROM true OR run_row.original_intent IS DISTINCT FROM 'auto_publish'
    OR run_row.status IS DISTINCT FROM 'running' OR run_row.lease_owner IS DISTINCT FROM qualified.lease_owner
    OR run_row.fencing_token IS DISTINCT FROM qualified.fencing_token OR run_row.lease_expires_at IS NULL
    OR run_row.lease_expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Public publication controls or lease are no longer valid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO seal FROM public.signal_verification_dependency_seals WHERE verification_id=NEW.verification_id FOR SHARE;
  IF seal.verification_id IS NULL OR seal.invalidated OR NEW.dependency_seal IS DISTINCT FROM seal.dependency_seal
    OR seal.dependency_seal IS DISTINCT FROM public.hzense_signal_dependency_seal(verification.signal_id,verification.source_version)
    OR verification.verified_at>pg_catalog.clock_timestamp() OR verification.expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Public verification is expired, invalidated or changed' USING ERRCODE='23514';
  END IF;
  SELECT to_jsonb(r)-ARRAY['version','content_hash','created_at','created_xid']::text[] INTO source_row
    FROM public.signal_versions r WHERE signal_id=receipt.signal_id AND version=assembly.target_version
      AND created_xid<>pg_catalog.pg_current_xact_id() AND content_hash=assembly.content_hash;
  SELECT to_jsonb(r)-ARRAY['version','content_hash','created_at','created_xid']::text[] INTO target_row
    FROM public.signal_versions r WHERE signal_id=receipt.signal_id AND version=receipt.content_version
      AND created_xid=pg_catalog.pg_current_xact_id();
  IF source_row IS NULL OR target_row IS DISTINCT FROM source_row THEN
    RAISE EXCEPTION 'Public target must clone its sealed assembled candidate' USING ERRCODE='23514';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['signal_version_evidence','signal_version_people','signal_version_organizations','signal_version_topics'] LOOP
    EXECUTE format('SELECT NOT EXISTS ((SELECT to_jsonb(r)-''version'' FROM public.%I r WHERE signal_id=$1 AND version=$2 EXCEPT SELECT to_jsonb(r)-''version'' FROM public.%I r WHERE signal_id=$1 AND version=$3) UNION ALL (SELECT to_jsonb(r)-''version'' FROM public.%I r WHERE signal_id=$1 AND version=$3 EXCEPT SELECT to_jsonb(r)-''version'' FROM public.%I r WHERE signal_id=$1 AND version=$2))',table_name,table_name,table_name,table_name)
      INTO same_edges USING receipt.signal_id,assembly.target_version,receipt.content_version;
    IF same_edges IS DISTINCT FROM true THEN RAISE EXCEPTION 'Public target edges must exactly clone its assembly' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF verification.expires_at<=pg_catalog.clock_timestamp() OR run_row.lease_expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Public verification or lease expired during final qualification' USING ERRCODE='23514';
  END IF;
  IF TG_WHEN='AFTER' THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$guard$;

CREATE FUNCTION public.hzense_public_signal_is_current(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET timezone = 'UTC'
AS $current$
  SELECT EXISTS (
    SELECT 1 FROM public.signal_publication_state head
    JOIN public.signal_publication_permits permit ON permit.event_id=head.event_id
    JOIN public.signal_candidate_verifications verification ON verification.verification_id=permit.verification_id
    JOIN public.signal_verification_dependency_seals seal ON seal.verification_id=permit.verification_id
    WHERE head.event_id=p_event_id AND head.status='published' AND NOT seal.invalidated
      AND permit.dependency_seal=seal.dependency_seal
      AND seal.dependency_seal=public.hzense_signal_dependency_seal(verification.signal_id,verification.source_version)
  );
$current$;

CREATE VIEW public.current_public_signals WITH (security_barrier=true) AS
SELECT head.signal_id, head.content_version AS version, head.publication_revision,
  snapshot.title, snapshot.type, snapshot.occurred_at, snapshot.captured_at, snapshot.summary, snapshot.analysis,
  snapshot.importance, snapshot.strength, snapshot.confidence, snapshot.novelty,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',topic.id,'title',topic.title) ORDER BY topic.id COLLATE "C") FROM public.signal_version_topics link JOIN public.topics topic ON topic.id=link.topic_id WHERE link.signal_id=head.signal_id AND link.version=head.content_version),'[]'::jsonb) AS topics,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',entity.id,'name',entity.name,'event_role',link.event_role) ORDER BY entity.id COLLATE "C",link.evidence_id COLLATE "C") FROM public.signal_version_people link JOIN public.entities entity ON entity.id=link.person_id WHERE link.signal_id=head.signal_id AND link.version=head.content_version),'[]'::jsonb) AS people,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',entity.id,'name',entity.name,'event_role',link.event_role) ORDER BY entity.id COLLATE "C",link.evidence_id COLLATE "C") FROM public.signal_version_organizations link JOIN public.entities entity ON entity.id=link.organization_id WHERE link.signal_id=head.signal_id AND link.version=head.content_version),'[]'::jsonb) AS organizations,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',evidence.id,'url',evidence.source_url,'name',source.name) ORDER BY evidence.id COLLATE "C") FROM public.signal_version_evidence link JOIN public.public_source_evidence evidence ON evidence.id=link.evidence_id JOIN public.sources source ON source.id=evidence.source_id WHERE link.signal_id=head.signal_id AND link.version=head.content_version AND link.relation='supports'),'[]'::jsonb) AS sources
FROM public.signal_publication_state head
JOIN public.signal_versions snapshot ON snapshot.signal_id=head.signal_id AND snapshot.version=head.content_version
WHERE head.status='published' AND public.hzense_public_signal_is_current(head.event_id);

REVOKE ALL ON TABLE public.signal_verification_dependency_seals,public.signal_publication_permits,public.current_public_signals FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_signal_dependency_seal(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_lock_publication_controls(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_lock_publication_dependencies(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_capture_verification_dependencies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_guard_verification_dependency_seal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_invalidate_verification_dependencies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_guard_publication_permit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_public_signal_is_current(uuid) FROM PUBLIC;

CREATE TRIGGER signal_candidate_verifications_dependencies_trg AFTER INSERT ON public.signal_candidate_verifications FOR EACH ROW EXECUTE FUNCTION public.hzense_capture_verification_dependencies();
CREATE TRIGGER signal_verification_dependency_seals_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.signal_verification_dependency_seals FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_verification_dependency_seal();
CREATE TRIGGER signal_verification_dependency_seals_no_truncate_trg BEFORE TRUNCATE ON public.signal_verification_dependency_seals FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_verification_dependency_seal();
CREATE TRIGGER signal_publication_permits_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.signal_publication_permits FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_publication_permit();
CREATE TRIGGER signal_publication_permits_no_truncate_trg BEFORE TRUNCATE ON public.signal_publication_permits FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_publication_permit();
CREATE CONSTRAINT TRIGGER signal_publication_permits_current_trg AFTER INSERT ON public.signal_publication_permits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_publication_permit();
CREATE TRIGGER sources_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.sources FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
CREATE TRIGGER public_source_evidence_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.public_source_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
CREATE TRIGGER entities_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.entities FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
CREATE TRIGGER person_profiles_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.person_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
CREATE TRIGGER organization_profiles_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.organization_profiles FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
CREATE TRIGGER topics_verification_invalidation_trg AFTER UPDATE OR DELETE OR TRUNCATE ON public.topics FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_invalidate_verification_dependencies();
ALTER TABLE public.signal_candidate_verifications ENABLE ALWAYS TRIGGER signal_candidate_verifications_dependencies_trg;
ALTER TABLE public.signal_verification_dependency_seals ENABLE ALWAYS TRIGGER signal_verification_dependency_seals_guard_trg;
ALTER TABLE public.signal_verification_dependency_seals ENABLE ALWAYS TRIGGER signal_verification_dependency_seals_no_truncate_trg;
ALTER TABLE public.signal_publication_permits ENABLE ALWAYS TRIGGER signal_publication_permits_guard_trg;
ALTER TABLE public.signal_publication_permits ENABLE ALWAYS TRIGGER signal_publication_permits_no_truncate_trg;
ALTER TABLE public.signal_publication_permits ENABLE ALWAYS TRIGGER signal_publication_permits_current_trg;
ALTER TABLE public.sources ENABLE ALWAYS TRIGGER sources_verification_invalidation_trg;
ALTER TABLE public.public_source_evidence ENABLE ALWAYS TRIGGER public_source_evidence_verification_invalidation_trg;
ALTER TABLE public.entities ENABLE ALWAYS TRIGGER entities_verification_invalidation_trg;
ALTER TABLE public.person_profiles ENABLE ALWAYS TRIGGER person_profiles_verification_invalidation_trg;
ALTER TABLE public.organization_profiles ENABLE ALWAYS TRIGGER organization_profiles_verification_invalidation_trg;
ALTER TABLE public.topics ENABLE ALWAYS TRIGGER topics_verification_invalidation_trg;
