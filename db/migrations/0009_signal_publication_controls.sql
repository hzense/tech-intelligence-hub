-- Private, owner-controlled publication policy and run coordination fixtures.
-- These records grant no runtime/writer privileges and do not prove eligibility.
CREATE TABLE signal_publication_control (
  singleton boolean PRIMARY KEY,
  publication_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT signal_publication_control_singleton_ck CHECK (singleton)
);
INSERT INTO signal_publication_control (singleton, publication_enabled) VALUES (true, false);

CREATE TABLE signal_publication_tasks (
  task_id uuid PRIMARY KEY,
  policy text NOT NULL DEFAULT 'preview_only',
  publication_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT signal_publication_tasks_policy_ck CHECK (policy IN ('auto_publish', 'review_required', 'preview_only'))
);

CREATE TABLE signal_publication_authorizations (
  task_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  can_publish boolean NOT NULL DEFAULT false,
  PRIMARY KEY (task_id, principal_id),
  CONSTRAINT signal_publication_authorizations_task_fk FOREIGN KEY (task_id)
    REFERENCES signal_publication_tasks(task_id) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE signal_publication_runs (
  run_id uuid PRIMARY KEY,
  task_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  original_intent text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  fencing_token integer NOT NULL DEFAULT 0,
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  CONSTRAINT signal_publication_runs_authorization_fk FOREIGN KEY (task_id, principal_id)
    REFERENCES signal_publication_authorizations(task_id, principal_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_publication_runs_intent_ck CHECK (original_intent IN ('auto_publish', 'review_required', 'preview_only')),
  CONSTRAINT signal_publication_runs_status_ck CHECK (status IN ('pending', 'running', 'cancelled', 'completed')),
  CONSTRAINT signal_publication_runs_token_ck CHECK (fencing_token >= 0),
  CONSTRAINT signal_publication_runs_state_ck CHECK (
    (status = 'pending' AND fencing_token = 0 AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (status = 'running' AND fencing_token > 0 AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status = 'cancelled' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (status = 'completed' AND fencing_token > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT signal_publication_runs_created_at_ck CHECK (isfinite(created_at)),
  CONSTRAINT signal_publication_runs_created_at_year_ck CHECK (extract(year FROM created_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_publication_runs_created_at_precision_ck CHECK (date_trunc('milliseconds', created_at) = created_at),
  CONSTRAINT signal_publication_runs_lease_expires_at_ck CHECK (lease_expires_at IS NULL OR isfinite(lease_expires_at)),
  CONSTRAINT signal_publication_runs_lease_expires_at_year_ck CHECK (lease_expires_at IS NULL OR extract(year FROM lease_expires_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999),
  CONSTRAINT signal_publication_runs_lease_expires_at_precision_ck CHECK (lease_expires_at IS NULL OR date_trunc('milliseconds', lease_expires_at) = lease_expires_at)
);

CREATE INDEX signal_publication_runs_task_lease_idx
  ON signal_publication_runs(task_id, status, lease_expires_at);

CREATE FUNCTION public.hzense_guard_publication_run() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  observed_at timestamptz;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'signal_publication_runs'
    OR TG_WHEN <> 'BEFORE' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION 'Invalid publication run trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')
    OR (TG_LEVEL = 'ROW' AND TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'Publication runs cannot be deleted or truncated' USING ERRCODE = '55000';
  END IF;
  IF TG_LEVEL <> 'ROW' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Invalid publication run trigger operation' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.fencing_token IS DISTINCT FROM 0
      OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'Publication runs must start pending without a lease' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.run_id, NEW.task_id, NEW.principal_id, NEW.original_intent, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.run_id, OLD.task_id, OLD.principal_id, OLD.original_intent, OLD.created_at) THEN
    RAISE EXCEPTION 'Publication run identity and original intent are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Terminal publication runs are immutable' USING ERRCODE = '55000';
  END IF;
  observed_at := pg_catalog.clock_timestamp();
  IF NEW.status = 'running' THEN
    IF OLD.status = 'pending' THEN
      IF NEW.fencing_token IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'First publication lease must use fencing token one' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status = 'running' THEN
      IF NEW.fencing_token = OLD.fencing_token THEN
        IF NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
          OR NEW.lease_expires_at < OLD.lease_expires_at OR OLD.lease_expires_at <= observed_at THEN
          RAISE EXCEPTION 'Publication lease renewal requires its current unexpired owner' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.fencing_token::bigint = OLD.fencing_token::bigint + 1 THEN
        IF OLD.lease_expires_at > observed_at THEN
          RAISE EXCEPTION 'Publication lease takeover requires expiry' USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'Publication fencing token must advance by exactly one on takeover' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid publication lease transition' USING ERRCODE = '23514';
    END IF;
    IF NEW.lease_owner IS NULL OR NEW.lease_expires_at IS NULL
      OR NEW.lease_expires_at <= observed_at OR NEW.lease_expires_at > observed_at + interval '15 minutes' THEN
      RAISE EXCEPTION 'Publication lease must expire within the next fifteen minutes' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('pending', 'running') THEN
    IF NEW.fencing_token IS DISTINCT FROM OLD.fencing_token
      OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cancellation must preserve the fencing token and clear the lease' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'completed' AND OLD.status = 'running' THEN
    IF NEW.fencing_token IS DISTINCT FROM OLD.fencing_token
      OR NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR OLD.lease_expires_at <= observed_at THEN
      RAISE EXCEPTION 'Completion requires the current unexpired lease and clears it' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid publication run transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_publication_run() FROM PUBLIC;

CREATE TRIGGER signal_publication_runs_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.signal_publication_runs
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_publication_run();
CREATE TRIGGER signal_publication_runs_no_truncate_trg
  BEFORE TRUNCATE ON public.signal_publication_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_publication_run();
ALTER TABLE public.signal_publication_runs ENABLE ALWAYS TRIGGER signal_publication_runs_guard_trg;
ALTER TABLE public.signal_publication_runs ENABLE ALWAYS TRIGGER signal_publication_runs_no_truncate_trg;
