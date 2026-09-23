-- Private, billable AI enrichment proposals. They never create entities,
-- public evidence, reviews, verification records or publications.
CREATE TABLE public.candidate_enrichment_runs (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL,
 run_id uuid NOT NULL REFERENCES public.signal_generation_runs(id),
 candidate_index integer NOT NULL,
 material_hash text NOT NULL,
 profile_id uuid NOT NULL,
 profile_revision integer NOT NULL,
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
 progress_phase text,
 progress_at timestamptz,
 started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CONSTRAINT candidate_enrichment_index_ck CHECK(candidate_index BETWEEN 0 AND 4),
 CONSTRAINT candidate_enrichment_profile_revision_ck CHECK(profile_revision > 0),
 CONSTRAINT candidate_enrichment_material_hash_ck CHECK(material_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT candidate_enrichment_fingerprint_ck CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 CONSTRAINT candidate_enrichment_snapshot_ck CHECK(jsonb_typeof(snapshot)='object'),
 CONSTRAINT candidate_enrichment_configuration_ck CHECK(jsonb_typeof(configuration)='object'),
 CONSTRAINT candidate_enrichment_status_ck CHECK(status IN ('pending','running','completed','failed','unknown')),
 CONSTRAINT candidate_enrichment_progress_ck CHECK(progress_phase IS NULL OR progress_phase IN ('queued','preparing','generating','validating','saving')),
 CONSTRAINT candidate_enrichment_reserved_ck CHECK(reserved_microusd >= 0),
 CONSTRAINT candidate_enrichment_charged_ck CHECK(charged_microusd >= 0),
 CONSTRAINT candidate_enrichment_result_ck CHECK(result IS NULL OR (jsonb_typeof(result)='object' AND result->>'classification' IS NOT DISTINCT FROM 'private'))
);
-- Failed attempts may be retried only through a new, explicit request. Pending,
-- running, completed and unknown tasks retain semantic uniqueness.
CREATE UNIQUE INDEX candidate_enrichment_identity_uq ON public.candidate_enrichment_runs(owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision) WHERE status<>'failed';
CREATE INDEX candidate_enrichment_owner_created_idx ON public.candidate_enrichment_runs(owner_id,created_at DESC);
CREATE INDEX candidate_enrichment_budget_day_idx ON public.candidate_enrichment_runs(budget_day);
REVOKE ALL ON public.candidate_enrichment_runs FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
 WHERE n.nspname='public' AND r.relname='candidate_enrichment_runs' AND a.grantee<>r.relowner)
 THEN RAISE EXCEPTION 'Candidate enrichment runs require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
