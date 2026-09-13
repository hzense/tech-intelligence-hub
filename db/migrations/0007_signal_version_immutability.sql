-- Transaction sealing for Signal snapshots, their edges and canonical identity.
-- The volatile default stamps pre-existing rows with this migration's xid8;
-- it is a sealing boundary, NOT evidence of their historical creation time.
-- The migration can rewrite these tables and requires exclusive DDL locks.

ALTER TABLE public.signal_versions
  ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id();
ALTER TABLE public.public_source_evidence
  ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id();
ALTER TABLE public.signal_event_identities
  ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id();

CREATE FUNCTION public.hzense_guard_sealed_row() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  current_xid xid8 := pg_catalog.pg_current_xact_id();
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE'
    OR TG_NARGS <> 0 OR TG_OP NOT IN ('INSERT', 'UPDATE', 'DELETE')
    OR TG_TABLE_NAME NOT IN ('signal_versions', 'public_source_evidence', 'signal_event_identities') THEN
    RAISE EXCEPTION 'Invalid sealed-row trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_xid IS DISTINCT FROM current_xid THEN
      RAISE EXCEPTION 'A new snapshot must carry its creation transaction stamp' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_xid IS DISTINCT FROM OLD.created_xid THEN
    RAISE EXCEPTION 'A snapshot creation transaction stamp cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF OLD.created_xid = current_xid THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'public_source_evidence' AND TG_OP = 'UPDATE' THEN
    IF (pg_catalog.to_jsonb(NEW) - 'verification_status') IS NOT DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - 'verification_status') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'A snapshot is sealed after its creation transaction' USING ERRCODE = '55000';
END;
$guard$;

CREATE FUNCTION public.hzense_guard_version_edge() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  current_xid xid8 := pg_catalog.pg_current_xact_id();
  parent_xid xid8;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_LEVEL <> 'ROW' OR TG_WHEN <> 'BEFORE'
    OR TG_NARGS <> 0 OR TG_OP NOT IN ('INSERT', 'UPDATE', 'DELETE')
    OR TG_TABLE_NAME NOT IN ('signal_version_evidence', 'signal_version_people', 'signal_version_organizations', 'signal_version_topics') THEN
    RAISE EXCEPTION 'Invalid version-edge trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT version_row.created_xid INTO parent_xid
      FROM public.signal_versions AS version_row
      WHERE version_row.signal_id = OLD.signal_id AND version_row.version = OLD.version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The old edge parent version does not exist' USING ERRCODE = '23503';
    END IF;
    IF parent_xid IS DISTINCT FROM current_xid THEN
      RAISE EXCEPTION 'The old edge parent version is sealed' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT version_row.created_xid INTO parent_xid
      FROM public.signal_versions AS version_row
      WHERE version_row.signal_id = NEW.signal_id AND version_row.version = NEW.version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The new edge parent version does not exist' USING ERRCODE = '23503';
    END IF;
    IF parent_xid IS DISTINCT FROM current_xid THEN
      RAISE EXCEPTION 'The new edge parent version is sealed' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$guard$;

CREATE FUNCTION public.hzense_reject_sealed_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_LEVEL <> 'STATEMENT' OR TG_WHEN <> 'BEFORE'
    OR TG_NARGS <> 0 OR TG_OP <> 'TRUNCATE'
    OR TG_TABLE_NAME NOT IN ('signal_versions', 'public_source_evidence', 'signal_event_identities', 'signal_version_evidence', 'signal_version_people', 'signal_version_organizations', 'signal_version_topics') THEN
    RAISE EXCEPTION 'Invalid sealed-truncate trigger attachment' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'Sealed snapshot tables cannot be truncated' USING ERRCODE = '55000';
END;
$guard$;

REVOKE ALL ON FUNCTION public.hzense_guard_sealed_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_guard_version_edge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_reject_sealed_truncate() FROM PUBLIC;

CREATE TRIGGER signal_versions_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_versions
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_sealed_row();
CREATE TRIGGER public_source_evidence_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.public_source_evidence
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_sealed_row();
CREATE TRIGGER signal_event_identities_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_event_identities
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_sealed_row();
CREATE TRIGGER signal_version_evidence_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_version_evidence
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_version_edge();
CREATE TRIGGER signal_version_people_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_version_people
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_version_edge();
CREATE TRIGGER signal_version_organizations_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_version_organizations
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_version_edge();
CREATE TRIGGER signal_version_topics_sealed_row_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_version_topics
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_version_edge();

CREATE TRIGGER signal_versions_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER public_source_evidence_sealed_truncate_trg
  BEFORE TRUNCATE ON public.public_source_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER signal_event_identities_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_event_identities
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER signal_version_evidence_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_version_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER signal_version_people_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_version_people
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER signal_version_organizations_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_version_organizations
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();
CREATE TRIGGER signal_version_topics_sealed_truncate_trg
  BEFORE TRUNCATE ON public.signal_version_topics
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_reject_sealed_truncate();

ALTER TABLE public.signal_versions ENABLE ALWAYS TRIGGER signal_versions_sealed_row_trg;
ALTER TABLE public.signal_versions ENABLE ALWAYS TRIGGER signal_versions_sealed_truncate_trg;
ALTER TABLE public.public_source_evidence ENABLE ALWAYS TRIGGER public_source_evidence_sealed_row_trg;
ALTER TABLE public.public_source_evidence ENABLE ALWAYS TRIGGER public_source_evidence_sealed_truncate_trg;
ALTER TABLE public.signal_event_identities ENABLE ALWAYS TRIGGER signal_event_identities_sealed_row_trg;
ALTER TABLE public.signal_event_identities ENABLE ALWAYS TRIGGER signal_event_identities_sealed_truncate_trg;
ALTER TABLE public.signal_version_evidence ENABLE ALWAYS TRIGGER signal_version_evidence_sealed_row_trg;
ALTER TABLE public.signal_version_evidence ENABLE ALWAYS TRIGGER signal_version_evidence_sealed_truncate_trg;
ALTER TABLE public.signal_version_people ENABLE ALWAYS TRIGGER signal_version_people_sealed_row_trg;
ALTER TABLE public.signal_version_people ENABLE ALWAYS TRIGGER signal_version_people_sealed_truncate_trg;
ALTER TABLE public.signal_version_organizations ENABLE ALWAYS TRIGGER signal_version_organizations_sealed_row_trg;
ALTER TABLE public.signal_version_organizations ENABLE ALWAYS TRIGGER signal_version_organizations_sealed_truncate_trg;
ALTER TABLE public.signal_version_topics ENABLE ALWAYS TRIGGER signal_version_topics_sealed_row_trg;
ALTER TABLE public.signal_version_topics ENABLE ALWAYS TRIGGER signal_version_topics_sealed_truncate_trg;
