-- HZense private Signal snapshot assembler privilege contract.
-- Requires an administrator-created hzense_signal_writer, authenticated migration
-- owner and verified migrations through 0007. No role/password creation, no PUBLIC
-- revocation, no default-ACL rewrite and no automatic recovery of unsafe grants.
-- This trusted internal writer is neither AI intake nor a reviewer/publisher.
-- Run the complete schema verifier first and freeze owner/migrator DDL for this
-- maintenance window; the marker/stamp checks below are not a substitute for it.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $hzense_signal_writer$
DECLARE
  writer pg_roles%ROWTYPE;
  database_info pg_database%ROWTYPE;
  relation_info record;
  privilege_info record;
  column_info record;
  phase integer;
  has_existing_acl boolean;
  columns_sql text;
  select_tables text[] := ARRAY[
    'sources', 'entities', 'topics', 'person_profiles', 'organization_profiles', 'signals',
    'public_source_evidence', 'signal_versions', 'signal_version_evidence', 'signal_version_people',
    'signal_version_organizations', 'signal_version_topics', 'signal_event_identities',
    'hzense_schema_migrations'
  ];
  insert_columns jsonb := $writer_columns${
    "signals": ["id","title","type","occurred_at","captured_at","source_id","source_url","summary","importance","strength","confidence","novelty","metadata"],
    "public_source_evidence": ["id","source_id","source_url","locator","excerpt","content_hash","captured_at","source_published_at"],
    "signal_versions": ["signal_id","version","schema_version","title","type","occurred_at","date_precision","date_basis","captured_at","summary","analysis","importance","strength","confidence","novelty","revision_reason","origin","legacy_status","content_hash"],
    "signal_version_evidence": ["signal_id","version","evidence_id","claim","relation"],
    "signal_version_people": ["signal_id","version","person_id","evidence_id","event_role"],
    "signal_version_organizations": ["signal_id","version","organization_id","evidence_id","event_role"],
    "signal_version_topics": ["signal_id","version","topic_id"],
    "signal_event_identities": ["signal_id","event_key","basis_version","basis_evidence_id","identity_basis"]
  }$writer_columns$::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955, 1298498925) THEN
    RAISE EXCEPTION 'HZense migration lock busy; refusing Signal writer configuration';
  END IF;
  SELECT * INTO database_info FROM pg_database WHERE datname = current_database();
  IF session_user <> current_user THEN
    RAISE EXCEPTION 'Run as authenticated migration owner without SET ROLE';
  END IF;
  IF pg_get_userbyid(database_info.datdba) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'Run as owner of current_database()';
  END IF;
  SELECT * INTO writer FROM pg_roles WHERE rolname = 'hzense_signal_writer';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator must pre-create hzense_signal_writer';
  END IF;
  IF NOT writer.rolcanlogin OR writer.rolinherit OR writer.rolconnlimit <> 2
     OR writer.rolsuper OR writer.rolcreatedb OR writer.rolcreaterole
     OR writer.rolreplication OR writer.rolbypassrls THEN
    RAISE EXCEPTION 'hzense_signal_writer requires LOGIN NOINHERIT CONNECTION LIMIT 2 and no privileged attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = writer.oid OR roleid = writer.oid) THEN
    RAISE EXCEPTION 'hzense_signal_writer must have no incoming or outgoing role memberships';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole = writer.oid) THEN
    RAISE EXCEPTION 'hzense_signal_writer must have no role-specific configuration settings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = writer.oid AND deptype = 'o') THEN
    RAISE EXCEPTION 'hzense_signal_writer must not own objects';
  END IF;
  IF to_regclass('public.hzense_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Required migration ledger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hzense_schema_migrations WHERE name = '0007_signal_version_immutability.sql') THEN
    RAISE EXCEPTION '0007_signal_version_immutability.sql must be applied and verified first';
  END IF;
  FOREACH columns_sql IN ARRAY select_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = columns_sql AND c.relkind = 'r'
        AND pg_get_userbyid(c.relowner) = current_user) THEN
      RAISE EXCEPTION 'Missing or non-owned required table: %', columns_sql;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('signal_versions', 'public_source_evidence', 'signal_event_identities')
        AND a.attname = 'created_xid' AND a.atttypid = 'xid8'::regtype AND a.attnotnull AND NOT a.attisdropped) <> 3 THEN
    RAISE EXCEPTION 'Immutable-row transaction stamps are missing';
  END IF;

  -- Direct grants elsewhere, ownership, role settings and membership cannot be
  -- repaired by this current-database configurator. Fail before issuing any grant.
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = writer.oid AND deptype = 'a'
      AND (dbid NOT IN (0, database_info.oid) OR classid NOT IN ('pg_database'::regclass, 'pg_namespace'::regclass, 'pg_class'::regclass))) THEN
    RAISE EXCEPTION 'Writer has unapproved cross-database or non-table ACL dependencies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
      WHERE a.grantee = writer.oid AND (d.oid <> database_info.oid OR a.privilege_type <> 'CONNECT' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Writer has unexpected database privileges';
  END IF;
  IF has_database_privilege(writer.oid, database_info.oid, 'CREATE') OR has_database_privilege(writer.oid, database_info.oid, 'TEMPORARY') THEN
    RAISE EXCEPTION 'Unsafe writer or PUBLIC database CREATE/TEMPORARY privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d WHERE d.oid <> database_info.oid AND d.datallowconn
      AND (has_database_privilege(writer.oid, d.oid, 'CONNECT') OR has_database_privilege(writer.oid, d.oid, 'CREATE') OR has_database_privilege(writer.oid, d.oid, 'TEMPORARY'))) THEN
    RAISE EXCEPTION 'Unsafe effective writer privileges on another connectable database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND ((n.nspname <> 'public' AND has_schema_privilege(writer.oid, n.oid, 'USAGE'))
          OR has_schema_privilege(writer.oid, n.oid, 'CREATE'))) THEN
    RAISE EXCEPTION 'Unsafe writer or PUBLIC application-schema privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      WHERE a.grantee = writer.oid AND (n.nspname <> 'public' OR a.privilege_type <> 'USAGE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Writer has unexpected direct schema privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE a.grantee = writer.oid OR (a.grantee = 0 AND d.defaclobjtype IN ('r', 'S', 'f'))) THEN
    RAISE EXCEPTION 'Unsafe writer or PUBLIC default ACLs require separate review';
  END IF;
  -- Absent global function defaults still mean PostgreSQL PUBLIC EXECUTE.
  IF EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole = database_info.datdba AND defaclnamespace = 0 AND defaclobjtype = 'f'), acldefault('f', database_info.datdba))) a WHERE a.grantee IN (0, writer.oid)) THEN
    RAISE EXCEPTION 'Migration owner function defaults still expose PUBLIC or writer execution';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND (a.grantee = writer.oid OR (a.grantee = 0 AND NOT EXISTS (
          SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid AND dep.deptype = 'e'
        )))) THEN
    RAISE EXCEPTION 'Unsafe writer or PUBLIC application-function execution privileges';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = writer.oid AND deptype = 'a') INTO has_existing_acl;

  FOR phase IN 0..1 LOOP
    -- Raw table and column ACLs are checked separately: table-level revocation
    -- would not remove independently granted INSERT/UPDATE on protected columns.
    FOR privilege_info IN
      SELECT n.nspname, c.relname, c.relkind, a.grantee, a.privilege_type, a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) a
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND (a.grantee = writer.oid OR (a.grantee = 0 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))
    LOOP
      IF privilege_info.grantee = 0 OR privilege_info.is_grantable
         OR privilege_info.nspname <> 'public' OR privilege_info.relkind <> 'r'
         OR NOT privilege_info.relname = ANY(select_tables) OR privilege_info.privilege_type <> 'SELECT' THEN
        RAISE EXCEPTION 'Unexpected writer or PUBLIC table/sequence privilege on %.%', privilege_info.nspname, privilege_info.relname;
      END IF;
    END LOOP;
    FOR privilege_info IN
      SELECT n.nspname, c.relname, col.attname, a.grantee, a.privilege_type, a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute col ON col.attrelid = c.oid
      CROSS JOIN LATERAL aclexplode(col.attacl) a
      WHERE col.attnum > 0 AND NOT col.attisdropped
        AND (a.grantee = writer.oid OR (a.grantee = 0 AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))
    LOOP
      IF privilege_info.grantee = 0 OR privilege_info.is_grantable OR privilege_info.nspname <> 'public'
         OR privilege_info.privilege_type <> 'INSERT'
         OR NOT coalesce((insert_columns -> privilege_info.relname) ? privilege_info.attname, false) THEN
        RAISE EXCEPTION 'Unexpected writer or PUBLIC column privilege on %.%.%', privilege_info.nspname, privilege_info.relname, privilege_info.attname;
      END IF;
    END LOOP;
    IF has_existing_acl OR phase = 1 THEN
      IF NOT EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE d.oid = database_info.oid AND a.grantee = writer.oid AND a.privilege_type = 'CONNECT')
         OR NOT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname = 'public' AND a.grantee = writer.oid AND a.privilege_type = 'USAGE') THEN
        RAISE EXCEPTION 'Existing writer ACL is partial rather than the exact reviewed contract';
      END IF;
      IF NOT has_database_privilege(writer.oid, database_info.oid, 'CONNECT') OR NOT has_schema_privilege(writer.oid, 'public', 'USAGE') THEN
        RAISE EXCEPTION 'Writer is missing CONNECT or schema USAGE';
      END IF;
      FOREACH columns_sql IN ARRAY select_tables LOOP
        IF NOT has_table_privilege(writer.oid, format('public.%I', columns_sql), 'SELECT') THEN
          RAISE EXCEPTION 'Writer is missing required SELECT on %', columns_sql;
        END IF;
      END LOOP;
      FOR relation_info IN SELECT key AS table_name, value FROM jsonb_each(insert_columns) LOOP
        FOR column_info IN SELECT jsonb_array_elements_text(relation_info.value) AS column_name LOOP
          IF NOT has_column_privilege(writer.oid, format('public.%I', relation_info.table_name), column_info.column_name, 'INSERT') THEN
            RAISE EXCEPTION 'Writer is missing required column INSERT on %.%', relation_info.table_name, column_info.column_name;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
    IF phase = 0 THEN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_signal_writer', current_database());
      GRANT USAGE ON SCHEMA public TO hzense_signal_writer;
      FOREACH columns_sql IN ARRAY select_tables LOOP
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO hzense_signal_writer', columns_sql);
      END LOOP;
      FOR relation_info IN SELECT key AS table_name, value FROM jsonb_each(insert_columns) LOOP
        SELECT string_agg(format('%I', value), ', ') INTO columns_sql FROM jsonb_array_elements_text(relation_info.value);
        EXECUTE format('GRANT INSERT (%s) ON TABLE public.%I TO hzense_signal_writer', columns_sql, relation_info.table_name);
      END LOOP;
    END IF;
  END LOOP;
END
$hzense_signal_writer$;

COMMIT;
