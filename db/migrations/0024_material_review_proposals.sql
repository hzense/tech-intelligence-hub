-- Private, untrusted material drafts and explicit owner confirmations. Neither
-- table constitutes a trusted verification report, attestation or publication.
CREATE TABLE public.candidate_material_proposals (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  plan_hash text NOT NULL CHECK (plan_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  proposal_hash text NOT NULL CHECK (proposal_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, owner_id) REFERENCES public.candidate_material_requests(id, owner_id),
  UNIQUE (request_id, proposal_hash),
  UNIQUE (id, request_id, owner_id, proposal_hash)
);

CREATE TABLE public.candidate_material_approvals (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL,
  request_id uuid NOT NULL,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  proposal_hash text NOT NULL CHECK (proposal_hash COLLATE "C" ~ '^[a-f0-9]{64}$'),
  approved_by text NOT NULL CHECK (approved_by = owner_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, owner_id) REFERENCES public.candidate_material_requests(id, owner_id),
  FOREIGN KEY (proposal_id, request_id, owner_id, proposal_hash)
    REFERENCES public.candidate_material_proposals(id, request_id, owner_id, proposal_hash),
  UNIQUE (proposal_id)
);

REVOKE ALL ON public.candidate_material_proposals, public.candidate_material_approvals FROM PUBLIC;

CREATE FUNCTION public.hzense_guard_material_proposals() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_NARGS <> 0 OR TG_WHEN <> 'BEFORE'
    OR TG_TABLE_NAME NOT IN ('candidate_material_proposals', 'candidate_material_approvals')
    OR NOT ((TG_LEVEL = 'ROW' AND TG_OP IN ('UPDATE', 'DELETE'))
      OR (TG_LEVEL = 'STATEMENT' AND TG_OP = 'TRUNCATE')) THEN
    RAISE EXCEPTION 'Invalid material proposal trigger attachment' USING ERRCODE = '55000';
  END IF;
  RAISE EXCEPTION 'Material proposals and approvals are append-only' USING ERRCODE = '55000';
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_material_proposals() FROM PUBLIC;
CREATE TRIGGER candidate_material_proposals_guard_trg
  BEFORE UPDATE OR DELETE ON public.candidate_material_proposals
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_material_proposals();
CREATE TRIGGER candidate_material_proposals_no_truncate_trg
  BEFORE TRUNCATE ON public.candidate_material_proposals
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_material_proposals();
CREATE TRIGGER candidate_material_approvals_guard_trg
  BEFORE UPDATE OR DELETE ON public.candidate_material_approvals
  FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_material_proposals();
CREATE TRIGGER candidate_material_approvals_no_truncate_trg
  BEFORE TRUNCATE ON public.candidate_material_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_material_proposals();
ALTER TABLE public.candidate_material_proposals ENABLE ALWAYS TRIGGER candidate_material_proposals_guard_trg;
ALTER TABLE public.candidate_material_proposals ENABLE ALWAYS TRIGGER candidate_material_proposals_no_truncate_trg;
ALTER TABLE public.candidate_material_approvals ENABLE ALWAYS TRIGGER candidate_material_approvals_guard_trg;
ALTER TABLE public.candidate_material_approvals ENABLE ALWAYS TRIGGER candidate_material_approvals_no_truncate_trg;

DO $private_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
    WHERE n.nspname='public'
      AND r.relname IN ('candidate_material_proposals','candidate_material_approvals')
      AND a.grantee<>r.relowner)
  THEN RAISE EXCEPTION 'Material proposal tables require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
