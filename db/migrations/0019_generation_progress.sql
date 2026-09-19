-- Private execution metadata only. Existing snapshots and ledger remain immutable.
-- Role column grants are a separate, explicitly approved operation.
ALTER TABLE public.signal_generation_runs
  ADD COLUMN progress_phase text,
  ADD COLUMN progress_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD CONSTRAINT signal_generation_progress_ck CHECK
    (progress_phase IS NULL OR progress_phase IN ('queued','preparing','generating','validating','saving'));
