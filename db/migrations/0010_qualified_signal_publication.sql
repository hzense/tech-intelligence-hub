-- Private qualified-publication receipts bind a sealed candidate, a new snapshot,
-- an outbox receipt and the lease used by the owner-controlled publisher.
-- This is not a grant, a public projection or a proof of factual eligibility.
CREATE UNIQUE INDEX signal_publication_outbox_qualified_receipt_uq
  ON signal_publication_outbox(request_key, signal_id, content_version);

CREATE TABLE signal_qualified_publication_receipts (
  request_key text PRIMARY KEY,
  request_fingerprint text NOT NULL,
  signal_id text NOT NULL,
  source_version integer NOT NULL,
  target_version integer NOT NULL,
  run_id uuid NOT NULL,
  lease_owner uuid NOT NULL,
  fencing_token integer NOT NULL,
  CONSTRAINT signal_qualified_publication_receipts_outbox_fk
    FOREIGN KEY (request_key, signal_id, target_version)
    REFERENCES signal_publication_outbox(request_key, signal_id, content_version)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_qualified_publication_receipts_source_fk
    FOREIGN KEY (signal_id, source_version) REFERENCES signal_versions(signal_id, version)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_qualified_publication_receipts_run_fk
    FOREIGN KEY (run_id) REFERENCES signal_publication_runs(run_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_qualified_publication_receipts_request_key_ck
    CHECK (request_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  CONSTRAINT signal_qualified_publication_receipts_request_key_length_ck CHECK (length(request_key) BETWEEN 1 AND 200),
  CONSTRAINT signal_qualified_publication_receipts_fingerprint_ck CHECK (request_fingerprint COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_qualified_publication_receipts_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_qualified_publication_receipts_source_version_ck CHECK (source_version > 0),
  CONSTRAINT signal_qualified_publication_receipts_target_version_ck CHECK (target_version > source_version),
  CONSTRAINT signal_qualified_publication_receipts_token_ck CHECK (fencing_token > 0)
);

CREATE FUNCTION public.hzense_guard_qualified_publication_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  current_xid xid8 := pg_catalog.pg_current_xact_id();
  source_xid xid8;
  target_xid xid8;
  outbox_status text;
  routing_task_id uuid;
  routing_principal_id uuid;
  global_enabled boolean;
  task_enabled boolean;
  task_policy text;
  authorized boolean;
  run_record public.signal_publication_runs%ROWTYPE;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_qualified_publication_receipts'
    OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid qualified publication trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_WHEN = 'BEFORE' THEN
    IF (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')
      OR (TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE', 'DELETE')) THEN
      RAISE EXCEPTION 'Qualified publication receipts are append-only' USING ERRCODE = '55000';
    END IF;
    IF TG_LEVEL <> 'ROW' OR TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Invalid qualified publication trigger operation' USING ERRCODE = '55000';
    END IF;
    SELECT receipt.status INTO outbox_status
      FROM public.signal_publication_outbox AS receipt
      WHERE receipt.request_key = NEW.request_key AND receipt.signal_id = NEW.signal_id
        AND receipt.content_version = NEW.target_version;
    IF outbox_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'Qualified publication requires a matching published receipt' USING ERRCODE = '23514';
    END IF;
    SELECT version_row.created_xid INTO source_xid FROM public.signal_versions AS version_row
      WHERE version_row.signal_id = NEW.signal_id AND version_row.version = NEW.source_version;
    SELECT version_row.created_xid INTO target_xid FROM public.signal_versions AS version_row
      WHERE version_row.signal_id = NEW.signal_id AND version_row.version = NEW.target_version;
    IF source_xid IS NULL OR source_xid = current_xid OR target_xid IS DISTINCT FROM current_xid THEN
      RAISE EXCEPTION 'Qualified publication requires a sealed source and a new transaction-local target' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Invalid qualified publication trigger operation' USING ERRCODE = '55000';
  END IF;
  -- Routing fields are immutable. Match the application's lock order, then
  -- observe wall-clock expiry only after every lock wait has completed.
  SELECT run.task_id, run.principal_id INTO routing_task_id, routing_principal_id
    FROM public.signal_publication_runs AS run WHERE run.run_id = NEW.run_id;
  SELECT control.publication_enabled INTO global_enabled
    FROM public.signal_publication_control AS control WHERE control.singleton = true FOR SHARE;
  SELECT task.publication_enabled, task.policy INTO task_enabled, task_policy
    FROM public.signal_publication_tasks AS task
    WHERE task.task_id = routing_task_id FOR SHARE;
  SELECT grant_row.can_publish INTO authorized
    FROM public.signal_publication_authorizations AS grant_row
    WHERE grant_row.task_id = routing_task_id
      AND grant_row.principal_id = routing_principal_id FOR SHARE;
  SELECT run.* INTO run_record FROM public.signal_publication_runs AS run
    WHERE run.run_id = NEW.run_id FOR SHARE;
  IF global_enabled IS DISTINCT FROM true OR task_enabled IS DISTINCT FROM true
    OR task_policy IS DISTINCT FROM 'auto_publish' OR authorized IS DISTINCT FROM true
    OR run_record.original_intent IS DISTINCT FROM 'auto_publish'
    OR run_record.status IS DISTINCT FROM 'running'
    OR run_record.lease_owner IS DISTINCT FROM NEW.lease_owner
    OR run_record.fencing_token IS DISTINCT FROM NEW.fencing_token
    OR run_record.lease_expires_at IS NULL OR run_record.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Qualified publication controls or lease are no longer valid' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_qualified_publication_receipt() FROM PUBLIC;

CREATE TRIGGER signal_qualified_publication_receipts_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_qualified_publication_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_qualified_publication_receipt();
CREATE TRIGGER signal_qualified_publication_receipts_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_qualified_publication_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_qualified_publication_receipt();
CREATE CONSTRAINT TRIGGER signal_qualified_publication_receipts_controls_trg
  AFTER INSERT ON public.signal_qualified_publication_receipts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_qualified_publication_receipt();
ALTER TABLE public.signal_qualified_publication_receipts ENABLE ALWAYS TRIGGER signal_qualified_publication_receipts_guard_trg;
ALTER TABLE public.signal_qualified_publication_receipts ENABLE ALWAYS TRIGGER signal_qualified_publication_receipts_no_truncate_trg;
ALTER TABLE public.signal_qualified_publication_receipts ENABLE ALWAYS TRIGGER signal_qualified_publication_receipts_controls_trg;
