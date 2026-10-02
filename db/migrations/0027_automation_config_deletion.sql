-- Retain automation history and accounting while hiding deleted configurations.
-- The application must support the 0026/0027 role transition before this runs.
-- Column permissions are intentionally granted by a separate reviewed script.
ALTER TABLE public.automation_configs
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT automation_configs_deleted_state_check CHECK (
    deleted_at IS NULL OR (
      NOT enabled AND next_run_at IS NULL
      AND (config -> 'enabled') IS NOT DISTINCT FROM 'false'::jsonb
    )
  );
