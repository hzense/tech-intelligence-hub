-- Private import state only. No sources, Signal seals or public projections change.
-- Provision a dedicated service role separately; never reuse a public/AI role.
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  fingerprint text NOT NULL,
  intent text NOT NULL,
  configuration jsonb NOT NULL,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_fingerprint_ck CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT import_batches_intent_ck CHECK (intent IN ('preview', 'generate_publish')),
  CONSTRAINT import_batches_configuration_ck CHECK (jsonb_typeof(configuration) = 'object')
);
CREATE INDEX import_batches_owner_created_idx ON public.import_batches(owner_id, created_at);
CREATE TABLE public.import_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.import_batches(id),
  position integer NOT NULL,
  kind text NOT NULL,
  declaration jsonb NOT NULL,
  status text NOT NULL,
  fence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_items_position_ck CHECK (position >= 0),
  CONSTRAINT import_items_kind_ck CHECK (kind IN ('file', 'url')),
  CONSTRAINT import_items_declaration_ck CHECK (jsonb_typeof(declaration) = 'object'),
  CONSTRAINT import_items_status_ck CHECK (status IN ('awaiting_upload', 'queued', 'running', 'completed', 'failed', 'unknown', 'cancelled')),
  CONSTRAINT import_items_fence_ck CHECK (fence >= 0)
);
CREATE UNIQUE INDEX import_items_batch_position_idx ON public.import_items(batch_id, position);
CREATE INDEX import_items_status_created_idx ON public.import_items(status, created_at);
-- Each item pins one immutable original. A changed original requires a new item.
CREATE TABLE public.import_documents (
  item_id uuid PRIMARY KEY REFERENCES public.import_items(id),
  object_key text NOT NULL,
  object_version text NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  format text NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_documents_sha256_ck CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT import_documents_size_ck CHECK (byte_size > 0 AND byte_size <= 26214400),
  CONSTRAINT import_documents_format_ck CHECK (format IN ('pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx', 'png', 'jpeg')),
  CONSTRAINT import_documents_metadata_ck CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE TABLE public.import_attempts (
  item_id uuid NOT NULL REFERENCES public.import_items(id),
  fence integer NOT NULL,
  parser_version text NOT NULL,
  status text NOT NULL,
  lease_until timestamptz NOT NULL,
  budget_day date NOT NULL,
  reserved_microusd bigint NOT NULL,
  charged_microusd bigint NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (item_id, fence),
  CONSTRAINT import_attempts_fence_ck CHECK (fence > 0),
  CONSTRAINT import_attempts_status_ck CHECK (status IN ('running', 'completed', 'failed', 'unknown', 'cancelled')),
  CONSTRAINT import_attempts_reserved_ck CHECK (reserved_microusd >= 0),
  CONSTRAINT import_attempts_charged_ck CHECK (charged_microusd >= 0)
);
-- Append-only output envelope: bounded fragments with page/paragraph/cell locators.
CREATE TABLE public.import_outputs (
  item_id uuid NOT NULL REFERENCES public.import_documents(item_id),
  fence integer NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, fence),
  FOREIGN KEY (item_id, fence) REFERENCES public.import_attempts(item_id, fence),
  CONSTRAINT import_outputs_content_ck CHECK (jsonb_typeof(content) = 'object')
);
CREATE TABLE public.import_audit (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.import_batches(id),
  item_id uuid REFERENCES public.import_items(id),
  event text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_audit_event_ck CHECK (event IN ('created', 'received', 'claimed', 'completed', 'failed', 'unknown', 'cancelled', 'retried'))
);
CREATE INDEX import_audit_batch_created_idx ON public.import_audit(batch_id, created_at);
CREATE TABLE public.import_daily_usage (
  day date PRIMARY KEY,
  reserved_microusd bigint NOT NULL DEFAULT 0,
  charged_microusd bigint NOT NULL DEFAULT 0,
  CONSTRAINT import_daily_usage_reserved_ck CHECK (reserved_microusd >= 0),
  CONSTRAINT import_daily_usage_charged_ck CHECK (charged_microusd >= 0)
);
REVOKE ALL ON public.import_batches, public.import_items, public.import_documents,
  public.import_attempts, public.import_outputs, public.import_audit, public.import_daily_usage FROM PUBLIC;
DO $private_acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class r
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public'
      AND r.relname IN ('import_batches','import_items','import_documents','import_attempts','import_outputs','import_audit','import_daily_usage')
      AND a.grantee<>r.relowner
  ) THEN
    RAISE EXCEPTION 'Import tables require owner-only ACLs before explicit provisioning';
  END IF;
END;
$private_acl$;
