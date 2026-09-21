import { CandidateReviewError } from './candidate-review-contract.mjs';
export const candidateReviewerColumns = {
  candidate_reviews: [
    'id',
    'request_id',
    'owner_id',
    'run_id',
    'candidate_index',
    'revision',
    'material_hash',
    'fingerprint',
    'decision',
    'note',
    'draft',
    'created_at',
  ],
  signal_generation_runs: [
    'id',
    'owner_id',
    'status',
    'deleted_at',
    'snapshot',
    'source_hash',
    'result',
  ],
  sources: ['id', 'name', 'type', 'url', 'trust_score', 'active', 'allowed_hosts'],
  public_source_evidence: [
    'id',
    'source_id',
    'source_url',
    'locator',
    'excerpt',
    'content_hash',
    'captured_at',
    'source_published_at',
    'verification_status',
    'created_xid',
  ],
  entities: ['id', 'type', 'name', 'status', 'aliases', 'metadata', 'created_at', 'updated_at'],
  person_profiles: ['entity_id', 'entity_type'],
  organization_profiles: ['entity_id', 'entity_type'],
  topics: ['id', 'title', 'parent_id', 'status', 'metadata', 'runtime_enabled'],
};
export async function assertCandidateReviewRole(client) {
  const ambient =
    await client.query(`SELECT current_user=session_user AND r.rolcanlogin AND r.rolconnlimit=2 AND r.rolconfig IS NULL
    AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (m.member=r.oid OR m.roleid=r.oid)
      AND (m.roleid=r.oid AND pg_get_userbyid(m.member)='neondb_owner' AND pg_get_userbyid(m.grantor)='cloud_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) IS NOT TRUE)
    AND NOT has_database_privilege(current_database(),'CREATE,TEMPORARY')
    AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(oid,'CREATE'))
    AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (0,r.oid))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'SELECT,UPDATE,USAGE') ELSE false END)
    AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
    AS safe FROM pg_roles r WHERE r.rolname=current_user`);
  if (ambient.rows[0]?.safe !== true) throw new CandidateReviewError('review_role_invalid');
  const result =
    await client.query(`SELECT current_user AS name, r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit AS unsafe,
 EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS member,
 has_any_column_privilege(current_user,'public.candidate_reviews','SELECT') AND has_any_column_privilege(current_user,'public.candidate_reviews','INSERT') AS review_access,
 has_table_privilege(current_user,'public.candidate_reviews','UPDATE,DELETE,TRUNCATE') AS review_write,
 has_any_column_privilege(current_user,'public.signal_generation_runs','UPDATE,INSERT,REFERENCES') OR has_table_privilege(current_user,'public.signal_generation_runs','DELETE,TRUNCATE') AS generation_write,
 has_table_privilege(current_user,'public.signals','INSERT,UPDATE,DELETE,TRUNCATE') AS signal_write
 FROM pg_roles r WHERE rolname=current_user`);
  const row = result.rows[0];
  if (
    !row ||
    row.name !== 'hzense_candidate_reviewer' ||
    row.unsafe ||
    row.member ||
    !row.review_access ||
    row.review_write ||
    row.generation_write ||
    row.signal_write
  )
    throw new CandidateReviewError('review_role_invalid');
  const tables = await client.query(`SELECT c.relname AS name,n.nspname AS schema,
    has_any_column_privilege(current_user,c.oid,'SELECT') AS readable,
    has_any_column_privilege(current_user,c.oid,'INSERT') AS insertable,
    has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') AS mutable,
    has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION') AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')`);
  const allowed = new Set([
    'candidate_reviews',
    'signal_generation_runs',
    'sources',
    'public_source_evidence',
    'entities',
    'person_profiles',
    'organization_profiles',
    'topics',
  ]);
  if (
    tables.rows.some(
      (t) =>
        t.mutable ||
        t.grantable ||
        (t.insertable && (t.schema !== 'public' || t.name !== 'candidate_reviews')) ||
        (t.readable && (t.schema !== 'public' || !allowed.has(t.name))),
    )
  )
    throw new CandidateReviewError('review_role_invalid');
  const grantable = await client.query(
    `SELECT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(c.oid,a.attnum,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')) AS unsafe`,
  );
  if (grantable.rows[0]?.unsafe !== false) throw new CandidateReviewError('review_role_invalid');
  const actualColumns = await client.query(
    `SELECT c.relname AS table_name,n.nspname AS schema,a.attname AS column_name,p.privilege FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege) WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(c.oid,a.attnum,p.privilege)`,
  );
  const expectedColumns = new Set(
    Object.entries(candidateReviewerColumns).flatMap(([table, cols]) =>
      cols.flatMap((col) => [
        `${table}|${col}|SELECT`,
        ...(table === 'candidate_reviews' ? [`${table}|${col}|INSERT`] : []),
      ]),
    ),
  );
  if (
    actualColumns.rows.length !== expectedColumns.size ||
    actualColumns.rows.some(
      (c) =>
        c.schema !== 'public' ||
        !expectedColumns.has(`${c.table_name}|${c.column_name}|${c.privilege}`),
    )
  )
    throw new CandidateReviewError('review_role_invalid');
  const cols = await client.query(
    `SELECT a.attname AS name FROM pg_attribute a WHERE a.attrelid='public.signal_generation_runs'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'SELECT')`,
  );
  const expected = ['id', 'owner_id', 'status', 'deleted_at', 'snapshot', 'source_hash', 'result'];
  if (cols.rows.length !== expected.length || cols.rows.some((c) => !expected.includes(c.name)))
    throw new CandidateReviewError('review_role_invalid');
}
