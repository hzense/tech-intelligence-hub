// Fail closed at pool creation. Migration and runtime role provisioning are
// separate, explicit maintenance actions; this check never grants or repairs ACLs.
export const signalGenerationRoleColumns = {
  SELECT: [
    'id',
    'owner_id',
    'batch_id',
    'item_id',
    'source_fence',
    'source_hash',
    'profile_id',
    'profile_revision',
    'generation_version',
    'fingerprint',
    'snapshot',
    'configuration',
    'status',
    'lease_token',
    'lease_until',
    'budget_day',
    'reserved_microusd',
    'charged_microusd',
    'result',
    'error_code',
    'created_at',
    'finished_at',
  ],
  INSERT: [
    'id',
    'owner_id',
    'batch_id',
    'item_id',
    'source_fence',
    'source_hash',
    'profile_id',
    'profile_revision',
    'generation_version',
    'fingerprint',
    'snapshot',
    'configuration',
  ],
  UPDATE: [
    'status',
    'lease_token',
    'lease_until',
    'budget_day',
    'reserved_microusd',
    'charged_microusd',
    'result',
    'error_code',
    'finished_at',
  ],
};
const deny = () => {
  throw new Error('generation_role_invalid');
};
export async function assertGenerationRole(client) {
  const role = (
    await client.query(`SELECT current_user AS effective,session_user AS authenticated,
    rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS membership,
    EXISTS(SELECT 1 FROM pg_db_role_setting WHERE setrole=r.oid) AS settings,
    EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid AND deptype='o') AS owns
    FROM pg_roles r WHERE rolname=current_user`)
  ).rows[0];
  if (
    !role ||
    role.effective !== 'hzense_generation_admin' ||
    role.authenticated !== role.effective ||
    !role.rolcanlogin ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    role.rolconnlimit !== 2 ||
    role.membership ||
    role.settings ||
    role.owns
  )
    deny();
  const unsafe = (
    await client.query(`SELECT
    has_database_privilege(current_user,current_database(),'CREATE') OR
    has_database_privilege(current_user,current_database(),'TEMPORARY') OR
    NOT has_database_privilege(current_user,current_database(),'CONNECT') OR
    NOT has_schema_privilege(current_user,'public','USAGE') OR
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
      AND (has_schema_privilege(current_user,oid,'CREATE') OR (nspname<>'public' AND has_schema_privilege(current_user,oid,'USAGE')))) OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
      CASE WHEN c.relkind='S' THEN has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')
      WHEN c.relkind IN ('r','p','v','m','f') THEN has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      ELSE false END) OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(current_user,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) AS unsafe`)
  ).rows[0];
  if (!unsafe || unsafe.unsafe !== false) deny();
  const rows = (
    await client.query(`SELECT n.nspname AS schema,c.relname AS table,a.attname AS column,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS "SELECT",
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS "INSERT",
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS "UPDATE",
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS "REFERENCES",
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT WITH GRANT OPTION') OR
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT WITH GRANT OPTION') OR
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE WITH GRANT OPTION') OR
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES WITH GRANT OPTION') AS grant_option
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
      AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`)
  ).rows;
  const seen = new Set();
  for (const row of rows) {
    const own = row.schema === 'public' && row.table === 'signal_generation_runs';
    if (row.grant_option || row.REFERENCES) deny();
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
      const expected = own && signalGenerationRoleColumns[privilege].includes(row.column);
      if (row[privilege] !== expected) deny();
      if (expected) seen.add(`${privilege}:${row.column}`);
    }
  }
  for (const [privilege, names] of Object.entries(signalGenerationRoleColumns))
    for (const column of names) if (!seen.has(`${privilege}:${column}`)) deny();
}
