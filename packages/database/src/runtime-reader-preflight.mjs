import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import pg from 'pg';
import { validateConnectionTarget } from './connection-policy.mjs';
import { inspectProductionTls } from './preflight.mjs';
import { expectedTableNames } from './verify.mjs';

const { Client } = pg;
const pooledHostPattern = /(^|[.-])pooler([.-]|$)/;
const neonHostSuffix = '.neon.tech';
// Neon owns these cluster-reserved database ACLs through cloud_admin. The
// target inspection can defer only this exact catalog shape to a second,
// database-local inspection; the exported single-target inspector remains
// strict so callers cannot accidentally skip that second proof.
const neonReservedDatabaseContracts = new Map([
  [
    'postgres',
    {
      owner: 'cloud_admin',
      isTemplate: false,
      allowsTemporary: true,
      usesDefaultAcl: true,
    },
  ],
  [
    'template1',
    {
      owner: 'cloud_admin',
      isTemplate: true,
      allowsTemporary: false,
      usesDefaultAcl: false,
    },
  ],
]);
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
const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];
const expectedPhysicalTopicColumns = new Set([
  'id',
  'title',
  'parent_id',
  'status',
  'metadata',
  'runtime_enabled',
]);

export const runtimeReaderRoleName = 'hzense_runtime';
// Neon grants its branch owner a cloud_admin-managed ADMIN-only membership for
// every console-created role. With INHERIT and SET both disabled this does not
// let neondb_owner assume Runtime privileges. ADMIN can still regrant the role,
// so this accepted provider-governance residual is runner-only and any
// different membership or option shape remains a rollout blocker.
const neonRuntimeAdminMembershipContract = Object.freeze({
  member: 'neondb_owner',
  grantedRole: runtimeReaderRoleName,
  grantor: 'cloud_admin',
  adminOption: true,
  inheritOption: false,
  setOption: false,
});
// Neon 0.8.6 installs pgvector through two provider roles: neondb_owner owns
// the extension while cloud_admin owns all extension routines. This is not the
// portable pgvector ownership model, so only the production runner may accept
// it after the reviewed Neon endpoint and TLS session have been proved.
const neonVectorOwnershipSplitContract = Object.freeze({
  extensionName: 'vector',
  extensionVersion: '0.8.6',
  extensionOwner: 'neondb_owner',
  routineOwner: 'cloud_admin',
  routineCount: 118,
});
export const runtimeReaderTopicColumns = Object.freeze([
  'id',
  'title',
  'parent_id',
  'status',
  'runtime_enabled',
]);

export function runtimeReaderProductionOptions(environment = process.env) {
  return {
    connectionString: environment.HZENSE_RUNTIME_DATABASE_URL,
    profile: 'production',
    expectedHost: environment.HZENSE_RUNTIME_EXPECTED_HOST,
    expectedPort: environment.HZENSE_RUNTIME_EXPECTED_PORT,
    expectedDatabase: environment.HZENSE_RUNTIME_EXPECTED_NAME,
    expectedUser: environment.HZENSE_RUNTIME_EXPECTED_USER,
    nodeTlsRejectUnauthorized: environment.NODE_TLS_REJECT_UNAUTHORIZED,
    expectedPostgresMajor: Number(environment.HZENSE_RUNTIME_EXPECTED_POSTGRES_MAJOR ?? '18'),
    expectedConnectionLimit: Number(environment.HZENSE_RUNTIME_EXPECTED_CONNECTION_LIMIT ?? '20'),
  };
}

function requireProductionRuntimeConnection(connectionString, host) {
  const url = new URL(connectionString);
  if (!pooledHostPattern.test(host) || !host.endsWith(neonHostSuffix)) {
    throw new Error('Runtime reader production connection must use an approved Neon pooler');
  }
  if (!url.password) {
    throw new Error('Runtime reader production URL must contain its dedicated credential');
  }
  const parameters = [...url.searchParams.entries()];
  if (
    parameters.length !== 2 ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.searchParams.get('channel_binding') !== 'prefer'
  ) {
    throw new Error(
      'Runtime reader production URL must set only sslmode=verify-full and channel_binding=prefer',
    );
  }
}

export function runtimeReaderPreflightFailureMessage(error) {
  const sqlstate =
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : undefined;
  return sqlstate ? `unavailable; sqlstate=${sqlstate}` : 'unavailable';
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function setDifference(expected, actual) {
  return [...expected].filter((value) => !actual.has(value)).sort();
}

export function isApprovedNeonReservedDatabaseException(row, profile) {
  const contract = neonReservedDatabaseContracts.get(row?.name);
  return (
    profile === 'production' &&
    contract !== undefined &&
    row.owner === contract.owner &&
    row.is_template === contract.isTemplate &&
    row.allows_connections === true &&
    row.connection_limit === -1 &&
    row.connect_allowed === true &&
    row.connect_grantable === false &&
    row.create_allowed === false &&
    row.create_grantable === false &&
    row.temporary_allowed === contract.allowsTemporary &&
    row.temporary_grantable === false &&
    row.acl_is_default === contract.usesDefaultAcl &&
    row.public_connect === true &&
    row.public_connect_grantable === false &&
    row.public_create === false &&
    row.public_temporary === contract.allowsTemporary &&
    row.direct_runtime_acl === false
  );
}

export function isApprovedNeonRuntimeAdminMembership(row, profile) {
  const contract = neonRuntimeAdminMembershipContract;
  return (
    profile === 'production' &&
    row?.member === contract.member &&
    row?.granted_role === contract.grantedRole &&
    row?.grantor === contract.grantor &&
    row?.admin_option === contract.adminOption &&
    row?.inherit_option === contract.inheritOption &&
    row?.set_option === contract.setOption
  );
}

function isApprovedNeonVectorOwnershipSplit(row, profile) {
  const contract = neonVectorOwnershipSplitContract;
  return (
    profile === 'production' &&
    row?.extension_name === contract.extensionName &&
    row?.extension_version === contract.extensionVersion &&
    row?.extension_owner === contract.extensionOwner &&
    row?.routine_count === contract.routineCount &&
    row?.public_routine_count === contract.routineCount &&
    row?.approved_routine_owner_count === contract.routineCount &&
    row?.executable_routine_count === contract.routineCount &&
    row?.public_execute_count === contract.routineCount &&
    row?.security_definer_count === 0 &&
    row?.grantable_count === 0 &&
    row?.direct_runtime_acl_count === 0
  );
}

function isApprovedNeonVectorOwnershipSplitRoutine(row, profile) {
  const contract = neonVectorOwnershipSplitContract;
  return (
    profile === 'production' &&
    row?.schema_name === 'public' &&
    row?.extension_name === contract.extensionName &&
    row?.extension_version === contract.extensionVersion &&
    row?.extension_owner === contract.extensionOwner &&
    row?.routine_owner === contract.routineOwner &&
    row?.security_definer === false &&
    row?.grantable === false &&
    row?.direct_runtime_acl === false
  );
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

async function effectiveColumnPrivileges(client) {
  return (
    await client.query(
      `SELECT namespace_info.nspname AS schema_name,
              table_info.relname AS table_name,
              column_info.attname AS column_name,
              privilege_info.privilege,
              has_column_privilege(
                current_user,
                table_info.oid,
                column_info.attnum,
                privilege_info.privilege
              ) AS granted,
              has_column_privilege(
                current_user,
                table_info.oid,
                column_info.attnum,
                privilege_info.privilege || ' WITH GRANT OPTION'
              ) AS grantable
       FROM pg_class AS table_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
       JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
       CROSS JOIN unnest($1::text[]) AS privilege_info(privilege)
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND table_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
       ORDER BY namespace_info.nspname,
                table_info.relname,
                column_info.attnum,
                privilege_info.privilege`,
      [columnPrivileges],
    )
  ).rows.filter((row) => row.granted === true || row.grantable === true);
}

function requireExactRuntimeColumns(rows) {
  const expected = new Set(
    runtimeReaderTopicColumns.map((column) => `public.topics.${column}:SELECT`),
  );
  const actual = new Set(
    rows.map((row) => `${row.schema_name}.${row.table_name}.${row.column_name}:${row.privilege}`),
  );
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);
  const grantable = rows
    .filter((row) => row.grantable === true)
    .map((row) => `${row.schema_name}.${row.table_name}.${row.column_name}:${row.privilege}`)
    .sort();
  if (missing.length > 0 || unexpected.length > 0 || grantable.length > 0) {
    throw new Error(
      `Runtime reader column privileges are invalid; missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}], grantable [${grantable.join(', ')}]`,
    );
  }
}

async function inspectRuntimeReaderTarget(
  client,
  {
    expectedHost,
    expectedDatabase,
    expectedUser,
    expectedPostgresMajor = 18,
    expectedConnectionLimit = 20,
    profile,
  },
  {
    allowNeonReservedDatabases = false,
    allowNeonRuntimeAdminMembership = false,
    allowNeonVectorOwnershipSplit = false,
  } = {},
) {
  const databaseName = requireString(expectedDatabase, 'HZENSE_RUNTIME_EXPECTED_NAME');
  const userName = requireString(expectedUser, 'HZENSE_RUNTIME_EXPECTED_USER');
  if (userName !== runtimeReaderRoleName) {
    throw new Error(`Runtime reader must authenticate as ${runtimeReaderRoleName}`);
  }
  if (expectedPostgresMajor !== 18) {
    throw new Error('HZENSE_RUNTIME_EXPECTED_POSTGRES_MAJOR must be 18');
  }
  if (expectedConnectionLimit !== 20) {
    throw new Error('HZENSE_RUNTIME_EXPECTED_CONNECTION_LIMIT must be 20');
  }
  if (!client || typeof client.query !== 'function') {
    throw new Error('Runtime reader preflight requires a connected PostgreSQL client');
  }

  const identity = await client.query(
    `SELECT current_database() AS database_name,
            session_user AS authenticated_role,
            current_user AS effective_role,
            current_schema() AS schema_name,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('default_transaction_read_only') = 'on' AS default_read_only,
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
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM pg_db_role_setting AS role_setting
                WHERE role_setting.setrole = role_info.oid
                  AND role_setting.setdatabase = database_info.oid
                  AND EXISTS (
                    SELECT 1
                    FROM unnest(role_setting.setconfig) AS configured_value(value)
                    WHERE configured_value.value LIKE 'default_transaction_read_only=%'
                  )
              )
              THEN EXISTS (
                SELECT 1
                FROM pg_db_role_setting AS role_setting
                WHERE role_setting.setrole = role_info.oid
                  AND role_setting.setdatabase = database_info.oid
                  AND role_setting.setconfig
                    @> ARRAY['default_transaction_read_only=on']::text[]
              )
              ELSE COALESCE(role_info.rolconfig, ARRAY[]::text[])
                @> ARRAY['default_transaction_read_only=on']::text[]
            END AS role_default_read_only,
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
  if (!target) throw new Error('Database did not return the Runtime reader role');
  if (
    target.database_name !== databaseName ||
    target.authenticated_role !== userName ||
    target.effective_role !== userName
  ) {
    throw new Error(
      `Runtime reader target mismatch; expected ${databaseName}/${userName}, found ${target.database_name}/${target.authenticated_role}/${target.effective_role}`,
    );
  }
  if (target.schema_name !== 'public') {
    throw new Error('Runtime reader current_schema must be public');
  }
  const postgresMajor = Math.floor(target.server_version_num / 10_000);
  if (postgresMajor !== expectedPostgresMajor) {
    throw new Error(
      `PostgreSQL major mismatch; expected ${expectedPostgresMajor}, found ${postgresMajor}`,
    );
  }
  if (!target.default_read_only || !target.read_only || !target.role_default_read_only) {
    throw new Error(
      'Runtime reader requires provider-configured default_transaction_read_only=on and a read-only session',
    );
  }
  if (target.in_recovery) {
    throw new Error('Runtime reader database target is in recovery');
  }
  if (!target.rolcanlogin || target.rolinherit) {
    throw new Error('Runtime reader role must be LOGIN and NOINHERIT');
  }
  if (target.rolconnlimit !== expectedConnectionLimit) {
    throw new Error(
      `Runtime reader role connection limit mismatch; expected ${expectedConnectionLimit}, found ${target.rolconnlimit}`,
    );
  }
  if (
    target.rolsuper ||
    target.rolcreatedb ||
    target.rolcreaterole ||
    target.rolreplication ||
    target.rolbypassrls
  ) {
    throw new Error('Runtime reader role has elevated PostgreSQL role attributes');
  }
  if (target.database_owner === userName) {
    throw new Error('Runtime reader role must not own the target database');
  }
  if (
    !target.database_connect ||
    target.database_connect_grantable ||
    target.database_create ||
    target.database_temp
  ) {
    throw new Error('Runtime reader requires CONNECT only, without database CREATE or TEMPORARY');
  }
  if (!target.public_usage || target.public_usage_grantable || target.public_create) {
    throw new Error('Runtime reader requires public schema USAGE without CREATE');
  }
  if (!target.topic_status_usage || target.topic_status_usage_grantable) {
    throw new Error('Runtime reader requires non-grantable USAGE on public.topic_status');
  }

  const otherDatabasePrivileges = await client.query(
    `SELECT database_info.datname AS name,
            pg_get_userbyid(database_info.datdba) AS owner,
            database_info.datistemplate AS is_template,
            database_info.datallowconn AS allows_connections,
            database_info.datconnlimit AS connection_limit,
            database_info.datacl IS NULL AS acl_is_default,
            has_database_privilege(current_user, database_info.oid, 'CONNECT') AS connect_allowed,
            has_database_privilege(
              current_user,
              database_info.oid,
              'CONNECT WITH GRANT OPTION'
            ) AS connect_grantable,
            has_database_privilege(current_user, database_info.oid, 'CREATE') AS create_allowed,
            has_database_privilege(
              current_user,
              database_info.oid,
              'CREATE WITH GRANT OPTION'
            ) AS create_grantable,
            has_database_privilege(
              current_user,
              database_info.oid,
              'TEMPORARY'
            ) AS temporary_allowed,
            has_database_privilege(
              current_user,
              database_info.oid,
              'TEMPORARY WITH GRANT OPTION'
            ) AS temporary_grantable,
            EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
              ) AS acl_info
              WHERE acl_info.grantee = 0
                AND acl_info.privilege_type = 'CONNECT'
            ) AS public_connect,
            EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
              ) AS acl_info
              WHERE acl_info.grantee = 0
                AND acl_info.privilege_type = 'CONNECT'
                AND acl_info.is_grantable
            ) AS public_connect_grantable,
            EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
              ) AS acl_info
              WHERE acl_info.grantee = 0
                AND acl_info.privilege_type = 'CREATE'
            ) AS public_create,
            EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
              ) AS acl_info
              WHERE acl_info.grantee = 0
                AND acl_info.privilege_type = 'TEMPORARY'
            ) AS public_temporary,
            EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
              ) AS acl_info
              WHERE acl_info.grantee = (
                SELECT oid FROM pg_roles WHERE rolname = current_user
              )
            ) AS direct_runtime_acl
     FROM pg_database AS database_info
     WHERE database_info.oid <> (
       SELECT oid FROM pg_database WHERE datname = current_database()
     )
       AND database_info.datallowconn
     ORDER BY database_info.datname`,
  );
  const accessibleOtherDatabases = otherDatabasePrivileges.rows.filter(
    (row) =>
      row.connect_allowed === true || row.create_allowed === true || row.temporary_allowed === true,
  );
  const approvedNeonReservedDatabases = allowNeonReservedDatabases
    ? accessibleOtherDatabases.filter((row) =>
        isApprovedNeonReservedDatabaseException(row, profile),
      )
    : [];
  const approvedNeonReservedNames = new Set(approvedNeonReservedDatabases.map((row) => row.name));
  const unsafeOtherDatabases = accessibleOtherDatabases.filter(
    (row) => !approvedNeonReservedNames.has(row.name),
  );
  if (unsafeOtherDatabases.length > 0) {
    throw new Error(
      `Runtime reader has privileges on other connectable databases: ${unsafeOtherDatabases
        .map((row) => row.name)
        .join(', ')}`,
    );
  }

  const enumTypePrivileges = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            type_info.typname AS name,
            has_type_privilege(current_user, type_info.oid, 'USAGE') AS usage,
            has_type_privilege(
              current_user,
              type_info.oid,
              'USAGE WITH GRANT OPTION'
            ) AS usage_grantable
     FROM pg_type AS type_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND type_info.typtype = 'e'
     ORDER BY namespace_info.nspname, type_info.typname`,
  );
  const unexpectedEnumPrivileges = enumTypePrivileges.rows.filter(
    (row) =>
      (row.usage === true || row.usage_grantable === true) &&
      !(
        row.schema_name === 'public' &&
        row.name === 'topic_status' &&
        row.usage_grantable !== true
      ),
  );
  if (unexpectedEnumPrivileges.length > 0) {
    throw new Error(
      `Runtime reader has USAGE on unexpected application enum Types: ${unexpectedEnumPrivileges
        .map((row) => `${row.schema_name}.${row.name}`)
        .join(', ')}`,
    );
  }

  const memberships = await client.query(
    `SELECT member_info.rolname AS member,
            granted_info.rolname AS granted_role,
            grantor_info.rolname AS grantor,
            membership_info.admin_option,
            membership_info.inherit_option,
            membership_info.set_option
     FROM pg_auth_members AS membership_info
     JOIN pg_roles AS member_info ON member_info.oid = membership_info.member
     JOIN pg_roles AS granted_info ON granted_info.oid = membership_info.roleid
     JOIN pg_roles AS grantor_info ON grantor_info.oid = membership_info.grantor
     WHERE (
       membership_info.member = (
         SELECT oid FROM pg_roles WHERE rolname = session_user
       )
       OR membership_info.roleid = (
         SELECT oid FROM pg_roles WHERE rolname = session_user
       )
     )
     ORDER BY member_info.rolname, granted_info.rolname, grantor_info.rolname`,
  );
  const unsafeMemberships = memberships.rows.filter(
    (row) =>
      !(allowNeonRuntimeAdminMembership && isApprovedNeonRuntimeAdminMembership(row, profile)),
  );
  if (unsafeMemberships.length > 0) {
    throw new Error('Runtime reader role has unsafe incoming or outgoing role memberships');
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
      `Runtime reader has privileges on extra schemas: ${accessibleExtraSchemas
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
       AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY relation_info.relname`,
  );
  const expectedRelations = new Set(expectedTableNames);
  const actualRelations = new Set(relations.rows.map((row) => row.name));
  const missingRelations = setDifference(expectedRelations, actualRelations);
  const unexpectedRelations = setDifference(actualRelations, expectedRelations);
  if (missingRelations.length > 0 || unexpectedRelations.length > 0) {
    throw new Error(
      `Runtime reader public relation contract mismatch; missing [${missingRelations.join(', ')}], unexpected [${unexpectedRelations.join(', ')}]`,
    );
  }
  for (const relation of relations.rows) {
    if (
      relation.relkind !== 'r' ||
      relation.relpersistence !== 'p' ||
      relation.relrowsecurity ||
      relation.relforcerowsecurity ||
      relation.policy_count !== 0 ||
      relation.user_trigger_count !== 0 ||
      relation.rewrite_rule_count !== 0
    ) {
      throw new Error(
        `Runtime reader public relation is not a plain protected table: ${relation.name}`,
      );
    }
    if (relation.owner === userName) {
      throw new Error(`Runtime reader must not own public relation ${relation.name}`);
    }
  }

  const inheritanceEdges = await client.query(
    `SELECT parent_namespace.nspname AS parent_schema,
            parent_info.relname AS parent_name,
            child_namespace.nspname AS child_schema,
            child_info.relname AS child_name
     FROM pg_inherits AS inheritance_info
     JOIN pg_class AS parent_info ON parent_info.oid = inheritance_info.inhparent
     JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_info.relnamespace
     JOIN pg_class AS child_info ON child_info.oid = inheritance_info.inhrelid
     JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_info.relnamespace
     WHERE (
       parent_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND parent_namespace.nspname !~ '^pg_temp_[0-9]+$'
       AND parent_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
     ) OR (
       child_namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND child_namespace.nspname !~ '^pg_temp_[0-9]+$'
       AND child_namespace.nspname !~ '^pg_toast_temp_[0-9]+$'
     )
     ORDER BY parent_namespace.nspname,
              parent_info.relname,
              child_namespace.nspname,
              child_info.relname`,
  );
  if (inheritanceEdges.rowCount !== 0) {
    throw new Error(
      `Runtime reader forbids PostgreSQL table inheritance: ${inheritanceEdges.rows
        .map(
          (row) => `${row.parent_schema}.${row.parent_name}->${row.child_schema}.${row.child_name}`,
        )
        .join(', ')}`,
    );
  }

  const physicalTopicColumns = await client.query(
    `SELECT column_info.attname AS name
     FROM pg_attribute AS column_info
     WHERE column_info.attrelid = 'public.topics'::regclass
       AND column_info.attnum > 0
       AND NOT column_info.attisdropped
     ORDER BY column_info.attnum`,
  );
  const actualTopicColumns = new Set(physicalTopicColumns.rows.map((row) => row.name));
  const missingTopicColumns = setDifference(expectedPhysicalTopicColumns, actualTopicColumns);
  const unexpectedTopicColumns = setDifference(actualTopicColumns, expectedPhysicalTopicColumns);
  if (missingTopicColumns.length > 0 || unexpectedTopicColumns.length > 0) {
    throw new Error(
      `Runtime reader topics column contract mismatch; missing [${missingTopicColumns.join(', ')}], unexpected [${unexpectedTopicColumns.join(', ')}]`,
    );
  }

  const relationPrivileges = await effectiveTablePrivileges(client);
  if (relationPrivileges.length > 0) {
    throw new Error(
      `Runtime reader must not receive table-level privileges: ${relationPrivileges
        .map((row) => `${row.schema_name}.${row.table_name}:${row.privilege}`)
        .join(', ')}`,
    );
  }
  requireExactRuntimeColumns(await effectiveColumnPrivileges(client));

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
      `Runtime reader must not own schema objects: ${ownedObjects.rows
        .map((row) =>
          row.schema_name
            ? `${row.object_type}:${row.schema_name}.${row.name}`
            : `${row.object_type}:${row.name}`,
        )
        .join(', ')}`,
    );
  }

  let runnerVerifiedTls;
  let approvedNeonVectorOwnershipSplit = false;
  if (allowNeonVectorOwnershipSplit) {
    if (profile !== 'production') {
      throw new Error('Neon pgvector ownership verification is production-only');
    }
    // The runner validates the Neon pooler before connecting. Verify the live
    // TLS session before considering the provider-specific ownership split.
    runnerVerifiedTls = await inspectProductionTls(client, expectedHost);
    const vectorOwnershipSplit = await client.query(
      `SELECT extension_info.extname AS extension_name,
              extension_info.extversion AS extension_version,
              pg_get_userbyid(extension_info.extowner) AS extension_owner,
              count(DISTINCT routine_info.oid)::integer AS routine_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE namespace_info.nspname = 'public'
              ))::integer AS public_routine_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE pg_get_userbyid(routine_info.proowner) = 'cloud_admin'
              ))::integer AS approved_routine_owner_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE routine_info.prosecdef
              ))::integer AS security_definer_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE has_function_privilege(current_user, routine_info.oid, 'EXECUTE')
              ))::integer AS executable_routine_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE EXISTS (
                  SELECT 1
                  FROM aclexplode(
                    COALESCE(
                      routine_info.proacl,
                      acldefault('f', routine_info.proowner)
                    )
                  ) AS acl_info
                  WHERE acl_info.grantee = 0
                    AND acl_info.privilege_type = 'EXECUTE'
                )
              ))::integer AS public_execute_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE has_function_privilege(
                  current_user,
                  routine_info.oid,
                  'EXECUTE WITH GRANT OPTION'
                )
              ))::integer AS grantable_count,
              (count(DISTINCT routine_info.oid) FILTER (
                WHERE EXISTS (
                  SELECT 1
                  FROM aclexplode(routine_info.proacl) AS acl_info
                  WHERE acl_info.grantee = (
                    SELECT oid FROM pg_roles WHERE rolname = session_user
                  )
                )
              ))::integer AS direct_runtime_acl_count
       FROM pg_extension AS extension_info
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.refobjid = extension_info.oid
        AND extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_proc AS routine_info ON routine_info.oid = extension_dependency.objid
       LEFT JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = routine_info.pronamespace
       WHERE extension_info.extname = 'vector'
       GROUP BY extension_info.extname,
                extension_info.extversion,
                extension_info.extowner`,
    );
    approvedNeonVectorOwnershipSplit =
      vectorOwnershipSplit.rows.length === 1 &&
      isApprovedNeonVectorOwnershipSplit(vectorOwnershipSplit.rows[0], profile);
    if (!approvedNeonVectorOwnershipSplit) {
      throw new Error('Runtime reader Neon pgvector ownership contract changed');
    }
  }

  const executableRoutineAudit = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            routine_info.proname AS name,
            pg_get_function_identity_arguments(routine_info.oid) AS identity_arguments,
            routine_info.prosecdef AS security_definer,
            extension_info.extname AS extension_name,
            extension_info.extversion AS extension_version,
            pg_get_userbyid(extension_info.extowner) AS extension_owner,
            pg_get_userbyid(routine_info.proowner) AS routine_owner,
            has_function_privilege(
              current_user,
              routine_info.oid,
              'EXECUTE WITH GRANT OPTION'
            ) AS grantable,
            EXISTS (
              SELECT 1
              FROM aclexplode(routine_info.proacl) AS acl_info
              WHERE acl_info.grantee = (
                SELECT oid FROM pg_roles WHERE rolname = session_user
              )
            ) AS direct_runtime_acl
     FROM pg_proc AS routine_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
     LEFT JOIN pg_depend AS extension_dependency
       ON extension_dependency.classid = 'pg_proc'::regclass
      AND extension_dependency.objid = routine_info.oid
      AND extension_dependency.deptype = 'e'
     LEFT JOIN pg_extension AS extension_info
       ON extension_info.oid = extension_dependency.refobjid
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND has_function_privilege(current_user, routine_info.oid, 'EXECUTE')
       AND (
         extension_info.oid IS NULL
         OR extension_info.extname <> 'vector'
         OR routine_info.proowner <> extension_info.extowner
         OR extension_info.extowner = (
           SELECT oid FROM pg_roles WHERE rolname = session_user
         )
         OR extension_info.extowner = (
           SELECT datdba FROM pg_database WHERE datname = current_database()
         )
         OR routine_info.prosecdef
         OR has_function_privilege(
           current_user,
           routine_info.oid,
           'EXECUTE WITH GRANT OPTION'
         )
       )
     ORDER BY namespace_info.nspname, routine_info.proname, routine_info.oid`,
  );
  const unsafeExecutableRoutines = executableRoutineAudit.rows.filter(
    (row) =>
      !(
        approvedNeonVectorOwnershipSplit && isApprovedNeonVectorOwnershipSplitRoutine(row, profile)
      ),
  );
  if (unsafeExecutableRoutines.length !== 0) {
    throw new Error(
      'Runtime reader can execute unsafe non-pgvector application or SECURITY DEFINER routines',
    );
  }

  const directRoutineGrants = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            routine_info.proname AS name,
            pg_get_function_identity_arguments(routine_info.oid) AS identity_arguments,
            acl_info.is_grantable
     FROM pg_proc AS routine_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
     CROSS JOIN LATERAL aclexplode(routine_info.proacl) AS acl_info
     WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
       AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       AND acl_info.grantee = (SELECT oid FROM pg_roles WHERE rolname = session_user)
     ORDER BY namespace_info.nspname, routine_info.proname, routine_info.oid`,
  );
  if (directRoutineGrants.rowCount !== 0) {
    throw new Error('Runtime reader must not receive direct routine grants');
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
       AND (
         has_sequence_privilege(current_user, sequence_info.oid, 'USAGE')
         OR has_sequence_privilege(current_user, sequence_info.oid, 'SELECT')
         OR has_sequence_privilege(current_user, sequence_info.oid, 'UPDATE')
       )
     ORDER BY namespace_info.nspname, sequence_info.relname`,
  );
  if (sequencePrivileges.rowCount !== 0) {
    throw new Error('Runtime reader must not have sequence privileges');
  }

  const defaultPrivileges = await client.query(
    `SELECT owner_info.rolname AS owner,
            default_acl.defaclobjtype AS object_type,
            namespace_info.nspname AS schema_name,
            acl_info.privilege_type,
            acl_info.is_grantable
     FROM pg_default_acl AS default_acl
     JOIN pg_roles AS owner_info ON owner_info.oid = default_acl.defaclrole
     LEFT JOIN pg_namespace AS namespace_info ON namespace_info.oid = default_acl.defaclnamespace
     CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
     WHERE default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
       AND (
         acl_info.grantee = (SELECT oid FROM pg_roles WHERE rolname = session_user)
         OR (
           acl_info.grantee = 0
           AND default_acl.defaclrole = (
             SELECT datdba FROM pg_database WHERE datname = current_database()
           )
         )
       )
     ORDER BY owner_info.rolname,
              default_acl.defaclobjtype,
              namespace_info.nspname,
              acl_info.privilege_type`,
  );
  if (defaultPrivileges.rowCount !== 0) {
    throw new Error('Runtime reader must not receive application privileges through defaults');
  }

  let tls = { source: 'local', version: 'local plaintext', cipher: 'none' };
  if (profile === 'production') {
    tls = runnerVerifiedTls ?? (await inspectProductionTls(client, expectedHost));
  } else if (profile !== 'local-test') {
    throw new Error('database profile must be local-test or production');
  }

  return {
    database: databaseName,
    user: userName,
    postgresMajor,
    connectionLimit: target.rolconnlimit,
    defaultTransactionReadOnly: true,
    topicColumns: [...runtimeReaderTopicColumns],
    tlsVersion: tls.version,
    tlsCipher: tls.cipher,
    tlsEvidence: tls.source,
    neonReservedDatabasesToVerify: approvedNeonReservedDatabases.map((row) => row.name).sort(),
  };
}

export async function inspectRuntimeReaderPreflight(client, options) {
  const result = { ...(await inspectRuntimeReaderTarget(client, options)) };
  delete result.neonReservedDatabasesToVerify;
  return result;
}

async function inspectNeonReservedDatabase(
  client,
  { expectedDatabase, expectedHost, expectedPostgresMajor, expectedUser, profile },
) {
  const contract = neonReservedDatabaseContracts.get(expectedDatabase);
  if (!contract) {
    throw new Error(`Unsupported Neon reserved database: ${expectedDatabase}`);
  }

  const identity = await client.query(
    `SELECT current_database() AS database_name,
            session_user AS authenticated_role,
            current_user AS effective_role,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('default_transaction_read_only') = 'on' AS default_read_only,
            current_setting('transaction_read_only') = 'on' AS read_only,
            pg_is_in_recovery() AS in_recovery,
            pg_get_userbyid(database_info.datdba) AS database_owner,
            database_info.datistemplate AS is_template,
            database_info.datallowconn AS allows_connections,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM pg_db_role_setting AS role_setting
                WHERE role_setting.setrole = role_info.oid
                  AND role_setting.setdatabase = database_info.oid
                  AND EXISTS (
                    SELECT 1
                    FROM unnest(role_setting.setconfig) AS configured_value(value)
                    WHERE configured_value.value LIKE 'default_transaction_read_only=%'
                  )
              )
              THEN EXISTS (
                SELECT 1
                FROM pg_db_role_setting AS role_setting
                WHERE role_setting.setrole = role_info.oid
                  AND role_setting.setdatabase = database_info.oid
                  AND role_setting.setconfig
                    @> ARRAY['default_transaction_read_only=on']::text[]
              )
              ELSE COALESCE(role_info.rolconfig, ARRAY[]::text[])
                @> ARRAY['default_transaction_read_only=on']::text[]
            END AS role_default_read_only,
            has_database_privilege(current_user, database_info.oid, 'CONNECT') AS database_connect,
            has_database_privilege(
              current_user,
              database_info.oid,
              'CONNECT WITH GRANT OPTION'
            ) AS database_connect_grantable,
            has_database_privilege(current_user, database_info.oid, 'CREATE') AS database_create,
            has_database_privilege(current_user, database_info.oid, 'TEMPORARY') AS database_temp
     FROM pg_database AS database_info
     JOIN pg_roles AS role_info ON role_info.rolname = session_user
     WHERE database_info.datname = current_database()`,
  );
  const target = identity.rows[0];
  if (
    !target ||
    target.database_name !== expectedDatabase ||
    target.authenticated_role !== expectedUser ||
    target.effective_role !== expectedUser ||
    target.database_owner !== contract.owner ||
    target.is_template !== contract.isTemplate ||
    target.allows_connections !== true
  ) {
    throw new Error(`Neon reserved database identity mismatch: ${expectedDatabase}`);
  }
  const postgresMajor = Math.floor(target.server_version_num / 10_000);
  if (postgresMajor !== expectedPostgresMajor) {
    throw new Error(`Neon reserved database PostgreSQL major mismatch: ${expectedDatabase}`);
  }
  if (
    !target.default_read_only ||
    !target.read_only ||
    !target.role_default_read_only ||
    target.in_recovery
  ) {
    throw new Error(
      `Neon reserved database is not a protected read-only session: ${expectedDatabase}`,
    );
  }
  if (
    !target.database_connect ||
    target.database_connect_grantable ||
    target.database_create ||
    target.database_temp !== contract.allowsTemporary
  ) {
    throw new Error(`Neon reserved database privileges changed: ${expectedDatabase}`);
  }

  const loginEventTriggers = await client.query(
    `SELECT count(*)::integer AS count
     FROM pg_event_trigger
     WHERE evtevent = 'login'
       AND evtenabled <> 'D'`,
  );
  if (loginEventTriggers.rows[0]?.count !== 0) {
    throw new Error(`Neon reserved database has enabled login triggers: ${expectedDatabase}`);
  }

  // A catalog-level database ACL is not sufficient evidence. Prove inside the
  // reserved database that the Runtime role cannot reach or own any non-system
  // object, even through PUBLIC, defaults, extensions, or grant options.
  const objectAccess = await client.query(
    `WITH runtime_role AS (
       SELECT oid FROM pg_roles WHERE rolname = session_user
     ),
     violations AS (
       SELECT 'schema'::text AS object_type,
              namespace_info.nspname::text AS object_name
       FROM pg_namespace AS namespace_info
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND (
           pg_get_userbyid(namespace_info.nspowner) = session_user
           OR has_schema_privilege(current_user, namespace_info.oid, 'CREATE')
           OR has_schema_privilege(current_user, namespace_info.oid, 'CREATE WITH GRANT OPTION')
           OR has_schema_privilege(current_user, namespace_info.oid, 'USAGE WITH GRANT OPTION')
           OR (
             namespace_info.nspname <> 'public'
             AND has_schema_privilege(current_user, namespace_info.oid, 'USAGE')
           )
         )
       UNION ALL
       SELECT DISTINCT 'relation',
              format('%I.%I', namespace_info.nspname, relation_info.relname)
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
       CROSS JOIN unnest($1::text[]) AS privilege_info(privilege)
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (
           pg_get_userbyid(relation_info.relowner) = session_user
           OR has_table_privilege(current_user, relation_info.oid, privilege_info.privilege)
           OR has_table_privilege(
             current_user,
             relation_info.oid,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'column',
              format(
                '%I.%I.%I',
                namespace_info.nspname,
                relation_info.relname,
                column_info.attname
              )
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
       JOIN pg_attribute AS column_info ON column_info.attrelid = relation_info.oid
       CROSS JOIN unnest($2::text[]) AS privilege_info(privilege)
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
         AND (
           has_column_privilege(
             current_user,
             relation_info.oid,
             column_info.attnum,
             privilege_info.privilege
           )
           OR has_column_privilege(
             current_user,
             relation_info.oid,
             column_info.attnum,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'sequence',
              format('%I.%I', namespace_info.nspname, sequence_info.relname)
       FROM pg_class AS sequence_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = sequence_info.relnamespace
       CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS privilege_info(privilege)
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND sequence_info.relkind = 'S'
         AND (
           pg_get_userbyid(sequence_info.relowner) = session_user
           OR has_sequence_privilege(current_user, sequence_info.oid, privilege_info.privilege)
           OR has_sequence_privilege(
             current_user,
             sequence_info.oid,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'routine',
              format(
                '%I.%I(%s)',
                namespace_info.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid)
              )
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND (
           pg_get_userbyid(routine_info.proowner) = session_user
           OR has_function_privilege(current_user, routine_info.oid, 'EXECUTE')
           OR has_function_privilege(
             current_user,
             routine_info.oid,
             'EXECUTE WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'type',
              format('%I.%I', namespace_info.nspname, type_info.typname)
       FROM pg_type AS type_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND type_info.typtype IN ('b', 'c', 'd', 'e', 'r', 'm')
         AND (
           pg_get_userbyid(type_info.typowner) = session_user
           OR has_type_privilege(current_user, type_info.oid, 'USAGE')
           OR has_type_privilege(current_user, type_info.oid, 'USAGE WITH GRANT OPTION')
         )
       UNION ALL
       SELECT 'large_object', large_object_info.oid::text
       FROM pg_largeobject_metadata AS large_object_info
       WHERE has_largeobject_privilege(current_user, large_object_info.oid, 'SELECT')
          OR has_largeobject_privilege(current_user, large_object_info.oid, 'UPDATE')
       UNION ALL
       SELECT 'foreign_data_wrapper', wrapper_info.fdwname::text
       FROM pg_foreign_data_wrapper AS wrapper_info
       WHERE pg_get_userbyid(wrapper_info.fdwowner) = session_user
          OR has_foreign_data_wrapper_privilege(current_user, wrapper_info.oid, 'USAGE')
          OR has_foreign_data_wrapper_privilege(
            current_user,
            wrapper_info.oid,
            'USAGE WITH GRANT OPTION'
          )
       UNION ALL
       SELECT 'foreign_server', server_info.srvname::text
       FROM pg_foreign_server AS server_info
       WHERE pg_get_userbyid(server_info.srvowner) = session_user
          OR has_server_privilege(current_user, server_info.oid, 'USAGE')
          OR has_server_privilege(current_user, server_info.oid, 'USAGE WITH GRANT OPTION')
       UNION ALL
       SELECT 'extension', extension_info.extname::text
       FROM pg_extension AS extension_info
       WHERE pg_get_userbyid(extension_info.extowner) = session_user
       UNION ALL
       SELECT 'default_acl',
              format('%I:%s', owner_info.rolname, default_acl.defaclobjtype)
       FROM pg_default_acl AS default_acl
       JOIN pg_roles AS owner_info ON owner_info.oid = default_acl.defaclrole
       CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
       WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
     )
     SELECT DISTINCT object_type, object_name
     FROM violations
     ORDER BY object_type, object_name`,
    [tablePrivileges, columnPrivileges],
  );
  if (objectAccess.rowCount !== 0) {
    throw new Error(
      `Runtime reader has non-system object access in Neon reserved database ${expectedDatabase}: ${objectAccess.rows
        .map((row) => `${row.object_type}:${row.object_name}`)
        .join(', ')}`,
    );
  }

  if (profile === 'production') {
    await inspectProductionTls(client, expectedHost);
  } else {
    throw new Error('Neon reserved database verification is production-only');
  }
}

function reservedDatabaseConnectionString(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function runRuntimeReaderPreflight({
  connectionString,
  profile,
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedUser,
  nodeTlsRejectUnauthorized,
  expectedPostgresMajor = 18,
  expectedConnectionLimit = 20,
  connectionTimeoutMillis = 10_000,
  createClient,
} = {}) {
  const policy = validateConnectionTarget({
    connectionString,
    profile,
    expectedHost,
    expectedPort,
    expectedDatabase,
    expectedUser,
    configurationPrefix: 'HZENSE_RUNTIME',
    nodeTlsRejectUnauthorized,
  });
  if (policy.user !== runtimeReaderRoleName) {
    throw new Error(`Runtime reader must authenticate as ${runtimeReaderRoleName}`);
  }
  if (profile === 'production') {
    requireProductionRuntimeConnection(connectionString, policy.host);
  }

  const clientFactory = createClient ?? ((options) => new Client(options));
  const clientOptions = (targetConnectionString, applicationName) => ({
    connectionString: targetConnectionString,
    application_name: applicationName,
    connectionTimeoutMillis,
    query_timeout: 8_000,
    ...(profile === 'production'
      ? {
          enableChannelBinding: true,
        }
      : {}),
  });
  const createCheckedClient = (options) => {
    const checkedClient = clientFactory(options);
    if (
      !checkedClient ||
      typeof checkedClient.connect !== 'function' ||
      typeof checkedClient.end !== 'function'
    ) {
      throw new Error('Runtime reader preflight requires a PostgreSQL client factory');
    }
    return checkedClient;
  };
  const client = createCheckedClient(
    clientOptions(connectionString, 'hzense-runtime-reader-preflight'),
  );

  let targetResult;
  try {
    await client.connect();
    targetResult = await inspectRuntimeReaderTarget(
      client,
      {
        expectedHost: policy.host,
        expectedDatabase: expectedDatabase ?? policy.database,
        expectedUser: expectedUser ?? policy.user,
        expectedPostgresMajor,
        expectedConnectionLimit,
        profile,
      },
      {
        allowNeonReservedDatabases: true,
        allowNeonRuntimeAdminMembership: true,
        allowNeonVectorOwnershipSplit: profile === 'production',
      },
    );
  } finally {
    await client.end().catch(() => undefined);
  }

  const verifiedNeonReservedDatabases = [];
  for (const reservedDatabase of targetResult.neonReservedDatabasesToVerify) {
    const reservedClient = createCheckedClient(
      clientOptions(
        reservedDatabaseConnectionString(connectionString, reservedDatabase),
        'hzense-runtime-reader-reserved-preflight',
      ),
    );
    try {
      await reservedClient.connect();
      await inspectNeonReservedDatabase(reservedClient, {
        expectedDatabase: reservedDatabase,
        expectedHost: policy.host,
        expectedPostgresMajor,
        expectedUser: expectedUser ?? policy.user,
        profile,
      });
      verifiedNeonReservedDatabases.push(reservedDatabase);
    } finally {
      await reservedClient.end().catch(() => undefined);
    }
  }

  const result = { ...targetResult };
  delete result.neonReservedDatabasesToVerify;
  const verifiedResult = { ...result, verifiedNeonReservedDatabases };
  console.log(
    `[db:runtime-reader-preflight] verified PostgreSQL ${result.postgresMajor}, connection limit ${result.connectionLimit}, ${result.topicColumns.length} Topic columns, ${verifiedNeonReservedDatabases.length} Neon reserved databases, ${result.tlsVersion}/${result.tlsCipher} (${result.tlsEvidence} evidence)`,
  );
  return verifiedResult;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  runRuntimeReaderPreflight(runtimeReaderProductionOptions()).catch((error) => {
    console.error(`[db:runtime-reader-preflight] ${runtimeReaderPreflightFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
