-- Read-only, same-cluster ACL drift fingerprint; not the hosted baseline format.
-- No raw settings, ACL rows, credentials or business data are returned.
-- Capture R1 and R2 in separate fresh connections on the SAME reviewed branch.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '45s';

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
  summary
FROM state;
-- END SHARED ACL STATE QUERY

-- This digest is an identity, not evidence that the branch is isolated.
-- Verify the topology separately in Neon before any write approval.
SELECT CASE WHEN count(*) = 3 AND bool_and(context = 'postmaster' AND setting <> '')
  THEN encode(sha256(convert_to(
    jsonb_object_agg(name, setting ORDER BY name)::text, 'UTF8'
  )), 'hex')
  ELSE NULL END AS neon_target_fingerprint
FROM pg_settings
WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id');

ROLLBACK;
