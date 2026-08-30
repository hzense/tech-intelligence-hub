-- Persist the runtime Topic projection separately from the canonical taxonomy.
-- Existing active and strategic Topics were already runtime-facing before this
-- distinction existed; watching and archived Topics remain disabled by default.
ALTER TABLE topics
  ADD COLUMN runtime_enabled boolean NOT NULL DEFAULT false;

UPDATE topics
SET runtime_enabled = status IN ('active', 'strategic');

ALTER TABLE topics
  ADD CONSTRAINT topics_runtime_enabled_status_ck
  CHECK (NOT runtime_enabled OR status <> 'archived');
