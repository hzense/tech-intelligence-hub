-- Private scheduling metadata only. Import/generation keep their own roles,
-- budgets and durable receipts; automation has no publication permissions.
CREATE TABLE public.automation_configs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  revision integer NOT NULL CHECK (revision>0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
  enabled boolean NOT NULL,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,owner_id)
);
CREATE INDEX automation_configs_due_idx ON public.automation_configs(enabled,next_run_at);
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY,
  config_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  config_revision integer NOT NULL CHECK (config_revision>0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  slot text NOT NULL CHECK (length(slot) BETWEEN 1 AND 100),
  trigger text NOT NULL CHECK (trigger IN ('manual','scheduled')),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','unknown','cancelled')),
  phase text NOT NULL CHECK (length(phase) BETWEEN 1 AND 60),
  result jsonb,
  frozen_inputs jsonb CHECK(frozen_inputs IS NULL OR jsonb_typeof(frozen_inputs)='object'),
  error_code text,
  lease_token uuid,
  lease_until timestamptz,
  budget_day date,
  reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0),
  charged_microusd bigint NOT NULL DEFAULT 0 CHECK(charged_microusd>=0),
  cost_source text CHECK(cost_source IS NULL OR cost_source IN ('provider','estimate','reserve')),
  publication_status text NOT NULL DEFAULT 'private' CHECK(publication_status IN ('private','published','withdrawn')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY(config_id,owner_id) REFERENCES public.automation_configs(id,owner_id),
  UNIQUE(config_id,slot),
  CHECK(result IS NULL OR jsonb_typeof(result)='object'),
  CHECK(error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,79}$')
);
CREATE INDEX automation_runs_owner_created_idx ON public.automation_runs(owner_id,created_at);
CREATE INDEX automation_runs_budget_day_idx ON public.automation_runs(budget_day);
CREATE VIEW public.published_topic_insights WITH(security_barrier=true) AS
SELECT id,result,published_at FROM public.automation_runs
WHERE status='completed' AND publication_status='published' AND snapshot->>'kind'='topic_insight';
REVOKE ALL ON public.automation_configs,public.automation_runs,public.published_topic_insights FROM PUBLIC;
DO $private_acl$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public' AND r.relname IN ('automation_configs','automation_runs','published_topic_insights') AND a.grantee<>r.relowner)
  THEN RAISE EXCEPTION 'Automation tables require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
