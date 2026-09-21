-- Private append-only human review history. No generation result is changed.
CREATE TABLE public.candidate_reviews (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL,
 owner_id text NOT NULL,
 run_id uuid NOT NULL REFERENCES public.signal_generation_runs(id),
 candidate_index integer NOT NULL,
 revision integer NOT NULL,
 material_hash text NOT NULL,
 fingerprint text NOT NULL,
 decision text NOT NULL,
 note text NOT NULL,
 draft jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT candidate_reviews_index_ck CHECK (candidate_index BETWEEN 0 AND 4),
 CONSTRAINT candidate_reviews_revision_ck CHECK (revision > 0),
 CONSTRAINT candidate_reviews_hash_ck CHECK (material_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT candidate_reviews_fingerprint_ck CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 CONSTRAINT candidate_reviews_decision_ck CHECK (decision IN ('draft','needs_evidence','rejected','submit_verification')),
 CONSTRAINT candidate_reviews_draft_ck CHECK (jsonb_typeof(draft) = 'object')
);
CREATE UNIQUE INDEX candidate_reviews_request_uq ON public.candidate_reviews(request_id);
CREATE UNIQUE INDEX candidate_reviews_revision_uq ON public.candidate_reviews(run_id,candidate_index,revision);
REVOKE ALL ON public.candidate_reviews FROM PUBLIC;
CREATE TABLE public.candidate_review_conversions (
 request_key text PRIMARY KEY,
 review_id uuid NOT NULL REFERENCES public.candidate_reviews(id),
 owner_id text NOT NULL,
 signal_id text NOT NULL REFERENCES public.signals(id),
 source_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(signal_id,source_version) REFERENCES public.signal_versions(signal_id,version),
 CONSTRAINT candidate_review_conversions_version_ck CHECK(source_version > 0),
 CONSTRAINT candidate_review_conversions_request_ck CHECK(request_key ~ '^[A-Za-z0-9._:-]{1,200}$')
);
CREATE UNIQUE INDEX candidate_review_conversions_review_uq ON public.candidate_review_conversions(review_id);
REVOKE ALL ON public.candidate_review_conversions FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
 WHERE n.nspname='public' AND r.relname IN ('candidate_reviews','candidate_review_conversions') AND a.grantee<>r.relowner)
 THEN RAISE EXCEPTION 'Review table requires owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
