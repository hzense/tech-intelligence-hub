-- Private publication transaction storage, NOT a production publisher.
-- Eligibility, authorization and transition planning remain outside this DDL.
-- The outbox is a permanent append-only receipt ledger, not a delivery queue
-- to delete after consumption. It contains no content body or free-form reason.

CREATE TABLE signal_publication_outbox (
  event_id uuid PRIMARY KEY,
  request_key text NOT NULL,
  request_fingerprint text NOT NULL,
  signal_id text NOT NULL,
  expected_revision integer NOT NULL,
  publication_revision integer NOT NULL,
  content_version integer NOT NULL,
  status text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT signal_publication_outbox_version_fk FOREIGN KEY (signal_id, content_version)
    REFERENCES signal_versions(signal_id, version) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_publication_outbox_identity_fk FOREIGN KEY (signal_id)
    REFERENCES signal_event_identities(signal_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_publication_outbox_request_key_ck
    CHECK (request_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  CONSTRAINT signal_publication_outbox_request_key_length_ck CHECK (length(request_key) BETWEEN 1 AND 200),
  CONSTRAINT signal_publication_outbox_request_fingerprint_ck CHECK (request_fingerprint COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_publication_outbox_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_publication_outbox_expected_revision_ck CHECK (expected_revision >= 0),
  CONSTRAINT signal_publication_outbox_publication_revision_ck CHECK (publication_revision > 0),
  CONSTRAINT signal_publication_outbox_revision_step_ck CHECK (publication_revision::bigint = expected_revision::bigint + 1),
  CONSTRAINT signal_publication_outbox_content_version_ck CHECK (content_version > 0),
  CONSTRAINT signal_publication_outbox_status_ck CHECK (status IN ('published', 'withdrawn')),
  CONSTRAINT signal_publication_outbox_reason_code_ck CHECK ((status || ':' || reason_code) IN (
    'published:initial_publication', 'published:content_correction', 'published:republication',
    'withdrawn:factual_error', 'withdrawn:privacy', 'withdrawn:evidence_revoked', 'withdrawn:operator_request'
  )),
  CONSTRAINT signal_publication_outbox_occurred_at_ck CHECK (isfinite(occurred_at)),
  CONSTRAINT signal_publication_outbox_occurred_at_year_ck CHECK (extract(year FROM occurred_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_publication_outbox_occurred_at_precision_ck CHECK (date_trunc('milliseconds', occurred_at) = occurred_at)
);
CREATE UNIQUE INDEX signal_publication_outbox_request_key_uq ON signal_publication_outbox(request_key);
CREATE UNIQUE INDEX signal_publication_outbox_revision_uq ON signal_publication_outbox(signal_id, publication_revision);
CREATE UNIQUE INDEX signal_publication_outbox_state_uq
  ON signal_publication_outbox(signal_id, publication_revision, content_version, status, event_id, occurred_at);

CREATE TABLE signal_publication_state (
  signal_id text PRIMARY KEY,
  publication_revision integer NOT NULL,
  content_version integer NOT NULL,
  status text NOT NULL,
  event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT signal_publication_state_outbox_fk
    FOREIGN KEY (signal_id, publication_revision, content_version, status, event_id, occurred_at)
    REFERENCES signal_publication_outbox(signal_id, publication_revision, content_version, status, event_id, occurred_at)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_publication_state_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_publication_state_publication_revision_ck CHECK (publication_revision > 0),
  CONSTRAINT signal_publication_state_content_version_ck CHECK (content_version > 0),
  CONSTRAINT signal_publication_state_status_ck CHECK (status IN ('published', 'withdrawn')),
  CONSTRAINT signal_publication_state_occurred_at_ck CHECK (isfinite(occurred_at)),
  CONSTRAINT signal_publication_state_occurred_at_year_ck CHECK (extract(year FROM occurred_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_publication_state_occurred_at_precision_ck CHECK (date_trunc('milliseconds', occurred_at) = occurred_at)
);

CREATE FUNCTION public.hzense_guard_publication_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'BEFORE' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid publication receipt trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_LEVEL = 'ROW' AND TG_TABLE_NAME = 'signal_publication_outbox'
    AND TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Publication receipts are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE'
    AND TG_TABLE_NAME IN ('signal_publication_outbox', 'signal_publication_state') THEN
    RAISE EXCEPTION 'Publication storage cannot be truncated' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'Invalid publication receipt trigger operation' USING ERRCODE = '55000';
END;
$guard$;

CREATE FUNCTION public.hzense_check_publication_pair() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  affected_signals text[];
  affected_signal text;
  pair_matches boolean;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_NARGS <> 0
    OR NOT ((TG_TABLE_NAME = 'signal_publication_outbox' AND TG_OP = 'INSERT')
      OR (TG_TABLE_NAME = 'signal_publication_state' AND TG_OP IN ('INSERT', 'UPDATE', 'DELETE'))) THEN
    RAISE EXCEPTION 'Invalid publication pair trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    affected_signals := ARRAY[NEW.signal_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected_signals := ARRAY[OLD.signal_id];
  ELSE
    affected_signals := ARRAY[OLD.signal_id, NEW.signal_id];
  END IF;
  FOR affected_signal IN SELECT DISTINCT candidate.value FROM pg_catalog.unnest(affected_signals) AS candidate(value) LOOP
    IF EXISTS (SELECT 1 FROM public.signal_publication_outbox WHERE signal_id = affected_signal) THEN
      SELECT ROW(head.signal_id, head.publication_revision, head.content_version, head.status, head.event_id, head.occurred_at)
        IS NOT DISTINCT FROM ROW(receipt.signal_id, receipt.publication_revision, receipt.content_version, receipt.status, receipt.event_id, receipt.occurred_at)
        INTO pair_matches
        FROM (
          SELECT signal_id, publication_revision, content_version, status, event_id, occurred_at
          FROM public.signal_publication_outbox WHERE signal_id = affected_signal
          ORDER BY publication_revision DESC LIMIT 1
        ) AS receipt
        LEFT JOIN public.signal_publication_state AS head ON head.signal_id = receipt.signal_id;
      IF pair_matches IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Publication state must match its latest outbox receipt' USING ERRCODE = '23514';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.signal_publication_state WHERE signal_id = affected_signal) THEN
      RAISE EXCEPTION 'Publication state requires an outbox receipt' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$guard$;

REVOKE ALL ON FUNCTION public.hzense_guard_publication_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hzense_check_publication_pair() FROM PUBLIC;

CREATE TRIGGER signal_publication_outbox_append_only_trg
  BEFORE UPDATE OR DELETE ON public.signal_publication_outbox
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_publication_receipt();
CREATE TRIGGER signal_publication_outbox_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_publication_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_publication_receipt();
CREATE TRIGGER signal_publication_state_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_publication_state
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_publication_receipt();
CREATE CONSTRAINT TRIGGER signal_publication_outbox_pair_trg
  AFTER INSERT ON public.signal_publication_outbox
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.hzense_check_publication_pair();
CREATE CONSTRAINT TRIGGER signal_publication_state_pair_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.signal_publication_state
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.hzense_check_publication_pair();

ALTER TABLE public.signal_publication_outbox ENABLE ALWAYS TRIGGER signal_publication_outbox_append_only_trg;
ALTER TABLE public.signal_publication_outbox ENABLE ALWAYS TRIGGER signal_publication_outbox_no_truncate_trg;
ALTER TABLE public.signal_publication_outbox ENABLE ALWAYS TRIGGER signal_publication_outbox_pair_trg;
ALTER TABLE public.signal_publication_state ENABLE ALWAYS TRIGGER signal_publication_state_no_truncate_trg;
ALTER TABLE public.signal_publication_state ENABLE ALWAYS TRIGGER signal_publication_state_pair_trg;
