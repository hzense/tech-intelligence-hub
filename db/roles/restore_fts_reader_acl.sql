-- HZense restricted FTS column ACL recovery CANDIDATE.
-- NOT approved for production. Requires reviewed same-branch R1/R2 evidence,
-- an independently verified isolated target, a fresh approval and a DDL freeze.
-- No production connection, workflow hook, credential or local operator CLI.
-- Read db/roles/README.fts-acl-recovery.md before considering execution.
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '45s';

DO $fts_acl_recovery$
DECLARE
  before_fingerprint text := current_setting('hzense.acl_recovery.before_fingerprint', true);
  after_fingerprint text := current_setting('hzense.acl_recovery.after_fingerprint', true);
  target_fingerprint text := current_setting('hzense.acl_recovery.target_fingerprint', true);
  production_fingerprint text := current_setting('hzense.acl_recovery.production_fingerprint', true);
  recovery_source_fingerprint text := current_setting('hzense.acl_recovery.source_fingerprint', true);
  approval_expires_at timestamptz := nullif(current_setting('hzense.acl_recovery.expires_at', true), '')::timestamptz;
  digest text;
  actual_target text;
  actual_fingerprint text;
  category_summary jsonb;
  runtime_role pg_roles%ROWTYPE;
  target_relation oid;
  owner_oid oid;
  pass integer;
  expected_columns constant text[] := ARRAY[
    'source_id', 'source_type', 'title', 'summary', 'href', 'keywords', 'body',
    'document_date', 'normalized_title', 'normalized_summary',
    'normalized_keywords', 'normalized_body'
  ];
BEGIN
  -- Declarations are NOT a substitute for external approval or evidence review.
  FOREACH digest IN ARRAY ARRAY[
    before_fingerprint, after_fingerprint, target_fingerprint,
    production_fingerprint, recovery_source_fingerprint
  ] LOOP
    IF digest IS NULL OR digest !~ '^[0-9a-f]{64}$'
      OR digest = repeat(substr(digest, 1, 1), 64) THEN
      RAISE EXCEPTION 'ACL recovery requires all five reviewed SHA-256 declarations';
    END IF;
  END LOOP;
  IF before_fingerprint = after_fingerprint
    OR target_fingerprint IN (production_fingerprint, recovery_source_fingerprint)
    OR production_fingerprint = recovery_source_fingerprint THEN
    RAISE EXCEPTION 'ACL recovery requires distinct states and isolated target bindings';
  END IF;
  IF approval_expires_at IS NULL OR approval_expires_at <= clock_timestamp()
    OR approval_expires_at > clock_timestamp() + interval '1 hour' THEN
    RAISE EXCEPTION 'ACL recovery requires a fresh bounded approval window';
  END IF;

  -- BEGIN NEON TARGET GUARD
  -- Only registered POSTMASTER settings are trusted, never custom placeholders.
  SELECT CASE WHEN count(*) = 3 AND bool_and(context = 'postmaster' AND setting <> '')
    THEN encode(sha256(convert_to(
      jsonb_object_agg(name, setting ORDER BY name)::text, 'UTF8'
    )), 'hex') ELSE NULL END
  INTO actual_target
  FROM pg_settings
  WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id');
  IF actual_target IS NULL OR actual_target IS DISTINCT FROM target_fingerprint THEN
    RAISE EXCEPTION 'ACL recovery requires the exact reviewed Neon branch and timeline';
  END IF;
  -- END NEON TARGET GUARD

  SELECT oid INTO owner_oid FROM pg_roles WHERE rolname = current_user;
  IF current_database() <> 'hzense'
    OR current_user <> 'hzense_migrator' OR session_user <> current_user
    OR (SELECT datdba FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM owner_oid
    OR current_setting('server_version_num')::integer / 10000 <> 18
    OR current_setting('transaction_read_only') <> 'off'
    OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ACL recovery database, authenticated owner or transaction mismatch';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925) THEN
    RAISE EXCEPTION 'Another HZense maintenance operation is active';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'ACL recovery refuses enabled event triggers; review side effects first';
  END IF;
  -- Locks cover the two projection tables; other administrators must honor
  -- the external DDL/ACL freeze and the shared maintenance advisory lock.
  LOCK TABLE public.search_documents, public.topics IN ACCESS EXCLUSIVE MODE;
  SELECT oid INTO target_relation FROM pg_class
    WHERE oid = to_regclass('public.search_documents') AND relkind = 'r'
      AND relowner = owner_oid AND NOT relrowsecurity AND NOT relforcerowsecurity;
  SELECT * INTO runtime_role FROM pg_roles WHERE rolname = 'hzense_runtime';
  IF target_relation IS NULL OR runtime_role.oid IS NULL
    OR NOT runtime_role.rolcanlogin OR runtime_role.rolinherit
    OR runtime_role.rolsuper OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole
    OR runtime_role.rolreplication OR runtime_role.rolbypassrls
    OR runtime_role.rolconnlimit <> 20 THEN
    RAISE EXCEPTION 'ACL recovery requires the reviewed Search owner and Runtime role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.topics'::regclass
      AND relkind = 'r' AND relowner = owner_oid AND NOT relrowsecurity
      AND NOT relforcerowsecurity
  ) OR (SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.topics'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname = ANY(ARRAY['id', 'title', 'parent_id', 'status', 'runtime_enabled'])) <> 5 THEN
    RAISE EXCEPTION 'ACL recovery requires the reviewed Topic owner and projection';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m WHERE m.member = runtime_role.oid
      OR (m.roleid = runtime_role.oid AND NOT (
        pg_get_userbyid(m.member) = 'neondb_owner'
        AND pg_get_userbyid(m.grantor) = 'cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
      ))
  ) THEN
    RAISE EXCEPTION 'ACL recovery refuses indirect Runtime role access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhrelid IN (target_relation, 'public.topics'::regclass)
       OR inhparent IN (target_relation, 'public.topics'::regclass)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.hzense_schema_migrations
    WHERE name = '0003_search_documents_fts.sql'
  ) OR (SELECT count(*) FROM pg_attribute
    WHERE attrelid = target_relation AND attnum > 0 AND NOT attisdropped) <> 18
  OR (SELECT count(*) FROM pg_attribute
    WHERE attrelid = target_relation AND attnum > 0 AND NOT attisdropped
      AND attname = ANY(expected_columns)) <> 12 THEN
    RAISE EXCEPTION 'ACL recovery requires the reviewed post-FTS schema';
  END IF;

  FOR pass IN 1..2 LOOP
    IF clock_timestamp() >= approval_expires_at THEN
      RAISE EXCEPTION 'ACL recovery approval expired during execution';
    END IF;
    -- Reject table/PUBLIC/inherited access; column REVOKE cannot cancel it.
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ]) AS p(privilege)
      WHERE has_table_privilege(runtime_role.oid, target_relation, p.privilege)
    ) THEN
      RAISE EXCEPTION 'ACL recovery refuses effective Search table privileges';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_attribute a
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
      WHERE a.attrelid = target_relation AND a.attnum > 0 AND NOT a.attisdropped
        AND (
          has_column_privilege(runtime_role.oid, target_relation, a.attnum, p.privilege)
            IS DISTINCT FROM (pass = 1 AND p.privilege = 'SELECT' AND a.attname = ANY(expected_columns))
          OR has_column_privilege(runtime_role.oid, target_relation, a.attnum,
            p.privilege || ' WITH GRANT OPTION')
        )
    ) THEN
      RAISE EXCEPTION 'ACL recovery Search effective column contract mismatch';
    END IF;
    IF pass = 1 AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = target_relation AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname = ANY(expected_columns) AND (
          SELECT count(*) FROM aclexplode(a.attacl) x
          WHERE x.grantee = runtime_role.oid AND x.grantor = owner_oid
            AND x.privilege_type = 'SELECT' AND NOT x.is_grantable
        ) <> 1
    ) THEN
      RAISE EXCEPTION 'ACL recovery requires twelve direct owner-issued non-grantable SELECTs';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ]) AS p(privilege)
      WHERE has_table_privilege(runtime_role.oid, 'public.topics', p.privilege)
    ) THEN
      RAISE EXCEPTION 'ACL recovery refuses effective Topic table privileges';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_attribute a
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
      WHERE a.attrelid = 'public.topics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND (
          has_column_privilege(runtime_role.oid, a.attrelid, a.attnum, p.privilege)
            IS DISTINCT FROM (p.privilege = 'SELECT' AND a.attname = ANY(
              ARRAY['id', 'title', 'parent_id', 'status', 'runtime_enabled']))
          OR has_column_privilege(runtime_role.oid, a.attrelid, a.attnum,
            p.privilege || ' WITH GRANT OPTION')
        )
    ) THEN
      RAISE EXCEPTION 'ACL recovery must preserve the five-column Topic contract';
    END IF;

    -- BEGIN SHARED ACL STATE QUERY
WITH
app_namespaces AS (
  SELECT oid FROM pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
),
catalog_rows AS (
  SELECT 'identity' AS category, jsonb_build_object(
    'database', current_database(), 'database_oid', oid,
    'owner', datdba, 'server_version_num', current_setting('server_version_num')
  ) AS item FROM pg_database WHERE datname = current_database()
  UNION ALL SELECT 'roles', to_jsonb(r) - 'rolpassword' FROM pg_roles r
  UNION ALL SELECT 'memberships', to_jsonb(m) FROM pg_auth_members m
  UNION ALL SELECT 'role_settings', to_jsonb(s) FROM pg_db_role_setting s
  UNION ALL SELECT 'databases', jsonb_build_object(
    'oid', oid, 'name', datname, 'owner', datdba, 'acl', datacl::text,
    'allow_connections', datallowconn, 'connection_limit', datconnlimit
  ) FROM pg_database
  UNION ALL SELECT 'schemas', jsonb_build_object(
    'oid', oid, 'name', nspname, 'owner', nspowner, 'acl', nspacl::text
  ) FROM pg_namespace WHERE oid IN (SELECT oid FROM app_namespaces)
  UNION ALL SELECT 'relations', jsonb_build_object(
    'oid', oid, 'namespace', relnamespace, 'name', relname, 'owner', relowner,
    'kind', relkind, 'acl', relacl::text, 'rls', relrowsecurity,
    'force_rls', relforcerowsecurity, 'persistence', relpersistence
  ) FROM pg_class WHERE relnamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL SELECT 'columns', jsonb_build_object(
    'relation', a.attrelid, 'number', a.attnum, 'name', a.attname,
    'type', a.atttypid, 'typmod', a.atttypmod, 'not_null', a.attnotnull,
    'dropped', a.attisdropped, 'generated', a.attgenerated,
    'identity', a.attidentity, 'acl', a.attacl::text
  ) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace IN (SELECT oid FROM app_namespaces) AND a.attnum > 0
  UNION ALL SELECT 'types', jsonb_build_object(
    'oid', oid, 'namespace', typnamespace, 'name', typname,
    'owner', typowner, 'kind', typtype, 'acl', typacl::text
  ) FROM pg_type WHERE typnamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL SELECT 'routines', jsonb_build_object(
    'oid', oid, 'namespace', pronamespace, 'name', proname, 'owner', proowner,
    'arguments', proargtypes::text, 'kind', prokind, 'security_definer', prosecdef,
    'acl', proacl::text, 'settings', proconfig
  ) FROM pg_proc WHERE pronamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL SELECT 'default_privileges', to_jsonb(d) FROM pg_default_acl d
  UNION ALL SELECT 'policies', to_jsonb(p) FROM pg_policy p
  UNION ALL SELECT 'inheritance', to_jsonb(i) FROM pg_inherits i
),
category_digests AS (
  SELECT category, count(*) AS row_count,
    encode(sha256(convert_to(
      jsonb_agg(item ORDER BY item::text COLLATE "C")::text, 'UTF8'
    )), 'hex') AS fingerprint
  FROM catalog_rows GROUP BY category
),
state AS (
  SELECT jsonb_build_object(
    'format', 'hzense-fts-acl-state/v1',
    'categories', jsonb_agg(to_jsonb(d) ORDER BY category COLLATE "C")
  ) AS summary FROM category_digests d
)
SELECT encode(sha256(convert_to(summary::text, 'UTF8')), 'hex') AS fingerprint,
  summary INTO actual_fingerprint, category_summary
FROM state;
    -- END SHARED ACL STATE QUERY
    IF actual_fingerprint IS DISTINCT FROM
      CASE WHEN pass = 1 THEN before_fingerprint ELSE after_fingerprint END THEN
      RAISE EXCEPTION 'ACL recovery catalog fingerprint mismatch at pass %', pass;
    END IF;
    IF pass = 1 THEN
      REVOKE SELECT (
        source_id, source_type, title, summary, href, keywords, body,
        document_date, normalized_title, normalized_summary,
        normalized_keywords, normalized_body
      ) ON TABLE public.search_documents FROM hzense_runtime RESTRICT;
    END IF;
  END LOOP;
END
$fts_acl_recovery$;

COMMIT;
