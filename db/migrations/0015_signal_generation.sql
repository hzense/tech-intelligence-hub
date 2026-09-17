-- Private preview-only AI generation. Explicit source snapshots cross services;
-- no generation credential can read import originals, AI keys or public Signals.
CREATE TABLE public.signal_generation_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  batch_id uuid NOT NULL,
  item_id uuid NOT NULL,
  source_fence integer NOT NULL,
  source_hash text NOT NULL,
  profile_id uuid NOT NULL,
  profile_revision integer NOT NULL,
  generation_version text NOT NULL,
  fingerprint text NOT NULL,
  snapshot jsonb NOT NULL,
  configuration jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  lease_token uuid,
  lease_until timestamptz,
  budget_day date,
  reserved_microusd bigint NOT NULL DEFAULT 0,
  charged_microusd bigint NOT NULL DEFAULT 0,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT signal_generation_source_fence_ck CHECK (source_fence > 0),
  CONSTRAINT signal_generation_profile_revision_ck CHECK (profile_revision > 0),
  CONSTRAINT signal_generation_source_hash_ck CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_generation_fingerprint_ck CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_generation_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT signal_generation_configuration_ck CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT signal_generation_status_ck CHECK (status IN ('pending','running','completed','failed','unknown','cancelled')),
  CONSTRAINT signal_generation_reserved_ck CHECK (reserved_microusd >= 0),
  CONSTRAINT signal_generation_charged_ck CHECK (charged_microusd >= 0),
  CONSTRAINT signal_generation_result_ck CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND result->>'classification' IS NOT DISTINCT FROM 'private'))
);
CREATE UNIQUE INDEX signal_generation_source_profile_idx ON public.signal_generation_runs
  (owner_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version);
CREATE INDEX signal_generation_owner_created_idx ON public.signal_generation_runs(owner_id,created_at);
CREATE INDEX signal_generation_budget_day_idx ON public.signal_generation_runs(budget_day);
CREATE INDEX signal_generation_batch_idx ON public.signal_generation_runs(batch_id);
REVOKE ALL ON public.signal_generation_runs FROM PUBLIC;
DO $private_acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public' AND r.relname='signal_generation_runs' AND a.grantee<>r.relowner
  ) THEN RAISE EXCEPTION 'Generation table requires owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
