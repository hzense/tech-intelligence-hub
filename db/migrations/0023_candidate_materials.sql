-- Private source supplements and signed registration reports. These records do
-- not publish a candidate or grant factual verification to its claims.
CREATE TABLE public.candidate_material_requests (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  run_id uuid NOT NULL REFERENCES public.signal_generation_runs(id),
  candidate_index integer NOT NULL CHECK (candidate_index BETWEEN 0 AND 4),
  base_material_hash text NOT NULL CHECK (base_material_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  bundle_hash text NOT NULL CHECK (bundle_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  fingerprint text NOT NULL CHECK (fingerprint COLLATE "C" ~ '^[a-f0-9]{64}$'),
  bundle jsonb NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, run_id, candidate_index, base_material_hash, bundle_hash),
  UNIQUE (id, owner_id)
);

CREATE TABLE public.candidate_material_reports (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  plan_hash text NOT NULL CHECK (plan_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  attestation jsonb NOT NULL CHECK (jsonb_typeof(attestation) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, owner_id) REFERENCES public.candidate_material_requests(id, owner_id),
  UNIQUE (request_id, plan_hash),
  UNIQUE (id, request_id, owner_id, plan_hash)
);

CREATE TABLE public.candidate_material_receipts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  report_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  plan_hash text NOT NULL CHECK (plan_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  stage text NOT NULL CHECK (stage IN ('registered', 'verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, owner_id) REFERENCES public.candidate_material_requests(id, owner_id),
  FOREIGN KEY (report_id, request_id, owner_id, plan_hash)
    REFERENCES public.candidate_material_reports(id, request_id, owner_id, plan_hash),
  UNIQUE (report_id, stage)
);

REVOKE ALL ON public.candidate_material_requests, public.candidate_material_reports,
  public.candidate_material_receipts FROM PUBLIC;

-- Lock-only capability: callers supply an immutable report identity, never SQL,
-- arbitrary registry IDs or a plan body. Direct dedicated service logins only.
CREATE FUNCTION public.hzense_lock_material_dependencies(p_report_id uuid, p_owner_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $material_lock$
DECLARE
  material jsonb;
  source_ids text[];
  evidence_ids text[];
  entity_ids text[];
  topic_ids text[];
BEGIN
  IF session_user NOT IN ('hzense_material_registrar','hzense_material_verifier')
    OR current_setting('role') <> 'none' THEN
    RAISE EXCEPTION 'Material dependency locks require a dedicated direct login' USING ERRCODE='42501';
  END IF;
  IF p_report_id IS NULL OR p_owner_id IS NULL OR length(p_owner_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid material lock identity' USING ERRCODE='22023';
  END IF;
  SELECT report.plan INTO material
    FROM public.candidate_material_reports report
    JOIN public.candidate_material_requests request ON request.id=report.request_id AND request.owner_id=report.owner_id
    WHERE report.id=p_report_id AND report.owner_id=p_owner_id
      AND report.plan->>'version'='material-registration-v1'
      AND report.plan->>'owner'=p_owner_id
      AND report.plan->>'runId'=request.run_id::text
      AND report.plan->>'candidateIndex'=request.candidate_index::text
      AND report.plan->>'baseMaterialHash'=request.base_material_hash
      AND report.plan->>'sourceBundleHash'=request.bundle_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material lock report not found or not bound to request' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(material->'sources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(material->'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(material->'entities') IS DISTINCT FROM 'array'
    OR jsonb_typeof(material->'topicIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid material dependency arrays' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(material->'sources') NOT BETWEEN 1 AND 8
    OR jsonb_array_length(material->'evidence') NOT BETWEEN 1 AND 20
    OR jsonb_array_length(material->'entities') NOT BETWEEN 1 AND 12
    OR jsonb_array_length(material->'topicIds') NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Material dependency bounds exceeded' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((material->'sources') || (material->'evidence') || (material->'entities')) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
        OR (item->>'id') COLLATE "C" !~ '^[a-z0-9][a-z0-9._:-]{0,199}$')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(material->'topicIds') item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR (item #>> '{}') COLLATE "C" !~ '^[a-z0-9][a-z0-9._:-]{0,199}$') THEN
    RAISE EXCEPTION 'Invalid material dependency IDs' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(item->>'id') INTO source_ids FROM jsonb_array_elements(material->'sources') item;
  SELECT array_agg(item->>'id') INTO evidence_ids FROM jsonb_array_elements(material->'evidence') item;
  SELECT array_agg(item->>'id') INTO entity_ids FROM jsonb_array_elements(material->'entities') item;
  SELECT array_agg(item) INTO topic_ids FROM jsonb_array_elements_text(material->'topicIds') item;
  PERFORM 1 FROM public.sources WHERE id=ANY(source_ids) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.public_source_evidence WHERE id=ANY(evidence_ids) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.entities WHERE id=ANY(entity_ids) ORDER BY id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.person_profiles WHERE entity_id=ANY(entity_ids) ORDER BY entity_id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.organization_profiles WHERE entity_id=ANY(entity_ids) ORDER BY entity_id COLLATE "C" FOR SHARE;
  PERFORM 1 FROM public.topics WHERE id=ANY(topic_ids) ORDER BY id COLLATE "C" FOR SHARE;
END;
$material_lock$;
REVOKE ALL ON FUNCTION public.hzense_lock_material_dependencies(uuid,text) FROM PUBLIC;

CREATE FUNCTION public.hzense_guard_candidate_materials() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE'
    OR TG_TABLE_NAME NOT IN ('candidate_material_requests', 'candidate_material_reports', 'candidate_material_receipts')
    OR NOT ((TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE', 'DELETE'))
      OR (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')) THEN
    RAISE EXCEPTION 'Invalid candidate material trigger attachment' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'Candidate material records are append-only' USING ERRCODE = '55000';
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_candidate_materials() FROM PUBLIC;

-- Role membership alone is insufficient: the executor must explicitly SET ROLE
-- to the narrow stage identity. Owners cannot bypass this stage boundary.
CREATE FUNCTION public.hzense_guard_candidate_material_receipt_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $receipt_guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'candidate_material_receipts'
    OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' OR TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Invalid material receipt stage trigger attachment' USING ERRCODE = '55000';
  END IF;
  IF NOT ((current_user = 'hzense_material_registrar' AND NEW.stage = 'registered')
    OR (current_user = 'hzense_material_verifier' AND NEW.stage = 'verified')) THEN
    RAISE EXCEPTION 'Material receipt stage requires its dedicated service role' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$receipt_guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_candidate_material_receipt_insert() FROM PUBLIC;

CREATE TRIGGER candidate_material_receipts_insert_guard_trg
  BEFORE INSERT ON public.candidate_material_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_material_receipt_insert();
ALTER TABLE public.candidate_material_receipts ENABLE ALWAYS TRIGGER candidate_material_receipts_insert_guard_trg;

CREATE TRIGGER candidate_material_requests_guard_trg
  BEFORE UPDATE OR DELETE ON public.candidate_material_requests
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_materials();
CREATE TRIGGER candidate_material_requests_no_truncate_trg
  BEFORE TRUNCATE ON public.candidate_material_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_candidate_materials();
CREATE TRIGGER candidate_material_reports_guard_trg
  BEFORE UPDATE OR DELETE ON public.candidate_material_reports
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_materials();
CREATE TRIGGER candidate_material_reports_no_truncate_trg
  BEFORE TRUNCATE ON public.candidate_material_reports
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_candidate_materials();
CREATE TRIGGER candidate_material_receipts_guard_trg
  BEFORE UPDATE OR DELETE ON public.candidate_material_receipts
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_candidate_materials();
CREATE TRIGGER candidate_material_receipts_no_truncate_trg
  BEFORE TRUNCATE ON public.candidate_material_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_candidate_materials();
ALTER TABLE public.candidate_material_requests ENABLE ALWAYS TRIGGER candidate_material_requests_guard_trg;
ALTER TABLE public.candidate_material_requests ENABLE ALWAYS TRIGGER candidate_material_requests_no_truncate_trg;
ALTER TABLE public.candidate_material_reports ENABLE ALWAYS TRIGGER candidate_material_reports_guard_trg;
ALTER TABLE public.candidate_material_reports ENABLE ALWAYS TRIGGER candidate_material_reports_no_truncate_trg;
ALTER TABLE public.candidate_material_receipts ENABLE ALWAYS TRIGGER candidate_material_receipts_guard_trg;
ALTER TABLE public.candidate_material_receipts ENABLE ALWAYS TRIGGER candidate_material_receipts_no_truncate_trg;

-- Inherited default ACLs must also be private; provisioning is a separate step.
DO $private_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public'
      AND r.relname IN ('candidate_material_requests','candidate_material_reports','candidate_material_receipts')
      AND a.grantee<>r.relowner)
  THEN RAISE EXCEPTION 'Candidate material tables require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
