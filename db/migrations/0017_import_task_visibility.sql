-- User deletion hides tasks while preserving accounting and replay identity.
ALTER TABLE public.import_batches ADD COLUMN deleted_at timestamptz;
