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

export async function inspectRuntimeReaderPreflight(
  client,
  {
    expectedHost,
    expectedDatabase,
    expectedUser,
    expectedPostgresMajor = 18,
    expectedConnectionLimit = 20,
    profile,
  },
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
            has_database_privilege(current_user, database_info.oid, 'CONNECT') AS connect_allowed,
            has_database_privilege(current_user, database_info.oid, 'CREATE') AS create_allowed,
            has_database_privilege(
              current_user,
              database_info.oid,
              'TEMPORARY'
            ) AS temporary_allowed
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
  if (accessibleOtherDatabases.length > 0) {
    throw new Error(
      `Runtime reader has privileges on other connectable databases: ${accessibleOtherDatabases
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
    `SELECT count(*)::integer AS count
     FROM pg_auth_members AS membership_info
     JOIN pg_roles AS runtime_info
       ON runtime_info.oid IN (membership_info.member, membership_info.roleid)
     WHERE runtime_info.rolname = session_user`,
  );
  if (memberships.rows[0]?.count !== 0) {
    throw new Error('Runtime reader role must have no incoming or outgoing role memberships');
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

  const unsafeExecutableRoutines = await client.query(
    `SELECT namespace_info.nspname AS schema_name,
            routine_info.proname AS name,
            pg_get_function_identity_arguments(routine_info.oid) AS identity_arguments,
            routine_info.prosecdef AS security_definer,
            extension_info.extname AS extension_name,
            has_function_privilege(
              current_user,
              routine_info.oid,
              'EXECUTE WITH GRANT OPTION'
            ) AS grantable
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
  if (unsafeExecutableRoutines.rowCount !== 0) {
    throw new Error(
      `Runtime reader can execute unsafe non-pgvector application or SECURITY DEFINER routines: ${unsafeExecutableRoutines.rows
        .map((row) => `${row.schema_name}.${row.name}(${row.identity_arguments})`)
        .join(', ')}`,
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
    tls = await inspectProductionTls(client, expectedHost);
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
  };
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
  const client = clientFactory({
    connectionString,
    application_name: 'hzense-runtime-reader-preflight',
    connectionTimeoutMillis,
    query_timeout: 8_000,
    ...(profile === 'production'
      ? {
          enableChannelBinding: true,
        }
      : {}),
  });
  if (!client || typeof client.connect !== 'function' || typeof client.end !== 'function') {
    throw new Error('Runtime reader preflight requires a PostgreSQL client factory');
  }

  try {
    await client.connect();
    const result = await inspectRuntimeReaderPreflight(client, {
      expectedHost: policy.host,
      expectedDatabase: expectedDatabase ?? policy.database,
      expectedUser: expectedUser ?? policy.user,
      expectedPostgresMajor,
      expectedConnectionLimit,
      profile,
    });
    console.log(
      `[db:runtime-reader-preflight] verified PostgreSQL ${result.postgresMajor}, connection limit ${result.connectionLimit}, ${result.topicColumns.length} Topic columns, ${result.tlsVersion}/${result.tlsCipher} (${result.tlsEvidence} evidence)`,
    );
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  runRuntimeReaderPreflight(runtimeReaderProductionOptions()).catch((error) => {
    console.error(`[db:runtime-reader-preflight] ${runtimeReaderPreflightFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
