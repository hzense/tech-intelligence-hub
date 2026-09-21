import { signalWriterInsertColumns, signalWriterSelectTables } from './signal-writer-contract.mjs';
import { candidateVerificationFunctionHashes } from './candidate-verification-catalog.mjs';

const edgeNames = [
  'signal_version_evidence',
  'signal_version_people',
  'signal_version_organizations',
  'signal_version_topics',
];
const versionInsert = {
  signal_versions: signalWriterInsertColumns.signal_versions,
  ...Object.fromEntries(edgeNames.map((name) => [name, signalWriterInsertColumns[name]])),
};
export const candidatePipelineRoles = Object.freeze({
  hzense_candidate_assembler: {
    select: [...signalWriterSelectTables, 'candidate_reviews', 'candidate_review_conversions'],
    readColumns: {
      signal_generation_runs: [
        'id',
        'owner_id',
        'status',
        'deleted_at',
        'snapshot',
        'source_hash',
        'result',
      ],
    },
    insert: {
      ...Object.fromEntries(
        Object.entries(signalWriterInsertColumns).filter(
          ([name]) => name !== 'public_source_evidence',
        ),
      ),
      candidate_review_conversions: [
        'request_key',
        'review_id',
        'owner_id',
        'signal_id',
        'source_version',
      ],
    },
    update: {},
    functions: [],
  },
  hzense_candidate_verifier: {
    select: [
      ...signalWriterSelectTables.filter((name) => name !== 'hzense_schema_migrations'),
      'signal_candidate_verifications',
      'signal_candidate_assembly_receipts',
      'candidate_review_attestations',
    ],
    readColumns: {},
    insert: {
      ...versionInsert,
      signal_version_people: [
        ...signalWriterInsertColumns.signal_version_people,
        'verification_status',
      ],
      signal_version_organizations: [
        ...signalWriterInsertColumns.signal_version_organizations,
        'verification_status',
      ],
      signal_candidate_verifications: [
        'verification_id',
        'signal_id',
        'source_version',
        'source_content_hash',
        'bundle_fingerprint',
        'verifier_id',
        'policy_version',
        'report_hash',
        'decision',
        'checks',
        'verified_at',
        'expires_at',
      ],
      signal_candidate_assembly_receipts: [
        'request_key',
        'request_fingerprint',
        'verification_id',
        'signal_id',
        'source_version',
        'target_version',
        'content_hash',
      ],
      candidate_review_attestations: [
        'verification_id',
        'review_id',
        'owner_id',
        'key_id',
        'payload',
        'signature',
      ],
    },
    // SELECT FOR SHARE inside the immutable assembly guard requires a column UPDATE grant.
    // The exact ALWAYS guard/body is checked below, so this does not permit mutation.
    update: { signal_candidate_verifications: ['verification_id'] },
    functions: ['public.hzense_lock_publication_dependencies(text,integer)'],
  },
  hzense_publication_controller: {
    select: [
      'signal_publication_runs',
      'signal_publication_tasks',
      'signal_publication_control',
      'signal_publication_authorizations',
    ],
    readColumns: {},
    insert: { signal_publication_runs: ['run_id', 'task_id', 'principal_id', 'original_intent'] },
    update: {
      signal_publication_runs: ['status', 'fencing_token', 'lease_owner', 'lease_expires_at'],
    },
    functions: ['public.hzense_lock_candidate_publication_task(uuid,uuid)'],
  },
  // Existing publisher contract, audited here but provisioned only by its own SQL.
  hzense_publisher: {
    select: [
      ...signalWriterSelectTables,
      'signal_publication_control',
      'signal_publication_tasks',
      'signal_publication_authorizations',
      'signal_publication_runs',
      'signal_publication_state',
      'signal_publication_outbox',
      'signal_qualified_publication_receipts',
      'signal_candidate_verifications',
      'signal_candidate_assembly_receipts',
      'signal_verification_dependency_seals',
      'signal_publication_permits',
      'current_public_signals',
    ],
    readColumns: {},
    insert: {
      ...versionInsert,
      signal_version_people: [
        ...signalWriterInsertColumns.signal_version_people,
        'verification_status',
      ],
      signal_version_organizations: [
        ...signalWriterInsertColumns.signal_version_organizations,
        'verification_status',
      ],
      signal_publication_outbox: [
        'event_id',
        'request_key',
        'request_fingerprint',
        'signal_id',
        'expected_revision',
        'publication_revision',
        'content_version',
        'status',
        'reason_code',
        'occurred_at',
      ],
      signal_publication_state: [
        'signal_id',
        'publication_revision',
        'content_version',
        'status',
        'event_id',
        'occurred_at',
      ],
      signal_qualified_publication_receipts: [
        'request_key',
        'request_fingerprint',
        'signal_id',
        'source_version',
        'target_version',
        'run_id',
        'lease_owner',
        'fencing_token',
      ],
      signal_publication_permits: ['event_id', 'verification_id', 'dependency_seal'],
    },
    update: {
      signal_publication_state: [
        'publication_revision',
        'content_version',
        'status',
        'event_id',
        'occurred_at',
      ],
    },
    functions: [
      'public.hzense_lock_publication_controls(uuid)',
      'public.hzense_lock_publication_dependencies(text,integer)',
      'public.hzense_public_signal_is_current(uuid)',
    ],
  },
});

// Names are selected exclusively from this static contract, never request input.
function roleContract(role) {
  if (!Object.hasOwn(candidatePipelineRoles, role))
    throw new Error('candidate_pipeline_role_invalid');
  return candidatePipelineRoles[role];
}
export function candidatePipelineAuditSQL(role, runtime = true) {
  const contract = roleContract(role);
  const plan = JSON.stringify(contract).replaceAll("'", "''");
  return `WITH target AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname='${role}'),
  plan AS (SELECT '${plan}'::jsonb AS acl),
  relations AS (SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S'))
  SELECT COALESCE((SELECT
    ${runtime ? `current_user='${role}' AND session_user=current_user AND` : ''}
    t.rolcanlogin AND t.rolconnlimit=2 AND NOT (t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype='o')
    AND has_database_privilege(t.oid,current_database(),'CONNECT')
    AND NOT has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION')
    AND has_schema_privilege(t.oid,'public','USAGE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND (has_schema_privilege(t.oid,n.oid,'CREATE,USAGE WITH GRANT OPTION') OR (n.nspname<>'public' AND has_schema_privilege(t.oid,n.oid,'USAGE'))))
    AND NOT EXISTS(SELECT 1 FROM (
      SELECT jsonb_array_elements_text(p.acl->'select') AS name UNION SELECT jsonb_object_keys(p.acl->'readColumns')
      UNION SELECT jsonb_object_keys(p.acl->'insert') UNION SELECT jsonb_object_keys(p.acl->'update')) e
      WHERE to_regclass('public.'||e.name) IS NULL)
    AND NOT EXISTS(SELECT 1 FROM (SELECT 'readColumns' AS kind UNION ALL SELECT 'insert' UNION ALL SELECT 'update') k
      CROSS JOIN LATERAL jsonb_each(p.acl->k.kind) tab CROSS JOIN LATERAL jsonb_array_elements_text(tab.value) col
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||tab.key) AND a.attname=col.value AND a.attnum>0 AND NOT a.attisdropped))
    AND NOT EXISTS(SELECT 1 FROM relations c CROSS JOIN LATERAL aclexplode(acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)) priv
      WHERE CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,priv.privilege_type)
      ELSE has_table_privilege(t.oid,c.oid,priv.privilege_type) IS DISTINCT FROM (c.nspname='public' AND c.relkind IN ('r','v') AND priv.privilege_type='SELECT' AND (p.acl->'select')?c.relname::text)
        OR has_table_privilege(t.oid,c.oid,priv.privilege_type||' WITH GRANT OPTION') END)
    AND NOT EXISTS(SELECT 1 FROM relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) priv(name)
      WHERE c.relkind<>'S' AND a.attnum>0 AND NOT a.attisdropped AND (
      has_column_privilege(t.oid,c.oid,a.attnum,priv.name) IS DISTINCT FROM COALESCE(c.nspname='public' AND c.relkind IN ('r','v') AND CASE priv.name
        WHEN 'SELECT' THEN (p.acl->'select')?c.relname::text OR (p.acl->'readColumns'->c.relname::text)?a.attname::text
        WHEN 'INSERT' THEN (p.acl->'insert'->c.relname::text)?a.attname::text
        WHEN 'UPDATE' THEN (p.acl->'update'->c.relname::text)?a.attname::text ELSE false END,false)
      OR has_column_privilege(t.oid,c.oid,a.attnum,priv.name||' WITH GRANT OPTION')))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') f WHERE to_regprocedure(f.value) IS NULL OR NOT has_function_privilege(t.oid,to_regprocedure(f.value),'EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
        has_function_privilege(t.oid,f.oid,'EXECUTE WITH GRANT OPTION') OR (
        has_function_privilege(t.oid,f.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.acl->'functions') allowed WHERE to_regprocedure(allowed.value)=f.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid AND d.deptype='e'))))
    ${
      role === 'hzense_candidate_verifier'
        ? `AND EXISTS(SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc f ON f.oid=g.tgfoid
      WHERE g.tgrelid='public.signal_candidate_verifications'::regclass AND g.tgname='signal_candidate_verifications_guard_trg'
      AND g.tgenabled='A' AND g.tgtype=31 AND g.tgnargs=0 AND g.tgqual IS NULL AND NOT g.tgisinternal
      AND f.oid='public.hzense_guard_candidate_verification()'::regprocedure AND NOT f.prosecdef
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \\t\\n\\r\\v\\f'),'UTF8')),'hex')='${candidateVerificationFunctionHashes.hzense_guard_candidate_verification}')`
        : ''
    }
    FROM target t CROSS JOIN plan p),false) AS safe`;
}
export async function assertCandidatePipelineRole(client, role) {
  const result = await client.query(candidatePipelineAuditSQL(role));
  if (result.rows.length !== 1 || result.rows[0].safe !== true)
    throw new Error('candidate_pipeline_role_invalid');
}

/** Generates a reviewable, opt-in SQL file; never executes it or creates passwords. */
export function candidatePipelineProvisionSQL() {
  const statements = [
    `-- GENERATED from candidate-pipeline-role.mjs; opt-in manual maintenance only.
-- Pre-create all three EMPTY LOGIN NOINHERIT CONNECTION LIMIT 2 roles.
-- Only Neon's cloud_admin -> neondb_owner ADMIN-only management edge is accepted;
-- no INHERIT/SET, outbound memberships, or other incoming members are allowed.
-- No credentials, role creation, task authorization, safety-switch changes or production execution.
-- Strictly refuses ambient application/table/column/function permissions rather than repairing PUBLIC.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $owner$
BEGIN
 IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
 IF current_user<>session_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0021_candidate_review_attestations.sql') THEN RAISE EXCEPTION 'Verify migration 0021 first'; END IF;
END;
$owner$;`,
  ];
  for (const [role, plan] of Object.entries(candidatePipelineRoles)) {
    if (role === 'hzense_publisher') continue;
    statements.push(`DO $empty$
DECLARE t pg_catalog.pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO t FROM pg_catalog.pg_roles WHERE rolname='${role}';
 IF NOT FOUND OR NOT t.rolcanlogin OR t.rolconnlimit<>2 OR t.rolsuper OR t.rolinherit OR t.rolcreatedb OR t.rolcreaterole OR t.rolreplication OR t.rolbypassrls
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=t.oid OR m.roleid=t.oid)
      AND (m.roleid=t.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=t.oid)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=t.oid AND deptype IN ('o','a')) THEN RAISE EXCEPTION 'Pre-create an empty restricted ${role}'; END IF;
 IF has_database_privilege(t.oid,current_database(),'CREATE,TEMPORARY') OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(t.oid,n.oid,'CREATE')) THEN RAISE EXCEPTION 'Unsafe ambient database/schema grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(t.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE has_table_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) THEN RAISE EXCEPTION 'Ambient application data grants are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${role}', current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO ${role};`);
    for (const table of plan.select) statements.push(`GRANT SELECT ON public.${table} TO ${role};`);
    for (const [kind, privilege] of [
      ['readColumns', 'SELECT'],
      ['insert', 'INSERT'],
      ['update', 'UPDATE'],
    ])
      for (const [table, columns] of Object.entries(plan[kind]))
        statements.push(`GRANT ${privilege} (${columns.join(',')}) ON public.${table} TO ${role};`);
    for (const fn of plan.functions) statements.push(`GRANT EXECUTE ON FUNCTION ${fn} TO ${role};`);
    statements.push(`DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (${candidatePipelineAuditSQL(role, false)}) audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION '${role} effective ACL contract mismatch'; END IF;
END;
$verify$;`);
  }
  statements.push('COMMIT;\n');
  return statements.join('\n').replace(/[ \t]+$/gm, '');
}
