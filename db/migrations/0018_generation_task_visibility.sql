-- User deletion hides tasks while preserving accounting and replay identity.
ALTER TABLE public.signal_generation_runs ADD COLUMN deleted_at timestamptz;
