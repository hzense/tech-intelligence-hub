-- Private, immutable recorded verification and candidate-assembly receipts.
-- No privileges, publication transition or factual verification are supplied here.
CREATE TABLE signal_candidate_verifications (
  verification_id uuid PRIMARY KEY,
  signal_id text NOT NULL,
  source_version integer NOT NULL,
  source_content_hash text NOT NULL,
  bundle_fingerprint text NOT NULL,
  verifier_id uuid NOT NULL,
  policy_version text NOT NULL,
  report_hash text NOT NULL,
  decision text NOT NULL,
  checks jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', statement_timestamp()),
  expires_at timestamptz NOT NULL,
  created_xid xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id(),
  CONSTRAINT signal_candidate_verifications_source_fk FOREIGN KEY (signal_id, source_version)
    REFERENCES signal_versions(signal_id, version) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_candidate_verifications_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_candidate_verifications_version_ck CHECK (source_version > 0),
  CONSTRAINT signal_candidate_verifications_source_hash_ck CHECK (source_content_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_candidate_verifications_bundle_hash_ck CHECK (bundle_fingerprint COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_candidate_verifications_policy_ck CHECK (policy_version = 'candidate-verification-v1'),
  CONSTRAINT signal_candidate_verifications_report_hash_ck CHECK (report_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_candidate_verifications_decision_ck CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT signal_candidate_verifications_checks_ck CHECK (jsonb_typeof(checks) = 'object'),
  CONSTRAINT signal_candidate_verifications_verified_at_ck CHECK (isfinite(verified_at)),
  CONSTRAINT signal_candidate_verifications_verified_at_year_ck CHECK (extract(year FROM verified_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_candidate_verifications_verified_at_precision_ck CHECK (date_trunc('milliseconds', verified_at) = verified_at),
  CONSTRAINT signal_candidate_verifications_expires_at_ck CHECK (isfinite(expires_at)),
  CONSTRAINT signal_candidate_verifications_expires_at_year_ck CHECK (extract(year FROM expires_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_candidate_verifications_expires_at_precision_ck CHECK (date_trunc('milliseconds', expires_at) = expires_at),
  CONSTRAINT signal_candidate_verifications_expiry_order_ck CHECK (expires_at > verified_at),
  CONSTRAINT signal_candidate_verifications_expiry_window_ck CHECK (expires_at <= verified_at + interval '24 hours')
);
CREATE UNIQUE INDEX signal_candidate_verifications_identity_uq
  ON signal_candidate_verifications(verification_id, signal_id, source_version);

CREATE TABLE signal_candidate_assembly_receipts (
  request_key text PRIMARY KEY,
  request_fingerprint text NOT NULL,
  verification_id uuid NOT NULL,
  signal_id text NOT NULL,
  source_version integer NOT NULL,
  target_version integer NOT NULL,
  content_hash text NOT NULL,
  CONSTRAINT signal_candidate_assembly_receipts_verification_fk
    FOREIGN KEY (verification_id, signal_id, source_version)
    REFERENCES signal_candidate_verifications(verification_id, signal_id, source_version)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_candidate_assembly_receipts_target_fk
    FOREIGN KEY (signal_id, target_version) REFERENCES signal_versions(signal_id, version)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_candidate_assembly_receipts_request_key_ck CHECK (request_key COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  CONSTRAINT signal_candidate_assembly_receipts_key_length_ck CHECK (length(request_key) BETWEEN 1 AND 200),
  CONSTRAINT signal_candidate_assembly_receipts_fingerprint_ck CHECK (request_fingerprint COLLATE "C" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_candidate_assembly_receipts_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_candidate_assembly_receipts_source_version_ck CHECK (source_version > 0),
  CONSTRAINT signal_candidate_assembly_receipts_target_version_ck CHECK (target_version > source_version),
  CONSTRAINT signal_candidate_assembly_receipts_content_hash_ck CHECK (content_hash COLLATE "C" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX signal_candidate_assembly_receipts_verification_uq
  ON signal_candidate_assembly_receipts(verification_id);

CREATE FUNCTION public.hzense_guard_candidate_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  current_xid xid8 := pg_catalog.pg_current_xact_id();
  source_xid xid8;
  source_hash text;
  target_xid xid8;
  target_hash text;
  verification public.signal_candidate_verifications%ROWTYPE;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_NARGS <> 0
    OR TG_TABLE_NAME NOT IN ('signal_candidate_verifications', 'signal_candidate_assembly_receipts') THEN
    RAISE EXCEPTION 'Invalid candidate verification trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF TG_WHEN = 'BEFORE' AND ((TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')
    OR (TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE', 'DELETE'))) THEN
    RAISE EXCEPTION 'Candidate verification records and receipts are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_LEVEL <> 'ROW' OR TG_OP <> 'INSERT'
    OR (TG_WHEN <> 'BEFORE' AND NOT (TG_WHEN = 'AFTER' AND TG_TABLE_NAME = 'signal_candidate_assembly_receipts')) THEN
    RAISE EXCEPTION 'Invalid candidate verification trigger operation' USING ERRCODE = '55000';
  END IF;
  SELECT version_row.created_xid, version_row.content_hash INTO source_xid, source_hash
    FROM public.signal_versions AS version_row
    WHERE version_row.signal_id = NEW.signal_id AND version_row.version = NEW.source_version;
  IF source_xid IS NULL OR source_xid = current_xid THEN
    RAISE EXCEPTION 'Candidate verification requires a previously sealed source' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'signal_candidate_verifications' THEN
    IF NEW.created_xid IS DISTINCT FROM current_xid THEN
      RAISE EXCEPTION 'Candidate verification requires its current transaction stamp' USING ERRCODE = '55000';
    END IF;
    IF NEW.verified_at IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()) THEN
      RAISE EXCEPTION 'Candidate verification time must be generated by its database statement' USING ERRCODE = '23514';
    END IF;
    IF NEW.source_content_hash IS DISTINCT FROM source_hash THEN
      RAISE EXCEPTION 'Candidate verification source hash does not match its sealed source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT recorded.* INTO verification FROM public.signal_candidate_verifications AS recorded
    WHERE recorded.verification_id = NEW.verification_id AND recorded.signal_id = NEW.signal_id
      AND recorded.source_version = NEW.source_version FOR SHARE;
  SELECT version_row.created_xid, version_row.content_hash INTO target_xid, target_hash
    FROM public.signal_versions AS version_row
    WHERE version_row.signal_id = NEW.signal_id AND version_row.version = NEW.target_version;
  IF verification.verification_id IS NULL OR verification.created_xid = current_xid
    OR verification.decision IS DISTINCT FROM 'approved'
    OR verification.source_content_hash IS DISTINCT FROM source_hash
    OR verification.verified_at > pg_catalog.clock_timestamp()
    OR verification.expires_at <= pg_catalog.clock_timestamp()
    OR target_xid IS DISTINCT FROM current_xid OR target_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'Candidate assembly requires a sealed, current approval and matching new target' USING ERRCODE = '23514';
  END IF;
  IF TG_WHEN = 'AFTER' THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_candidate_verification() FROM PUBLIC;

CREATE TRIGGER signal_candidate_verifications_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_candidate_verifications
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_verification();
CREATE TRIGGER signal_candidate_verifications_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_candidate_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_candidate_verification();
CREATE TRIGGER signal_candidate_assembly_receipts_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_candidate_assembly_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_verification();
CREATE TRIGGER signal_candidate_assembly_receipts_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_candidate_assembly_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_candidate_verification();
CREATE CONSTRAINT TRIGGER signal_candidate_assembly_receipts_approval_trg
  AFTER INSERT ON public.signal_candidate_assembly_receipts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_verification();
ALTER TABLE public.signal_candidate_verifications ENABLE ALWAYS TRIGGER signal_candidate_verifications_guard_trg;
ALTER TABLE public.signal_candidate_verifications ENABLE ALWAYS TRIGGER signal_candidate_verifications_no_truncate_trg;
ALTER TABLE public.signal_candidate_assembly_receipts ENABLE ALWAYS TRIGGER signal_candidate_assembly_receipts_guard_trg;
ALTER TABLE public.signal_candidate_assembly_receipts ENABLE ALWAYS TRIGGER signal_candidate_assembly_receipts_no_truncate_trg;
ALTER TABLE public.signal_candidate_assembly_receipts ENABLE ALWAYS TRIGGER signal_candidate_assembly_receipts_approval_trg;
