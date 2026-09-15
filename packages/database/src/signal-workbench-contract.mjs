import { URL } from 'node:url';

const codes = new Set([
  'invalid_request',
  'not_found',
  'database_unavailable',
  'access_denied',
  'incompatible_data',
]);
export class SignalWorkbenchError extends Error {
  constructor(code = 'invalid_request') {
    const safe = codes.has(code) ? code : 'invalid_request';
    super(safe);
    this.name = 'SignalWorkbenchError';
    this.code = safe;
  }
}
const fail = () => {
  throw new SignalWorkbenchError('invalid_request');
};
const hasControls = (value) =>
  [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
function object(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail();
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value')
    )
      fail();
    copy[key] = descriptor.value;
  }
  return copy;
}
function text(value, maximum, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || hasControls(value)) fail();
  const result = value.trim();
  if (!empty && !result) fail();
  return result;
}
function integer(value, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail();
  return value;
}
function identifier(value) {
  const result = text(value, 200);
  if (result !== value || result.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0] !== result) fail();
  return result;
}
export function parseSignalWorkbenchListRequest(input) {
  const value = object(input === undefined ? {} : input, ['q', 'after', 'limit']);
  return {
    q: value.q === undefined ? '' : text(value.q, 100, true),
    after: value.after === undefined || value.after === '' ? '' : identifier(value.after),
    limit: value.limit === undefined ? 25 : integer(value.limit, 50),
  };
}
export function parseSignalWorkbenchDetailRequest(input) {
  const value = object(input, ['signal_id', 'version']);
  return {
    signal_id: identifier(value.signal_id),
    ...(value.version === undefined ? {} : { version: integer(value.version, 2_147_483_647) }),
  };
}
/** Never turn credential-bearing or signed/private URLs into browser links or error text. */
export function safeWorkbenchSourceUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^https:\/\//i.test(value) ||
    value.includes('\\') ||
    /\s/u.test(value) ||
    hasControls(value)
  )
    return null;
  try {
    if (hasControls(decodeURIComponent(value))) return null;
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Exact column ACL: not SELECT *, and never raw evidence, free-form metadata,
// report/seal payloads, verifier identity, run authorization, leases or AI keys.
export const signalWorkbenchReadColumns = Object.freeze(
  Object.fromEntries(
    Object.entries({
      signal_versions: [
        'signal_id',
        'version',
        'title',
        'type',
        'occurred_at',
        'date_precision',
        'date_basis',
        'captured_at',
        'summary',
        'analysis',
        'importance',
        'strength',
        'confidence',
        'novelty',
        'revision_reason',
        'origin',
        'created_at',
      ],
      signal_version_evidence: ['signal_id', 'version', 'evidence_id', 'claim', 'relation'],
      public_source_evidence: [
        'id',
        'source_id',
        'source_url',
        'captured_at',
        'source_published_at',
        'verification_status',
      ],
      sources: ['id', 'name', 'active'],
      signal_version_people: [
        'signal_id',
        'version',
        'person_id',
        'evidence_id',
        'event_role',
        'verification_status',
      ],
      signal_version_organizations: [
        'signal_id',
        'version',
        'organization_id',
        'evidence_id',
        'event_role',
        'verification_status',
      ],
      entities: ['id', 'name', 'type', 'status'],
      signal_version_topics: ['signal_id', 'version', 'topic_id'],
      topics: ['id', 'title'],
      signal_publication_state: [
        'signal_id',
        'content_version',
        'publication_revision',
        'status',
        'occurred_at',
      ],
      current_public_signals: ['signal_id', 'version', 'publication_revision'],
      signal_candidate_verifications: [
        'verification_id',
        'signal_id',
        'source_version',
        'decision',
        'checks',
        'verified_at',
        'expires_at',
      ],
      signal_verification_dependency_seals: ['verification_id', 'invalidated'],
      signal_candidate_assembly_receipts: [
        'verification_id',
        'signal_id',
        'source_version',
        'target_version',
      ],
      signal_qualified_publication_receipts: ['signal_id', 'source_version', 'target_version'],
    }).map(([name, columns]) => [name, Object.freeze(columns)]),
  ),
);

/** Check effective read capabilities on each checkout. Provisioning separately checks cross-DB ACLs. */
export async function verifySignalWorkbenchAccess(client) {
  const identity = (
    await client.query(`/* workbench:identity */
    SELECT session_user=current_user AND current_user='hzense_signal_admin_reader'
      AND r.rolcanlogin AND NOT r.rolinherit AND r.rolconnlimit=2
      AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting WHERE setrole=r.oid)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::pg_catalog.regclass AND refobjid=r.oid AND deptype='o')
      AND (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)<=1
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
        AND (m.roleid=r.oid AND pg_catalog.pg_get_userbyid(m.member)='neondb_owner'
          AND pg_catalog.pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option
          AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
      AND pg_catalog.has_database_privilege(current_user,current_database(),'CONNECT')
      AND NOT pg_catalog.has_database_privilege(current_user,current_database(),'CONNECT WITH GRANT OPTION')
      AND NOT pg_catalog.has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY')
      AND pg_catalog.has_schema_privilege(current_user,'public','USAGE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
        AND (pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE') OR pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION')
          OR (n.nspname<>'public' AND pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE')))) AS ok
    FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`)
  ).rows;
  if (identity.length !== 1 || identity[0].ok !== true)
    throw new SignalWorkbenchError('access_denied');
  const access = (
    await client.query(
      `/* workbench:access */
    WITH expected AS (
      SELECT e.key AS table_name,jsonb_array_elements_text(e.value) AS column_name FROM jsonb_each($1::jsonb) e
    ), relations AS (
      SELECT c.oid,c.relname,c.relkind,c.relowner,n.nspname FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
    ), columns AS (
      SELECT r.*,a.attnum,a.attname,EXISTS(SELECT 1 FROM expected e WHERE r.nspname='public'
        AND r.relkind=CASE WHEN e.table_name='current_public_signals' THEN 'v'::"char" ELSE 'r'::"char" END
        AND e.table_name=r.relname AND e.column_name=a.attname) AS allowed
      FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped WHERE r.relkind<>'S'
    ) SELECT
      NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM columns c WHERE c.nspname='public' AND c.relname=e.table_name AND c.attname=e.column_name AND c.allowed))
      AND NOT EXISTS(SELECT 1 FROM relations r CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault(
        CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner)) p
        WHERE CASE WHEN r.relkind='S' THEN pg_catalog.has_sequence_privilege(current_user,r.oid,p.privilege_type)
          ELSE pg_catalog.has_table_privilege(current_user,r.oid,p.privilege_type) END)
      AND NOT EXISTS(SELECT 1 FROM columns c WHERE
        pg_catalog.has_column_privilege(current_user,c.oid,c.attnum,'SELECT') IS DISTINCT FROM c.allowed
        OR pg_catalog.has_column_privilege(current_user,c.oid,c.attnum,'SELECT WITH GRANT OPTION')
        OR pg_catalog.has_column_privilege(current_user,c.oid,c.attnum,'INSERT,UPDATE,REFERENCES'))
      AND pg_catalog.has_function_privilege(current_user,'public.hzense_public_signal_is_current(uuid)','EXECUTE')
      AND NOT pg_catalog.has_function_privilege(current_user,'public.hzense_public_signal_is_current(uuid)','EXECUTE WITH GRANT OPTION')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
          AND p.oid<>'public.hzense_public_signal_is_current(uuid)'::pg_catalog.regprocedure
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid=p.oid AND d.deptype='e')) AS ok`,
      [JSON.stringify(signalWorkbenchReadColumns)],
    )
  ).rows;
  if (access.length !== 1 || access[0].ok !== true) throw new SignalWorkbenchError('access_denied');
}
