-- One-time 0022 least-privilege upgrade for hzense_generation_admin.
-- Run only as the hzense database owner in an approved maintenance window.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '30s';
DO $candidate_enrichment_upgrade$
DECLARE
  target oid := (SELECT oid FROM pg_roles WHERE rolname='hzense_generation_admin');
  allowed_before jsonb := '{"signal_generation_runs":{"SELECT":["id","owner_id","batch_id","item_id","source_fence","source_hash","profile_id","profile_revision","generation_version","fingerprint","snapshot","configuration","status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","created_at","finished_at","deleted_at","progress_phase","progress_at","started_at"],"INSERT":["id","owner_id","batch_id","item_id","source_fence","source_hash","profile_id","profile_revision","generation_version","fingerprint","snapshot","configuration"],"UPDATE":["status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","finished_at","deleted_at","progress_phase","progress_at","started_at"]}}'::jsonb;
  allowed_after jsonb := allowed_before || '{"candidate_enrichment_runs":{"SELECT":["id","owner_id","run_id","candidate_index","material_hash","profile_id","profile_revision","fingerprint","snapshot","configuration","status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","progress_phase","progress_at","started_at","created_at","finished_at"],"INSERT":["id","owner_id","run_id","candidate_index","material_hash","profile_id","profile_revision","fingerprint","snapshot","configuration"],"UPDATE":["status","lease_token","lease_until","budget_day","reserved_microusd","charged_microusd","result","error_code","progress_phase","progress_at","started_at","finished_at"]}}'::jsonb;
  expected_before integer := 51;
  expected_after integer := 96;
BEGIN
  IF current_database()<>'hzense' OR current_user<>session_user
    OR current_user<>pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname=current_database())) THEN
    RAISE EXCEPTION 'Authenticated hzense database owner required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations
    WHERE name='0022_candidate_enrichment_runs.sql' AND checksum='9a9e2a5052350c40c36d0e290cfadf0324ae5a81042d18a25c3b222354543557') THEN
    RAISE EXCEPTION 'Verify candidate enrichment migration ledger';
  END IF;
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=target AND rolcanlogin
    AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit=2 AND rolconfig IS NULL) THEN
    RAISE EXCEPTION 'Exact generation role required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE a.grantee=target) THEN RAISE EXCEPTION 'Table-level role grants are forbidden'; END IF;
  IF (SELECT count(*) FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE a.grantee=target)<>expected_before THEN RAISE EXCEPTION 'Unexpected pre-upgrade column ACL'; END IF;
  IF (WITH allowed AS (
      SELECT table_name,privilege,column_name FROM jsonb_each(allowed_before) t(table_name,grants),
      LATERAL jsonb_each(grants) p(privilege,columns),LATERAL jsonb_array_elements_text(columns) c(column_name)
    ) SELECT EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class rel ON rel.oid=col.attrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE a.grantee=target AND (n.nspname<>'public' OR a.is_grantable OR a.grantor<>rel.relowner
        OR NOT EXISTS(SELECT 1 FROM allowed x WHERE x.table_name=rel.relname
          AND x.column_name=col.attname AND upper(x.privilege)=a.privilege_type)))
    OR EXISTS(SELECT 1 FROM allowed x WHERE NOT EXISTS(SELECT 1 FROM pg_attribute col
      JOIN pg_class rel ON rel.oid=col.attrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE n.nspname='public' AND rel.relname=x.table_name
        AND col.attname=x.column_name AND a.grantee=target AND a.privilege_type=upper(x.privilege)
        AND NOT a.is_grantable AND a.grantor=rel.relowner))) THEN
    RAISE EXCEPTION 'Exact pre-upgrade generation column ACL required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
    CROSS JOIN LATERAL aclexplode(col.attacl) a
    WHERE c.oid='public.candidate_enrichment_runs'::regclass AND a.grantee=target) THEN
    RAISE EXCEPTION 'Candidate enrichment ACL already partially applied';
  END IF;

  GRANT SELECT(id,owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision,fingerprint,snapshot,configuration,status,lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,result,error_code,progress_phase,progress_at,started_at,created_at,finished_at),
    INSERT(id,owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision,fingerprint,snapshot,configuration),
    UPDATE(status,lease_token,lease_until,budget_day,reserved_microusd,charged_microusd,result,error_code,progress_phase,progress_at,started_at,finished_at)
    ON public.candidate_enrichment_runs TO hzense_generation_admin;

  IF (SELECT count(*) FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE a.grantee=target)<>expected_after THEN RAISE EXCEPTION 'Unexpected post-upgrade column ACL'; END IF;
  IF (WITH allowed AS (
      SELECT table_name,privilege,column_name FROM jsonb_each(allowed_after) t(table_name,grants),
      LATERAL jsonb_each(grants) p(privilege,columns),LATERAL jsonb_array_elements_text(columns) c(column_name)
    ) SELECT EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class rel ON rel.oid=col.attrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE a.grantee=target AND (n.nspname<>'public' OR a.is_grantable OR a.grantor<>rel.relowner
        OR NOT EXISTS(SELECT 1 FROM allowed x WHERE x.table_name=rel.relname
          AND x.column_name=col.attname AND upper(x.privilege)=a.privilege_type)))
    OR EXISTS(SELECT 1 FROM allowed x WHERE NOT EXISTS(SELECT 1 FROM pg_attribute col
      JOIN pg_class rel ON rel.oid=col.attrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
      CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE n.nspname='public' AND rel.relname=x.table_name
        AND col.attname=x.column_name AND a.grantee=target AND a.privilege_type=upper(x.privilege)
        AND NOT a.is_grantable AND a.grantor=rel.relowner))) THEN
    RAISE EXCEPTION 'Exact post-upgrade generation column ACL required';
  END IF;
END;
$candidate_enrichment_upgrade$;
COMMIT;
