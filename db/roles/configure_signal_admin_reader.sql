-- Reviewed opt-in candidate: never run from migrations, web startup or a probe.
-- Authenticate as the database owner after exact schema verification. An admin
-- must pre-create EMPTY hzense_signal_admin_reader LOGIN NOINHERIT CONNECTION LIMIT 2.
-- No passwords/roles are created here. Refuse existing rights, do not repair
-- PUBLIC/other-role privileges. The service can only read explicit summary columns.
-- PostgreSQL retains a bootstrap-superuser ADMIN-only grant to a non-superuser
-- creator. Accept only Neon's exact neondb_owner -> hzense_signal_admin_reader management
-- edge, granted by cloud_admin with neither INHERIT nor SET. It gives the Signal
-- reader no provider privileges. Never create, revoke or repair memberships here.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $signal_admin_reader$
DECLARE target pg_roles%ROWTYPE; database_owner oid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
  SELECT datdba INTO database_owner FROM pg_database WHERE datname=current_database();
  IF session_user<>current_user OR pg_get_userbyid(database_owner)<>current_user THEN
    RAISE EXCEPTION 'Authenticated database owner required';
  END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname='hzense_signal_admin_reader';
  IF NOT FOUND OR NOT target.rolcanlogin OR target.rolinherit OR target.rolconnlimit<>2
    OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls THEN
    RAISE EXCEPTION 'Pre-create a restricted hzense_signal_admin_reader LOGIN NOINHERIT CONNECTION LIMIT 2';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=target.oid OR roleid=target.oid)>1
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
      AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a')) THEN
    RAISE EXCEPTION 'Signal workbench reader must have no ownership, unsafe memberships, settings or existing direct ACLs';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0012_current_signal_publication.sql') THEN
    RAISE EXCEPTION 'Verify migration 0012 before Signal workbench reader provisioning';
  END IF;
  IF has_database_privilege(target.oid,current_database(),'CREATE') OR has_database_privilege(target.oid,current_database(),'TEMPORARY')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
      AND (has_schema_privilege(target.oid,oid,'CREATE') OR (nspname<>'public' AND has_schema_privilege(target.oid,oid,'USAGE')))) THEN
    RAISE EXCEPTION 'Remove unsafe ambient database/schema capabilities in separately approved maintenance';
  END IF;
  -- PUBLIC privileges apply even to NOINHERIT roles. Inspect every connectable
  -- database without changing its ACL. Only the same exact provider-owned
  -- reserved-database shapes accepted by the runtime reader are exempt.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname<>current_database() AND d.datallowconn
    AND (has_database_privilege(target.oid,d.oid,'CONNECT') OR has_database_privilege(target.oid,d.oid,'CREATE')
      OR has_database_privilege(target.oid,d.oid,'TEMPORARY'))
    AND NOT (
      pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
      AND NOT has_database_privilege(target.oid,d.oid,'CONNECT WITH GRANT OPTION')
      AND NOT has_database_privilege(target.oid,d.oid,'CREATE')
      AND NOT has_database_privilege(target.oid,d.oid,'CREATE WITH GRANT OPTION')
      AND NOT has_database_privilege(target.oid,d.oid,'TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
        WHERE a.grantee=target.oid OR (a.grantee=0 AND a.is_grantable))
      AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND has_database_privilege(target.oid,d.oid,'CONNECT') AND has_database_privilege(target.oid,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(target.oid,d.oid,'CONNECT') AND NOT has_database_privilege(target.oid,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))
    )) THEN
    RAISE EXCEPTION 'Signal workbench reader has unsafe privileges on another connectable database';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) grant_row
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND grant_row.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target.oid,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Ambient application data/function privileges are not permitted';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO hzense_signal_admin_reader',current_database());
END;
$signal_admin_reader$;
GRANT USAGE ON SCHEMA public TO hzense_signal_admin_reader;
-- Explicit summary columns only. No raw evidence excerpts/locators, metadata,
-- content hashes, report payloads, dependency seals, credentials or write access.
GRANT SELECT (signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,created_at) ON public.signal_versions TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,version,evidence_id,claim,relation) ON public.signal_version_evidence TO hzense_signal_admin_reader;
GRANT SELECT (id,source_id,source_url,captured_at,source_published_at,verification_status) ON public.public_source_evidence TO hzense_signal_admin_reader;
GRANT SELECT (id,name,active) ON public.sources TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,version,person_id,evidence_id,event_role,verification_status) ON public.signal_version_people TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,version,organization_id,evidence_id,event_role,verification_status) ON public.signal_version_organizations TO hzense_signal_admin_reader;
GRANT SELECT (id,name,type,status) ON public.entities TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,version,topic_id) ON public.signal_version_topics TO hzense_signal_admin_reader;
GRANT SELECT (id,title) ON public.topics TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,content_version,publication_revision,status,occurred_at) ON public.signal_publication_state TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,version,publication_revision) ON public.current_public_signals TO hzense_signal_admin_reader;
GRANT SELECT (verification_id,signal_id,source_version,decision,checks,verified_at,expires_at) ON public.signal_candidate_verifications TO hzense_signal_admin_reader;
GRANT SELECT (verification_id,invalidated) ON public.signal_verification_dependency_seals TO hzense_signal_admin_reader;
GRANT SELECT (verification_id,signal_id,source_version,target_version) ON public.signal_candidate_assembly_receipts TO hzense_signal_admin_reader;
GRANT SELECT (signal_id,source_version,target_version) ON public.signal_qualified_publication_receipts TO hzense_signal_admin_reader;
GRANT EXECUTE ON FUNCTION public.hzense_public_signal_is_current(uuid) TO hzense_signal_admin_reader;

-- GRANT may only warn when the authenticated owner lacks a grant option. Check
-- both effective privileges and the exact direct ACL before committing anything.
DO $signal_admin_reader_verify$
DECLARE
  target oid := 'hzense_signal_admin_reader'::regrole;
  target_role pg_roles%ROWTYPE;
  relation_info record;
  column_info record;
  checked_privilege text;
  expected boolean;
  read_columns jsonb := $columns${
  "signal_versions": [
    "signal_id",
    "version",
    "title",
    "type",
    "occurred_at",
    "date_precision",
    "date_basis",
    "captured_at",
    "summary",
    "analysis",
    "importance",
    "strength",
    "confidence",
    "novelty",
    "revision_reason",
    "origin",
    "created_at"
  ],
  "signal_version_evidence": [
    "signal_id",
    "version",
    "evidence_id",
    "claim",
    "relation"
  ],
  "public_source_evidence": [
    "id",
    "source_id",
    "source_url",
    "captured_at",
    "source_published_at",
    "verification_status"
  ],
  "sources": [
    "id",
    "name",
    "active"
  ],
  "signal_version_people": [
    "signal_id",
    "version",
    "person_id",
    "evidence_id",
    "event_role",
    "verification_status"
  ],
  "signal_version_organizations": [
    "signal_id",
    "version",
    "organization_id",
    "evidence_id",
    "event_role",
    "verification_status"
  ],
  "entities": [
    "id",
    "name",
    "type",
    "status"
  ],
  "signal_version_topics": [
    "signal_id",
    "version",
    "topic_id"
  ],
  "topics": [
    "id",
    "title"
  ],
  "signal_publication_state": [
    "signal_id",
    "content_version",
    "publication_revision",
    "status",
    "occurred_at"
  ],
  "current_public_signals": [
    "signal_id",
    "version",
    "publication_revision"
  ],
  "signal_candidate_verifications": [
    "verification_id",
    "signal_id",
    "source_version",
    "decision",
    "checks",
    "verified_at",
    "expires_at"
  ],
  "signal_verification_dependency_seals": [
    "verification_id",
    "invalidated"
  ],
  "signal_candidate_assembly_receipts": [
    "verification_id",
    "signal_id",
    "source_version",
    "target_version"
  ],
  "signal_qualified_publication_receipts": [
    "signal_id",
    "source_version",
    "target_version"
  ]
}$columns$::jsonb;
BEGIN
  -- Re-read role attributes and memberships after GRANT. No role mutation is
  -- allowed to bypass the commit gate; this does not prevent later drift.
  SELECT * INTO target_role FROM pg_roles WHERE oid=target;
  IF NOT FOUND OR NOT target_role.rolcanlogin OR target_role.rolinherit OR target_role.rolconnlimit<>2
    OR target_role.rolsuper OR target_role.rolcreatedb OR target_role.rolcreaterole
    OR target_role.rolreplication OR target_role.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target)
    OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target AND deptype='o') THEN
    RAISE EXCEPTION 'Signal workbench reader role contract mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=target OR roleid=target)>1
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=target OR m.roleid=target)
      AND (m.roleid=target AND pg_get_userbyid(m.member)='neondb_owner'
        AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Signal workbench reader membership contract mismatch';
  END IF;
  IF NOT has_database_privilege(target,current_database(),'CONNECT')
    OR has_database_privilege(target,current_database(),'CONNECT WITH GRANT OPTION')
    OR has_database_privilege(target,current_database(),'CREATE')
    OR has_database_privilege(target,current_database(),'TEMPORARY')
    OR (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
      WHERE d.datname=current_database() AND a.grantee=target AND a.privilege_type='CONNECT' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'Signal workbench reader database privilege contract mismatch';
  END IF;
  -- Recheck effective cross-database privileges after GRANT. Drift visible at
  -- this check fails provisioning; this does not lock other databases' ACLs or
  -- prevent later changes. Keep the operator's maintenance freeze in place.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname<>current_database() AND d.datallowconn
    AND (has_database_privilege(target,d.oid,'CONNECT') OR has_database_privilege(target,d.oid,'CREATE')
      OR has_database_privilege(target,d.oid,'TEMPORARY'))
    AND NOT (
      pg_get_userbyid(d.datdba)='cloud_admin' AND d.datconnlimit=-1
      AND NOT has_database_privilege(target,d.oid,'CONNECT WITH GRANT OPTION')
      AND NOT has_database_privilege(target,d.oid,'CREATE')
      AND NOT has_database_privilege(target,d.oid,'CREATE WITH GRANT OPTION')
      AND NOT has_database_privilege(target,d.oid,'TEMPORARY WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
        WHERE a.grantee=target OR (a.grantee=0 AND a.is_grantable))
      AND ((d.datname='postgres' AND NOT d.datistemplate AND d.datacl IS NULL
        AND has_database_privilege(target,d.oid,'CONNECT') AND has_database_privilege(target,d.oid,'TEMPORARY')
        AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT','TEMPORARY']::text[])
        OR (d.datname='template1' AND d.datistemplate AND d.datacl IS NOT NULL
          AND has_database_privilege(target,d.oid,'CONNECT') AND NOT has_database_privilege(target,d.oid,'TEMPORARY')
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
            FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]))
    )) THEN
    RAISE EXCEPTION 'Signal workbench reader has unsafe privileges on another connectable database';
  END IF;
  IF NOT has_schema_privilege(target,'public','USAGE')
    OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(target,n.oid,'CREATE') OR has_schema_privilege(target,n.oid,'USAGE WITH GRANT OPTION')
        OR (n.nspname<>'public' AND has_schema_privilege(target,n.oid,'USAGE'))))
    OR (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname='public' AND a.grantee=target AND a.privilege_type='USAGE' AND NOT a.is_grantable) THEN
    RAISE EXCEPTION 'Signal workbench reader schema privilege contract mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=target) THEN
    RAISE EXCEPTION 'Signal workbench reader must have no direct table or sequence privileges';
  END IF;
  FOR relation_info IN
    SELECT c.oid,c.relname,c.relkind,c.relowner,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
  LOOP
    -- Use PostgreSQL's own privilege list, including privileges added by newer
    -- server versions, rather than overlooking a future table-level capability.
    FOR checked_privilege IN SELECT a.privilege_type FROM aclexplode(acldefault(
      CASE WHEN relation_info.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,relation_info.relowner)) a
    LOOP
      IF relation_info.relkind='S' THEN
        IF has_sequence_privilege(target,relation_info.oid,checked_privilege) THEN
          RAISE EXCEPTION 'Signal workbench reader effective sequence privilege contract mismatch';
        END IF;
      ELSIF has_table_privilege(target,relation_info.oid,checked_privilege) THEN
        RAISE EXCEPTION 'Signal workbench reader effective table privilege contract mismatch';
      END IF;
    END LOOP;
    FOR column_info IN SELECT a.attnum,a.attname FROM pg_attribute a
      WHERE a.attrelid=relation_info.oid AND a.attnum>0 AND NOT a.attisdropped AND relation_info.relkind<>'S'
    LOOP
      FOREACH checked_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        expected := relation_info.nspname='public'
          AND relation_info.relkind=CASE WHEN relation_info.relname='current_public_signals' THEN 'v'::"char" ELSE 'r'::"char" END
          AND checked_privilege='SELECT' AND COALESCE((read_columns->relation_info.relname)?column_info.attname,false);
        IF has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege) IS DISTINCT FROM expected
          OR has_column_privilege(target,relation_info.oid,column_info.attnum,checked_privilege||' WITH GRANT OPTION') THEN
          RAISE EXCEPTION 'Signal workbench reader effective column privilege contract mismatch on %.%.%',
            relation_info.nspname,relation_info.relname,column_info.attname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS(
    WITH expected_acl AS (
      SELECT 'public'::name AS schema_name,e.key::name AS table_name,c.column_name::name AS column_name,'SELECT'::text AS privilege_name
      FROM jsonb_each(read_columns) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) c(column_name)
    ), actual_acl AS (
      SELECT n.nspname AS schema_name,c.relname AS table_name,col.attname AS column_name,a.privilege_type AS privilege_name,a.is_grantable
      FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE a.grantee=target
    )
    SELECT 1 FROM (
      (SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl WHERE NOT is_grantable)
      UNION ALL
      (SELECT schema_name,table_name,column_name,privilege_name FROM actual_acl
        EXCEPT ALL SELECT schema_name,table_name,column_name,privilege_name FROM expected_acl)
    ) difference
  ) THEN
    RAISE EXCEPTION 'Signal workbench reader direct column ACL contract mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=target)<>1
    OR NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=target
      AND p.oid='public.hzense_public_signal_is_current(uuid)'::regprocedure AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
    OR NOT has_function_privilege(target,'public.hzense_public_signal_is_current(uuid)','EXECUTE')
    OR has_function_privilege(target,'public.hzense_public_signal_is_current(uuid)','EXECUTE WITH GRANT OPTION')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(target,p.oid,'EXECUTE')
      AND p.oid<>'public.hzense_public_signal_is_current(uuid)'::regprocedure
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Signal workbench reader function privilege contract mismatch';
  END IF;
END;
$signal_admin_reader_verify$;
COMMIT;
