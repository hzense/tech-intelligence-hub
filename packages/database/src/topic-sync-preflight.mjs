import { fileURLToPath, URL } from 'node:url';
import { loadMigrations, planPendingMigrations, verifyMigrationManifest } from './migrate.mjs';
import { inspectProductionTls } from './preflight.mjs';
import { expectedTableNames } from './verify.mjs';

const migrationDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const migrationManifest = fileURLToPath(
  new URL('../../../db/migrations/checksums.json', import.meta.url),
);
const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export function assertDirectTopicSyncEndpoint(host) {
  const hostname = requireString(host, 'Topic sync database host').toLowerCase();
  if (/(^|[.-])pooler([.-]|$)/.test(hostname)) {
    throw new Error(
      'Topic sync requires a reviewed direct/session endpoint, not a pooler endpoint',
    );
  }
}

async function effectiveTablePrivileges(client) {
  return (
    await client.query(
      `SELECT namespace_info.nspname AS schema_name,
              table_info.relname AS table_name,
              privilege_info.privilege,
              has_table_privilege(current_user, table_info.oid, privilege_info.privilege) AS granted,
              has_table_privilege(
                current_user,
                table_info.oid,
                privilege_info.privilege || ' WITH GRANT OPTION'
              ) AS grantable
       FROM pg_class AS table_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
       CROSS JOIN unnest($1::text[]) AS privilege_info(privilege)
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
       ORDER BY namespace_info.nspname, table_info.relname, privilege_info.privilege`,
      [tablePrivileges],
    )
  ).rows.filter((row) => row.granted === true || row.grantable === true);
}

function privilegeSet(rows, relationName) {
  return new Set(
    rows
      .filter((row) => `${row.schema_name}.${row.table_name}` === relationName)
      .map((row) => row.privilege),
  );
}

function requireExactPrivileges(rows, relationName, expected) {
  const actual = privilegeSet(rows, relationName);
  const missing = expected.filter((privilege) => !actual.has(privilege));
  const unexpected = [...actual].filter((privilege) => !expected.includes(privilege));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Topic sync role privileges on ${relationName} are invalid; missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
    );
  }
  const grantable = rows
    .filter(
      (row) => `${row.schema_name}.${row.table_name}` === relationName && row.grantable === true,
    )
    .map((row) => row.privilege);
  if (grantable.length > 0) {
    throw new Error(
      `Topic sync role must not hold grant options on ${relationName}: ${grantable.join(', ')}`,
    );
  }
}

export async function inspectTopicSyncPreflight(
  client,
  {
    expectedHost,
    expectedDatabase,
    expectedUser,
    expectedPostgresMajor = 18,
    expectedConnectionLimit = 2,
    expectedTransactionReadOnly = false,
    profile,
  },
) {
  const databaseName = requireString(expectedDatabase, 'HZENSE_TOPIC_SYNC_EXPECTED_NAME');
  const userName = requireString(expectedUser, 'HZENSE_TOPIC_SYNC_EXPECTED_USER');
  if (profile === 'production' && userName !== 'hzense_topic_sync') {
    throw new Error('Production Topic sync must authenticate as hzense_topic_sync');
  }
  if (expectedPostgresMajor !== 18) {
    throw new Error('HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR must be 18');
  }
  if (expectedConnectionLimit !== 2) {
    throw new Error('HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT must be 2');
  }
  if (typeof expectedTransactionReadOnly !== 'boolean') {
    throw new Error('expectedTransactionReadOnly must be a boolean');
  }

  const migrations = await loadMigrations(migrationDirectory);
  await verifyMigrationManifest(migrations, migrationManifest);

  const identity = await client.query(
    `SELECT current_database() AS database_name,
            session_user AS authenticated_role,
            current_user AS effective_role,
            current_schema() AS schema_name,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') = 'on' AS read_only,
            pg_is_in_recovery() AS in_recovery,
            role_info.rolcanlogin,
            role_info.rolinherit,
            role_info.rolconnlimit,
            role_info.rolsuper,
            role_info.rolcreatedb,
            role_info.rolcreaterole,
            role_info.rolreplication,
            role_info.rolbypassrls,
            pg_get_userbyid(database_info.datdba) AS database_owner,
            has_database_privilege(current_user, current_database(), 'CONNECT') AS database_connect,
            has_database_privilege(
              current_user,
              current_database(),
              'CONNECT WITH GRANT OPTION'
            ) AS database_connect_grantable,
            has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
            has_database_privilege(current_user, current_database(), 'TEMPORARY') AS database_temp,
            has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
            has_schema_privilege(
              current_user,
              'public',
              'USAGE WITH GRANT OPTION'
            ) AS public_usage_grantable,
            has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
            has_type_privilege(current_user, 'public.topic_status', 'USAGE') AS topic_status_usage,
            has_type_privilege(
              current_user,
              'public.topic_status',
              'USAGE WITH GRANT OPTION'
            ) AS topic_status_usage_grantable
     FROM pg_roles AS role_info
     JOIN pg_database AS database_info ON database_info.datname = current_database()
     WHERE role_info.rolname = session_user`,
  );
  const target = identity.rows[0];
  if (!target) throw new Error('Database did not return the Topic sync role');
  if (
    target.database_name !== databaseName ||
    target.authenticated_role !== userName ||
    target.effective_role !== userName
  ) {
    throw new Error(
      `Topic sync target mismatch; expected ${databaseName}/${userName}, found ${target.database_name}/${target.authenticated_role}/${target.effective_role}`,
    );
  }
  if (target.schema_name !== 'public') throw new Error('Topic sync current_schema must be public');
  const postgresMajor = Math.floor(target.server_version_num / 10_000);
  if (postgresMajor !== expectedPostgresMajor) {
    throw new Error(
      `PostgreSQL major mismatch; expected ${expectedPostgresMajor}, found ${postgresMajor}`,
    );
  }
  if (target.read_only !== expectedTransactionReadOnly) {
    throw new Error(
      `Topic sync transaction mode mismatch; expected read_only=${expectedTransactionReadOnly}, found ${target.read_only}`,
    );
  }
  if (target.in_recovery) {
    throw new Error('Topic sync database target is in recovery');
  }
  if (!target.rolcanlogin || target.rolinherit) {
    throw new Error('Topic sync role must be LOGIN and NOINHERIT');
  }
  if (target.rolconnlimit !== expectedConnectionLimit) {
    throw new Error(
      `Topic sync role connection limit mismatch; expected ${expectedConnectionLimit}, found ${target.rolconnlimit}`,
    );
  }
  if (
    target.rolsuper ||
    target.rolcreatedb ||
    target.rolcreaterole ||
    target.rolreplication ||
    target.rolbypassrls
  ) {
    throw new Error('Topic sync role has elevated PostgreSQL role attributes');
  }
  if (target.database_owner === userName) {
    throw new Error('Topic sync role must not own the target database');
  }
  if (
    !target.database_connect ||
    target.database_connect_grantable ||
    target.database_create ||
    target.database_temp
  ) {
    throw new Error('Topic sync role requires CONNECT only, without database CREATE or TEMPORARY');
  }
  if (!target.public_usage || target.public_usage_grantable || target.public_create) {
    throw new Error('Topic sync role requires public schema USAGE without CREATE');
  }
  if (!target.topic_status_usage || target.topic_status_usage_grantable) {
    throw new Error('Topic sync role lacks USAGE on public.topic_status');
  }

  const memberships = await client.query(
    `SELECT count(*)::integer AS count
     FROM pg_auth_members AS membership_info
     JOIN pg_roles AS member_info ON member_info.oid = membership_info.member
     WHERE member_info.rolname = session_user`,
  );
  if (memberships.rows[0]?.count !== 0) {
    throw new Error('Topic sync role must not inherit or be able to SET ROLE into another role');
  }

  const extraSchemaPrivileges = await client.query(
    `SELECT namespace_info.nspname AS name,
            pg_get_userbyid(namespace_info.nspowner) AS owner,
            has_schema_privilege(current_user, namespace_info.oid, 'USAGE') AS usage,
            has_schema_privilege(
              current_user,
              namespace_info.oid,
              'USAGE WITH GRANT OPTION'
            ) AS usage_grantable,
            has_schema_privilege(current_user, namespace_info.oid, 'CREATE') AS create_allowed,
            has_schema_privilege(
              current_user,
              namespace_info.oid,
              'CREATE WITH GRANT OPTION'
            ) AS create_grantable
     FROM pg_namespace AS namespace_info
     WHERE namespace_info.nspname <> 'public'
       AND namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
     ORDER BY namespace_info.nspname`,
  );
  const accessibleExtraSchemas = extraSchemaPrivileges.rows.filter(
    (row) =>
      row.owner === userName ||
      row.usage === true ||
      row.usage_grantable === true ||
      row.create_allowed === true ||
      row.create_grantable === true,
  );
  if (accessibleExtraSchemas.length > 0) {
    throw new Error(
      `Topic sync role has privileges on extra schemas: ${accessibleExtraSchemas
        .map((row) => row.name)
        .join(', ')}`,
    );
  }

  const relations = await client.query(
    `SELECT relation_info.relname AS name,
            relation_info.relkind,
            relation_info.relpersistence,
            relation_info.relrowsecurity,
            relation_info.relforcerowsecurity,
            pg_get_userbyid(relation_info.relowner) AS owner,
            (SELECT count(*)::integer
             FROM pg_policy AS policy_info
             WHERE policy_info.polrelid = relation_info.oid) AS policy_count,
            (SELECT count(*)::integer
             FROM pg_trigger AS trigger_info
             WHERE trigger_info.tgrelid = relation_info.oid
               AND NOT trigger_info.tgisinternal) AS user_trigger_count,
            (SELECT count(*)::integer
             FROM pg_rewrite AS rewrite_info
             WHERE rewrite_info.ev_class = relation_info.oid) AS rewrite_rule_count
     FROM pg_class AS relation_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
     WHERE namespace_info.nspname = 'public'
       AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     ORDER BY relation_info.relname`,
  );
  const expectedRelations = new Set(expectedTableNames);
  const actualRelations = new Set(relations.rows.map((row) => row.name));
  const missingRelations = [...expectedRelations].filter((name) => !actualRelations.has(name));
  const unexpectedRelations = [...actualRelations].filter((name) => !expectedRelations.has(name));
  if (missingRelations.length > 0 || unexpectedRelations.length > 0) {
    throw new Error(
      `Topic sync public relation contract mismatch; missing [${missingRelations.join(', ')}], unexpected [${unexpectedRelations.join(', ')}]`,
    );
  }
  for (const relation of relations.rows) {
    if (
      relation.relkind !== 'r' ||
      relation.relpersistence !== 'p' ||
      relation.relrowsecurity ||
      relation.relforcerowsecurity ||
      relation.policy_count !== 0 ||
      relation.user_trigger_count !== 0
    ) {
      throw new Error(
        `Topic sync public relation is not a plain protected table: ${relation.name}`,
      );
    }
    if (relation.owner === userName) {
      throw new Error(`Topic sync role must not own public relation ${relation.name}`);
    }
    if (relation.rewrite_rule_count !== 0) {
      throw new Error(`Topic sync public relation has unexpected rewrite rule: ${relation.name}`);
    }
  }

  const privileges = await effectiveTablePrivileges(client);
  requireExactPrivileges(privileges, 'public.topics', ['SELECT', 'INSERT', 'UPDATE']);
  requireExactPrivileges(privileges, 'public.hzense_schema_migrations', ['SELECT']);
  const unexpectedTablePrivileges = privileges.filter(
    (row) =>
      `${row.schema_name}.${row.table_name}` !== 'public.topics' &&
      `${row.schema_name}.${row.table_name}` !== 'public.hzense_schema_migrations',
  );
  if (unexpectedTablePrivileges.length > 0) {
    const details = unexpectedTablePrivileges
      .map((row) => `${row.schema_name}.${row.table_name}:${row.privilege}`)
      .join(', ');
    throw new Error(`Topic sync role has privileges on unrelated tables: ${details}`);
  }

  const columnPrivileges = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            table_info.relname AS table_name,
            column_info.attname AS column_name,
            acl_info.privilege_type,
            acl_info.is_grantable
     FROM pg_class AS table_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
     CROSS JOIN LATERAL aclexplode(column_info.attacl) AS acl_info
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND column_info.attnum > 0
       AND NOT column_info.attisdropped
       AND (
         acl_info.grantee = 0
         OR acl_info.grantee = (SELECT oid FROM pg_roles WHERE rolname = session_user)
       )
     ORDER BY namespace_info.nspname,
              table_info.relname,
              column_info.attname,
              acl_info.privilege_type`,
  );
  if (columnPrivileges.rowCount !== 0) {
    throw new Error(
      `Topic sync role must not receive column-level privileges: ${columnPrivileges.rows
        .map(
          (row) => `${row.schema_name}.${row.table_name}.${row.column_name}:${row.privilege_type}`,
        )
        .join(', ')}`,
    );
  }

  const ownedObjects = await client.query(
    `SELECT 'schema' AS object_type,
            namespace_info.nspname AS schema_name,
            namespace_info.nspname AS name
     FROM pg_namespace AS namespace_info
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND pg_get_userbyid(namespace_info.nspowner) = session_user
     UNION ALL
     SELECT 'type' AS object_type,
            namespace_info.nspname AS schema_name,
            type_info.typname AS name
     FROM pg_type AS type_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND pg_get_userbyid(type_info.typowner) = session_user
     UNION ALL
     SELECT 'relation' AS object_type,
            namespace_info.nspname AS schema_name,
            relation_info.relname AS name
     FROM pg_class AS relation_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND pg_get_userbyid(relation_info.relowner) = session_user
     UNION ALL
     SELECT 'extension' AS object_type,
            NULL::name AS schema_name,
            extension_info.extname AS name
     FROM pg_extension AS extension_info
     WHERE pg_get_userbyid(extension_info.extowner) = session_user
     UNION ALL
     SELECT 'routine' AS object_type,
            namespace_info.nspname AS schema_name,
            routine_info.proname AS name
     FROM pg_proc AS routine_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND pg_get_userbyid(routine_info.proowner) = session_user
     ORDER BY object_type, schema_name, name`,
  );
  if (ownedObjects.rowCount !== 0) {
    throw new Error(
      `Topic sync role must not own schema objects: ${ownedObjects.rows
        .map((row) =>
          row.schema_name
            ? `${row.object_type}:${row.schema_name}.${row.name}`
            : `${row.object_type}:${row.name}`,
        )
        .join(', ')}`,
    );
  }

  const executableSecurityDefinerRoutines = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            routine_info.proname AS name,
            pg_get_function_identity_arguments(routine_info.oid) AS identity_arguments
     FROM pg_proc AS routine_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND routine_info.prosecdef
       AND has_schema_privilege(current_user, namespace_info.oid, 'USAGE')
       AND has_function_privilege(current_user, routine_info.oid, 'EXECUTE')
     ORDER BY namespace_info.nspname, routine_info.proname, routine_info.oid`,
  );
  if (executableSecurityDefinerRoutines.rowCount !== 0) {
    throw new Error(
      `Topic sync role must not execute SECURITY DEFINER routines: ${executableSecurityDefinerRoutines.rows
        .map((row) => `${row.schema_name}.${row.name}(${row.identity_arguments})`)
        .join(', ')}`,
    );
  }

  const sequencePrivileges = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            sequence_info.relname AS name
     FROM pg_class AS sequence_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = sequence_info.relnamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND sequence_info.relkind = 'S'
       AND (has_sequence_privilege(current_user, sequence_info.oid, 'USAGE')
         OR has_sequence_privilege(current_user, sequence_info.oid, 'SELECT')
         OR has_sequence_privilege(current_user, sequence_info.oid, 'UPDATE'))
     ORDER BY namespace_info.nspname, sequence_info.relname`,
  );
  if (sequencePrivileges.rowCount !== 0) {
    throw new Error('Topic sync role must not have sequence privileges');
  }

  const defaultPrivileges = await client.query(
    `SELECT count(*)::integer AS count
     FROM pg_default_acl AS default_acl
     CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
     WHERE acl_info.grantee IN (
       0,
       (SELECT oid FROM pg_roles WHERE rolname = session_user)
     )
       AND default_acl.defaclobjtype IN ('r', 'S')`,
  );
  if (defaultPrivileges.rows[0]?.count !== 0) {
    throw new Error('Topic sync role must not receive future table or sequence default privileges');
  }

  const history = await client.query(
    'SELECT name, checksum FROM public.hzense_schema_migrations ORDER BY name',
  );
  const pending = planPendingMigrations(migrations, history.rows);
  if (pending.length > 0) {
    throw new Error(
      `Topic sync requires a fully migrated database; pending: ${pending.map((item) => item.name).join(', ')}`,
    );
  }

  let tls = { source: 'local', version: 'local plaintext', cipher: 'none' };
  if (profile === 'production') {
    assertDirectTopicSyncEndpoint(expectedHost);
    tls = await inspectProductionTls(client, expectedHost);
  } else if (profile !== 'local-test') {
    throw new Error('database profile must be local-test or production');
  }

  return {
    database: databaseName,
    user: userName,
    postgresMajor,
    connectionLimit: target.rolconnlimit,
    migrationCount: migrations.length,
    tlsVersion: tls.version,
    tlsCipher: tls.cipher,
    tlsEvidence: tls.source,
  };
}
