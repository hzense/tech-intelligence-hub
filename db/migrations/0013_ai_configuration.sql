-- Private administrator configuration only. This does not enable collection,
-- scheduling, model calls or publication, and grants no application role access.
-- Immutable history is enforced by the dedicated service role's INSERT-only
-- privileges; database owners remain trusted migration/maintenance principals.
CREATE TABLE public.ai_connections (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  protocol text NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL,
  encrypted_key jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_connections_revision_ck CHECK (revision >= 1),
  CONSTRAINT ai_connections_protocol_ck CHECK (protocol = 'openai-compatible'),
  CONSTRAINT ai_connections_settings_ck CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT ai_connections_encrypted_key_ck CHECK (encrypted_key IS NULL OR jsonb_typeof(encrypted_key) = 'object')
);
CREATE TABLE public.ai_connection_versions (
  connection_id uuid NOT NULL REFERENCES public.ai_connections(id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, revision),
  CONSTRAINT ai_connection_versions_revision_ck CHECK (revision >= 1),
  CONSTRAINT ai_connection_versions_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE TABLE public.ai_profiles (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  stages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_profiles_revision_ck CHECK (revision >= 1),
  CONSTRAINT ai_profiles_stages_ck CHECK (jsonb_typeof(stages) = 'object')
);
CREATE TABLE public.ai_profile_versions (
  profile_id uuid NOT NULL REFERENCES public.ai_profiles(id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, revision),
  CONSTRAINT ai_profile_versions_revision_ck CHECK (revision >= 1),
  CONSTRAINT ai_profile_versions_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE TABLE public.ai_probe_runs (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL,
  connection_revision integer NOT NULL,
  kind text NOT NULL,
  model_id text,
  fingerprint text NOT NULL,
  status text NOT NULL,
  configuration jsonb NOT NULL,
  reserved_microusd bigint NOT NULL DEFAULT 0,
  charged_microusd bigint NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  result jsonb NOT NULL DEFAULT '{}',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (connection_id, connection_revision) REFERENCES public.ai_connection_versions(connection_id, revision),
  CONSTRAINT ai_probe_runs_kind_ck CHECK (kind IN ('models', 'connection', 'structured_output', 'tool_calling')),
  CONSTRAINT ai_probe_runs_fingerprint_ck CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ai_probe_runs_status_ck CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'stale')),
  CONSTRAINT ai_probe_runs_configuration_ck CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT ai_probe_runs_reserved_microusd_ck CHECK (reserved_microusd >= 0),
  CONSTRAINT ai_probe_runs_charged_microusd_ck CHECK (charged_microusd >= 0),
  CONSTRAINT ai_probe_runs_input_tokens_ck CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT ai_probe_runs_output_tokens_ck CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT ai_probe_runs_result_ck CHECK (jsonb_typeof(result) = 'object')
);
CREATE INDEX ai_probe_runs_connection_created_idx ON public.ai_probe_runs(connection_id, created_at);
REVOKE ALL ON public.ai_connections, public.ai_connection_versions, public.ai_profiles,
  public.ai_profile_versions, public.ai_probe_runs FROM PUBLIC;
-- An owner may have pre-existing default grants to another application role.
-- Refuse that inherited access rather than exposing configuration or silently
-- rewriting any pre-existing ACL/default-privilege policy. The runner rolls
-- this migration back atomically, including its ledger entry, on failure.
DO $private_acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) permission
    WHERE namespace.nspname='public'
      AND relation.relname IN ('ai_connections','ai_connection_versions','ai_profiles','ai_profile_versions','ai_probe_runs')
      AND permission.grantee<>relation.relowner
  ) THEN
    RAISE EXCEPTION 'AI configuration tables require owner-only ACLs before explicit provisioning';
  END IF;
END;
$private_acl$;
