CREATE TABLE public.candidate_review_attestations (
 verification_id uuid PRIMARY KEY,
 review_id uuid NOT NULL REFERENCES public.candidate_reviews(id),
 owner_id text NOT NULL,
 key_id text NOT NULL,
 payload text NOT NULL,
 signature text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT candidate_review_attestations_key_ck CHECK(length(key_id) BETWEEN 1 AND 200),
 CONSTRAINT candidate_review_attestations_payload_ck CHECK(length(payload) BETWEEN 1 AND 262144),
 CONSTRAINT candidate_review_attestations_signature_ck CHECK(length(signature) BETWEEN 1 AND 1024)
);
REVOKE ALL ON public.candidate_review_attestations FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) a
 WHERE n.nspname='public' AND r.relname='candidate_review_attestations' AND a.grantee<>r.relowner)
 THEN RAISE EXCEPTION 'Attestations require owner-only ACL before explicit provisioning'; END IF;
END;
$private_acl$;
CREATE FUNCTION public.hzense_guard_review_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
 RAISE EXCEPTION 'Candidate review history is append-only' USING ERRCODE='55000';
END;
$guard$;
REVOKE ALL ON FUNCTION public.hzense_guard_review_history() FROM PUBLIC;
CREATE TRIGGER candidate_review_attestations_guard_trg BEFORE UPDATE OR DELETE ON public.candidate_review_attestations FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_review_history();
CREATE TRIGGER candidate_review_attestations_no_truncate_trg BEFORE TRUNCATE ON public.candidate_review_attestations FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_review_history();
CREATE TRIGGER candidate_reviews_guard_trg BEFORE UPDATE OR DELETE ON public.candidate_reviews FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_review_history();
CREATE TRIGGER candidate_reviews_no_truncate_trg BEFORE TRUNCATE ON public.candidate_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_review_history();
CREATE TRIGGER candidate_review_conversions_guard_trg BEFORE UPDATE OR DELETE ON public.candidate_review_conversions FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_review_history();
CREATE TRIGGER candidate_review_conversions_no_truncate_trg BEFORE TRUNCATE ON public.candidate_review_conversions FOR EACH STATEMENT EXECUTE FUNCTION public.hzense_guard_review_history();
ALTER TABLE public.candidate_review_attestations ENABLE ALWAYS TRIGGER candidate_review_attestations_guard_trg;
ALTER TABLE public.candidate_review_attestations ENABLE ALWAYS TRIGGER candidate_review_attestations_no_truncate_trg;
ALTER TABLE public.candidate_reviews ENABLE ALWAYS TRIGGER candidate_reviews_guard_trg;
ALTER TABLE public.candidate_reviews ENABLE ALWAYS TRIGGER candidate_reviews_no_truncate_trg;
ALTER TABLE public.candidate_review_conversions ENABLE ALWAYS TRIGGER candidate_review_conversions_guard_trg;
ALTER TABLE public.candidate_review_conversions ENABLE ALWAYS TRIGGER candidate_review_conversions_no_truncate_trg;
-- Restricted publication controller locks configuration without UPDATE authority.
CREATE FUNCTION public.hzense_lock_candidate_publication_task(p_task_id uuid, p_principal_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $control$
BEGIN
 PERFORM 1 FROM public.signal_publication_control WHERE singleton FOR SHARE;
 PERFORM 1 FROM public.signal_publication_tasks WHERE task_id=p_task_id FOR UPDATE;
 PERFORM 1 FROM public.signal_publication_authorizations WHERE task_id=p_task_id AND principal_id=p_principal_id FOR SHARE;
END;
$control$;
REVOKE ALL ON FUNCTION public.hzense_lock_candidate_publication_task(uuid,uuid) FROM PUBLIC;
