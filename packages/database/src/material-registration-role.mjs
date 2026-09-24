import { importRoleCheckSQL } from './import-role.mjs';
import {
  materialProposalColumns,
  materialProposalFunctionHashes,
  materialProposalTriggers,
} from './candidate-material-proposal-catalog.mjs';
import {
  candidateMaterialFunctionHashes,
  candidateMaterialLockFunctionHash,
  candidateMaterialTriggers,
} from './candidate-material-catalog.mjs';

const request = [
  'id',
  'owner_id',
  'run_id',
  'candidate_index',
  'base_material_hash',
  'bundle_hash',
  'fingerprint',
  'bundle',
  'created_at',
];
const report = ['id', 'request_id', 'owner_id', 'plan_hash', 'plan', 'attestation', 'received_at'];
const receipt = ['id', 'request_id', 'report_id', 'owner_id', 'plan_hash', 'stage', 'created_at'];
const generation = ['id', 'owner_id', 'status', 'deleted_at', 'snapshot', 'source_hash', 'result'];
const entities = [
  'id',
  'type',
  'name',
  'status',
  'aliases',
  'metadata',
  'created_at',
  'updated_at',
];
const sources = ['id', 'name', 'type', 'url', 'trust_score', 'active', 'allowed_hosts'];
const evidence = [
  'id',
  'source_id',
  'source_url',
  'locator',
  'excerpt',
  'content_hash',
  'captured_at',
  'source_published_at',
  'verification_status',
];
const shared = {
  candidate_material_requests: { SELECT: request },
  candidate_material_reports: { SELECT: report },
  candidate_material_receipts: { SELECT: receipt },
  signal_generation_runs: { SELECT: generation },
  entities: { SELECT: entities },
  sources: { SELECT: sources },
  public_source_evidence: { SELECT: evidence },
  person_profiles: { SELECT: ['entity_id', 'entity_type'] },
  organization_profiles: { SELECT: ['entity_id', 'entity_type'] },
  topics: { SELECT: ['id', 'title', 'status', 'runtime_enabled'] },
};
export const materialRoleColumns = {
  hzense_material_registrar: {
    ...shared,
    candidate_material_requests: {
      SELECT: request,
      INSERT: request.filter((c) => c !== 'created_at'),
    },
    candidate_material_receipts: {
      SELECT: receipt,
      INSERT: receipt.filter((c) => c !== 'created_at'),
    },
    entities: { SELECT: entities, INSERT: ['id', 'type', 'name', 'status', 'aliases'] },
    sources: { SELECT: sources, INSERT: sources },
    // Omitting verification_status is essential: registration can only use DEFAULT pending.
    public_source_evidence: {
      SELECT: evidence,
      INSERT: evidence.filter((c) => c !== 'verification_status'),
    },
    person_profiles: { SELECT: ['entity_id', 'entity_type'], INSERT: ['entity_id', 'entity_type'] },
    organization_profiles: {
      SELECT: ['entity_id', 'entity_type'],
      INSERT: ['entity_id', 'entity_type'],
    },
  },
  hzense_material_verifier: {
    ...shared,
    candidate_material_reports: {
      SELECT: report,
      INSERT: report.filter((c) => c !== 'received_at'),
    },
    candidate_material_receipts: {
      SELECT: receipt,
      INSERT: receipt.filter((c) => c !== 'created_at'),
    },
    public_source_evidence: { SELECT: evidence, UPDATE: ['verification_status'] },
  },
};

/** Reuse the audited ambient/extra-column checks with a different exact matrix. */
export function materialRoleCheckSQL(role, { session = true, proposals = false } = {}) {
  if (!Object.hasOwn(materialRoleColumns, role)) throw new Error('not_configured');
  const proposalColumns = Object.fromEntries(
    Object.entries(materialProposalColumns).map(([table, columns]) => [
      table,
      {
        SELECT: Object.keys(columns),
        ...(role === 'hzense_material_registrar'
          ? { INSERT: Object.keys(columns).filter((column) => column !== 'created_at') }
          : {}),
      },
    ]),
  );
  const values = Object.entries({
    ...materialRoleColumns[role],
    ...(proposals ? proposalColumns : {}),
  })
    .flatMap(([table, privileges]) =>
      Object.entries(privileges).flatMap(([privilege, columns]) =>
        columns.map((column) => `('${table}','${column}','${privilege}')`),
      ),
    )
    .join(',');
  const boundary = importRoleCheckSQL.indexOf('\n  SELECT current_user=');
  if (boundary < 0) throw new Error('not_configured');
  let audit = importRoleCheckSQL
    .slice(boundary)
    .replace(
      "current_user='hzense_import_admin' AND session_user=current_user",
      session ? `current_user='${role}' AND session_user=current_user` : 'true',
    )
    .replace('r.rolname=current_user', `r.rolname='${role}'`)
    .replaceAll(
      'has_database_privilege(current_database(),',
      'has_database_privilege(r.oid,current_database(),',
    )
    .replaceAll('has_schema_privilege(oid,', 'has_schema_privilege(r.oid,oid,')
    .replaceAll('has_table_privilege(c.oid,', 'has_table_privilege(r.oid,c.oid,')
    .replaceAll('has_column_privilege(c.oid,', 'has_column_privilege(r.oid,c.oid,')
    .replaceAll('has_sequence_privilege(c.oid,', 'has_sequence_privilege(r.oid,c.oid,')
    .replaceAll('has_function_privilege(p.oid,', 'has_function_privilege(r.oid,p.oid,')
    .replace(
      "AND has_function_privilege(r.oid,p.oid,'EXECUTE')",
      "AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND p.oid<>to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')",
    );
  const functions = Object.entries({
    ...candidateMaterialFunctionHashes,
    ...(proposals ? materialProposalFunctionHashes : {}),
  })
    .map(
      ([name, hash]) =>
        `EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname='public' AND f.proname='${name}' AND f.pronargs=0 AND NOT f.prosecdef
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \\t\\n\\r\\v\\f'),'UTF8')),'hex')='${hash}')`,
    )
    .join(' AND ');
  const triggers = [...candidateMaterialTriggers, ...(proposals ? materialProposalTriggers : [])]
    .map(
      (trigger) =>
        `EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc f ON f.oid=g.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
      WHERE n.nspname='public' AND c.relname='${trigger.table_name}' AND g.tgname='${trigger.name}'
      AND g.tgenabled='A' AND g.tgtype=${trigger.trigger_type} AND g.tgnargs=0 AND g.tgqual IS NULL
      AND NOT g.tgisinternal AND fn.nspname='public' AND f.proname='${trigger.routine_name}')`,
    )
    .join(' AND ');
  const seals = `
  AND has_database_privilege(r.oid,current_database(),'CONNECT')
  AND NOT has_database_privilege(r.oid,current_database(),'CONNECT WITH GRANT OPTION')
  AND has_schema_privilege(r.oid,'public','USAGE')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'
    AND (has_schema_privilege(r.oid,oid,'USAGE WITH GRANT OPTION') OR (nspname<>'public' AND has_schema_privilege(r.oid,oid,'USAGE'))))
  AND NOT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')
  AND has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE')
  AND NOT has_function_privilege(r.oid,'public.hzense_lock_material_dependencies(uuid,text)','EXECUTE WITH GRANT OPTION')
  AND EXISTS(SELECT 1 FROM pg_proc f
    WHERE f.oid=to_regprocedure('public.hzense_lock_material_dependencies(uuid,text)')
      AND f.prosecdef AND f.prorettype='pg_catalog.void'::regtype AND f.provolatile='v' AND NOT f.proleakproof
      AND f.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND f.proowner=(SELECT relowner FROM pg_class WHERE oid='public.candidate_material_reports'::regclass)
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND encode(sha256(convert_to(btrim(f.prosrc,E' \\t\\n\\r\\v\\f'),'UTF8')),'hex')='${candidateMaterialLockFunctionHash}')
  AND EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.public_source_evidence'::regclass AND a.attname='verification_status'
      AND pg_get_expr(d.adbin,d.adrelid)='''pending''::text')
  AND ${functions}
  AND ${triggers}`;
  audit = audit.replace('\n  AS safe', `${seals}\n  AS safe`);
  return `WITH allowed(table_name,column_name,privilege) AS (VALUES ${values})` + audit;
}
export async function assertMaterialRole(client, role, options = {}) {
  const result = await client.query(materialRoleCheckSQL(role, options));
  if (result.rows.length !== 1 || result.rows[0]?.safe !== true)
    throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
}

/** Independent, manual extension after 0024. Accepts exactly old or new ACL, not ambient grants. */
export function materialProposalRoleProvisionSQL() {
  const roles = Object.keys(materialRoleColumns)
    .map((role) => {
      const grants = Object.entries(materialProposalColumns)
        .flatMap(([table, columns]) => [
          `GRANT SELECT (${Object.keys(columns).join(',')}) ON public.${table} TO ${role};`,
          ...(role === 'hzense_material_registrar'
            ? [
                `GRANT INSERT (${Object.keys(columns)
                  .filter((column) => column !== 'created_at')
                  .join(',')}) ON public.${table} TO ${role};`,
              ]
            : []),
        ])
        .join('\n');
      return `DO $before$\nDECLARE safe boolean;\nBEGIN\n SELECT old_acl.safe OR new_acl.safe INTO safe FROM (${materialRoleCheckSQL(role, { session: false })}) old_acl CROSS JOIN (${materialRoleCheckSQL(role, { session: false, proposals: true })}) new_acl;\n IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'Material role must match reviewed old or new exact ACL'; END IF;\nEND;\n$before$;\n${grants}\nDO $after$\nDECLARE safe boolean;\nBEGIN\n SELECT audit.safe INTO safe FROM (${materialRoleCheckSQL(role, { session: false, proposals: true })}) audit;\n IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION 'Material proposal role ACL mismatch'; END IF;\nEND;\n$after$;`;
    })
    .join('\n');
  return `-- Generated from material-registration-role.mjs. Explicit reviewed 0024 extension only.\nBEGIN;\nSET LOCAL search_path=pg_catalog,pg_temp;\nSET LOCAL statement_timeout='20s';\nDO $owner$\nBEGIN\n IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;\n IF current_user<>session_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;\n IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0024_material_review_proposals.sql' AND checksum='bb4591a510721690216753a97759f255da0472553f4d3ab56b92b01ab9d80f57') THEN RAISE EXCEPTION 'Verify migration 0024 first'; END IF;\nEND;\n$owner$;\n${roles}\nCOMMIT;\n`;
}

/** Opt-in reviewed provisioning; never used by application startup or diagnostics. */
export function materialRoleProvisionSQL() {
  const header = `-- Generated from material-registration-role.mjs. Manual reviewed maintenance only.
-- Pre-create EMPTY restricted roles. This script never creates or prints credentials.
-- Requires applied migration 0023; no existing reader/reviewer roles are changed.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='20s';
DO $owner$
BEGIN
 IF NOT pg_try_advisory_xact_lock(1215921955,1298498925) THEN RAISE EXCEPTION 'Migration lock busy'; END IF;
 IF current_user<>session_user OR current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'Authenticated database owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hzense_schema_migrations WHERE name='0023_candidate_materials.sql') THEN RAISE EXCEPTION 'Verify migration 0023 first'; END IF;
END;
$owner$;`;
  const roles = Object.entries(materialRoleColumns)
    .map(([role, columns]) => {
      const grants = Object.entries(columns)
        .flatMap(([table, privileges]) =>
          Object.entries(privileges).map(
            ([privilege, names]) =>
              `GRANT ${privilege} (${names.join(',')}) ON public.${table} TO ${role};`,
          ),
        )
        .join('\n');
      return `DO $empty$
DECLARE target pg_roles%ROWTYPE;
BEGIN
 SELECT * INTO target FROM pg_roles WHERE rolname='${role}';
 IF NOT FOUND OR NOT target.rolcanlogin OR target.rolconnlimit<>2 OR target.rolconfig IS NOT NULL
   OR target.rolsuper OR target.rolinherit OR target.rolcreatedb OR target.rolcreaterole OR target.rolreplication OR target.rolbypassrls
   OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=target.oid OR m.roleid=target.oid)
     AND (m.roleid=target.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin'
       AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
   OR EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=target.oid)
   OR EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=target.oid AND deptype IN ('o','a'))
 THEN RAISE EXCEPTION 'Pre-create an empty restricted ${role}'; END IF;
 IF has_database_privilege(target.oid,current_database(),'CREATE,TEMPORARY')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(target.oid,oid,'CREATE'))
 THEN RAISE EXCEPTION 'Unsafe ambient database/schema privileges'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
   AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(target.oid,c.oid,'SELECT,UPDATE,USAGE')
     ELSE has_table_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(target.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END)
 THEN RAISE EXCEPTION 'Ambient application data privileges are forbidden'; END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${role}',current_database());
END;
$empty$;
GRANT USAGE ON SCHEMA public TO ${role};
GRANT EXECUTE ON FUNCTION public.hzense_lock_material_dependencies(uuid,text) TO ${role};
${grants}
DO $verify$
DECLARE safe boolean;
BEGIN
 SELECT audit.safe INTO safe FROM (${materialRoleCheckSQL(role, { session: false })}) audit;
 IF safe IS DISTINCT FROM true THEN RAISE EXCEPTION '${role} effective ACL or guard mismatch'; END IF;
END;
$verify$;`;
    })
    .join('\n');
  return `${header}\n${roles}\nCOMMIT;\n`;
}
