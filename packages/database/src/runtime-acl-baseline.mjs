import console from 'node:console';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { requireProtectedBackupIdentifier } from './backup-declaration.mjs';
import { productionDatabaseOptions, validateConnectionTarget } from './connection-policy.mjs';
import { inspectProductionTls } from './preflight.mjs';

const { Client } = pg;
const pooledHostPattern = /(^|[.-])pooler([.-]|$)/;
const neonHostSuffix = '.neon.tech';

export const runtimeAclBaselineFormat = 'hzense-runtime-acl-recovery-baseline/v1';
export const runtimeAclBaselineRole = 'hzense_runtime';
export const runtimeAclBackupReferenceDomain = 'hzense-runtime-acl-backup-reference/v1';

const catalogQueries = Object.freeze({
  runtimeRole: `/* runtime-acl-baseline:runtime-role */
    SELECT role_info.rolname AS "roleName",
           role_info.rolcanlogin AS "canLogin",
           role_info.rolinherit AS "inheritsPrivileges",
           role_info.rolconnlimit AS "connectionLimit",
           role_info.rolsuper AS "isSuperuser",
           role_info.rolcreatedb AS "canCreateDatabase",
           role_info.rolcreaterole AS "canCreateRole",
           role_info.rolreplication AS "canReplicate",
           role_info.rolbypassrls AS "canBypassRls",
           EXISTS (
             SELECT 1
             FROM unnest(COALESCE(role_info.rolconfig, ARRAY[]::text[]))
               AS configured_value(value)
             WHERE configured_value.value = 'default_transaction_read_only=on'
           ) AS "roleDefaultReadOnly",
           (
             SELECT split_part(configured_value.value, '=', 2)
             FROM pg_db_role_setting AS role_setting
             CROSS JOIN LATERAL unnest(role_setting.setconfig)
               AS configured_value(value)
             WHERE role_setting.setrole = role_info.oid
               AND role_setting.setdatabase = database_info.oid
               AND configured_value.value LIKE 'default_transaction_read_only=%'
             ORDER BY configured_value.value COLLATE "C"
             LIMIT 1
           ) AS "databaseDefaultReadOnly"
    FROM pg_roles AS role_info
    CROSS JOIN pg_database AS database_info
    WHERE role_info.rolname = $1
      AND database_info.datname = current_database()`,
  memberships: `/* runtime-acl-baseline:memberships */
    SELECT pg_get_userbyid(membership_info.member) AS "member",
           pg_get_userbyid(membership_info.roleid) AS "grantedRole",
           pg_get_userbyid(membership_info.grantor) AS "grantor",
           membership_info.admin_option AS "adminOption",
           membership_info.inherit_option AS "inheritOption",
           membership_info.set_option AS "setOption"
    FROM pg_auth_members AS membership_info
    JOIN pg_roles AS runtime_role
      ON runtime_role.rolname = $1
    WHERE membership_info.member = runtime_role.oid
       OR membership_info.roleid = runtime_role.oid`,
  roleMemberships: `/* runtime-acl-baseline:role-memberships */
    SELECT pg_get_userbyid(membership_info.member) AS "member",
           pg_get_userbyid(membership_info.roleid) AS "grantedRole",
           pg_get_userbyid(membership_info.grantor) AS "grantor",
           membership_info.admin_option AS "adminOption",
           membership_info.inherit_option AS "inheritOption",
           membership_info.set_option AS "setOption"
    FROM pg_auth_members AS membership_info`,
  databases: `/* runtime-acl-baseline:databases */
    SELECT database_info.datname AS "database",
           pg_get_userbyid(database_info.datdba) AS "owner",
           database_info.datistemplate AS "isTemplate",
           database_info.datallowconn AS "allowsConnections",
           database_info.datconnlimit AS "connectionLimit",
           CASE WHEN database_info.datacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_database AS database_info
    LEFT JOIN LATERAL aclexplode(
      COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
    ) AS acl_info ON true`,
  databaseAccess: `/* runtime-acl-baseline:database-access */
    SELECT role_info.rolname AS "role",
           role_info.rolinherit AS "inheritsPrivileges",
           role_info.rolsuper AS "isSuperuser",
           database_info.datname AS "database",
           pg_get_userbyid(database_info.datdba) AS "databaseOwner",
           has_database_privilege(role_info.rolname, database_info.oid, 'CONNECT')
             AS "connect",
           has_database_privilege(
             role_info.rolname,
             database_info.oid,
             'CONNECT WITH GRANT OPTION'
           ) AS "connectGrantable",
           has_database_privilege(role_info.rolname, database_info.oid, 'CREATE')
             AS "create",
           has_database_privilege(
             role_info.rolname,
             database_info.oid,
             'CREATE WITH GRANT OPTION'
           ) AS "createGrantable",
           has_database_privilege(role_info.rolname, database_info.oid, 'TEMPORARY')
             AS "temporary",
           has_database_privilege(
             role_info.rolname,
             database_info.oid,
             'TEMPORARY WITH GRANT OPTION'
           ) AS "temporaryGrantable"
    FROM pg_roles AS role_info
    CROSS JOIN pg_database AS database_info
    WHERE role_info.rolcanlogin
      AND database_info.datallowconn`,
  schemas: `/* runtime-acl-baseline:schemas */
    SELECT namespace_info.nspname AS "schema",
           pg_get_userbyid(namespace_info.nspowner) AS "owner",
           CASE WHEN namespace_info.nspacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_namespace AS namespace_info
    LEFT JOIN LATERAL aclexplode(
      COALESCE(namespace_info.nspacl, acldefault('n', namespace_info.nspowner))
    ) AS acl_info ON true
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'`,
  relations: `/* runtime-acl-baseline:relations */
    SELECT namespace_info.nspname AS "schema",
           relation_info.relname AS "relation",
           relation_info.relkind AS "relationKind",
           relation_info.relpersistence AS "persistence",
           pg_get_userbyid(relation_info.relowner) AS "owner",
           CASE WHEN relation_info.relacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_class AS relation_info
    JOIN pg_namespace AS namespace_info
      ON namespace_info.oid = relation_info.relnamespace
    LEFT JOIN LATERAL aclexplode(
      COALESCE(
        relation_info.relacl,
        acldefault(
          (CASE WHEN relation_info.relkind = 'S' THEN 's' ELSE 'r' END)::"char",
          relation_info.relowner
        )
      )
    ) AS acl_info ON true
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')`,
  columns: `/* runtime-acl-baseline:columns */
    SELECT namespace_info.nspname AS "schema",
           relation_info.relname AS "relation",
           column_info.attname AS "column",
           column_info.attnum AS "position",
           CASE WHEN column_info.attacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_class AS relation_info
    JOIN pg_namespace AS namespace_info
      ON namespace_info.oid = relation_info.relnamespace
    JOIN pg_attribute AS column_info
      ON column_info.attrelid = relation_info.oid
    LEFT JOIN LATERAL aclexplode(column_info.attacl) AS acl_info ON true
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND column_info.attnum > 0
      AND NOT column_info.attisdropped`,
  enumTypes: `/* runtime-acl-baseline:enum-types */
    SELECT namespace_info.nspname AS "schema",
           type_info.typname AS "type",
           pg_get_userbyid(type_info.typowner) AS "owner",
           CASE WHEN type_info.typacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_type AS type_info
    JOIN pg_namespace AS namespace_info
      ON namespace_info.oid = type_info.typnamespace
    LEFT JOIN LATERAL aclexplode(
      COALESCE(type_info.typacl, acldefault('T', type_info.typowner))
    ) AS acl_info ON true
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
      AND type_info.typtype = 'e'`,
  routines: `/* runtime-acl-baseline:routines */
    SELECT namespace_info.nspname AS "schema",
           routine_info.proname AS "routine",
           pg_get_function_identity_arguments(routine_info.oid) AS "identityArguments",
           routine_info.prokind AS "routineKind",
           routine_info.prosecdef AS "securityDefiner",
           pg_get_userbyid(routine_info.proowner) AS "owner",
           extension_info.extname AS "extension",
           CASE WHEN routine_info.proacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_proc AS routine_info
    JOIN pg_namespace AS namespace_info
      ON namespace_info.oid = routine_info.pronamespace
    LEFT JOIN pg_depend AS extension_dependency
      ON extension_dependency.classid = 'pg_proc'::regclass
     AND extension_dependency.objid = routine_info.oid
     AND extension_dependency.deptype = 'e'
    LEFT JOIN pg_extension AS extension_info
      ON extension_info.oid = extension_dependency.refobjid
    LEFT JOIN LATERAL aclexplode(
      COALESCE(routine_info.proacl, acldefault('f', routine_info.proowner))
    ) AS acl_info ON true
    WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
      AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'`,
  defaultPrivileges: `/* runtime-acl-baseline:default-privileges */
    SELECT pg_get_userbyid(default_acl.defaclrole) AS "owner",
           namespace_info.nspname AS "schema",
           CASE default_acl.defaclobjtype
             WHEN 'r' THEN 'relation'
             WHEN 'S' THEN 'sequence'
             WHEN 'f' THEN 'function'
             WHEN 'T' THEN 'type'
             WHEN 'n' THEN 'schema'
             ELSE default_acl.defaclobjtype::text
           END AS "objectType",
           CASE WHEN default_acl.defaclacl IS NULL THEN 'default' ELSE 'explicit' END
             AS "aclState",
           CASE
             WHEN acl_info.grantee = 0 THEN 'PUBLIC'
             ELSE pg_get_userbyid(acl_info.grantee)
           END AS "grantee",
           pg_get_userbyid(acl_info.grantor) AS "grantor",
           acl_info.privilege_type AS "privilege",
           acl_info.is_grantable AS "grantable"
    FROM pg_default_acl AS default_acl
    LEFT JOIN pg_namespace AS namespace_info
      ON namespace_info.oid = default_acl.defaclnamespace
    LEFT JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info ON true`,
});

export const runtimeAclBaselineCategoryNames = Object.freeze(Object.keys(catalogQueries).sort());

const sensitiveFieldName = /(connectionstring|credential|password|secret|token|host|port|url)/i;
const databaseUrlPattern = /postgres(?:ql)?:\/\//i;

function canonicalize(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Runtime ACL baseline contains a non-JSON catalog value');
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function runtimeAclBackupReference(backupId) {
  const identifier = requireProtectedBackupIdentifier(backupId, {
    environmentName: 'HZENSE_RUNTIME_ACL_BACKUP_ID',
    purpose: 'the new recoverable pre-normalization backup',
  });
  return createHash('sha256')
    .update(runtimeAclBackupReferenceDomain)
    .update('\0')
    .update(identifier)
    .digest('hex');
}

function assertNoCredentialMaterial(value, path = 'snapshot') {
  if (typeof value === 'string') {
    if (databaseUrlPattern.test(value)) {
      throw new Error(`Runtime ACL baseline rejects database URLs at ${path}`);
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCredentialMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Runtime ACL baseline contains a non-JSON catalog value');
  }
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveFieldName.test(key)) {
      throw new Error(`Runtime ACL baseline rejects sensitive field ${path}.${key}`);
    }
    assertNoCredentialMaterial(entry, `${path}.${key}`);
  }
}

function normalizedRows(rows, category) {
  if (!Array.isArray(rows)) {
    throw new Error(`Runtime ACL baseline category is not an array: ${category}`);
  }
  const normalized = rows.map((row) => canonicalize(row));
  normalized.forEach((row, index) =>
    assertNoCredentialMaterial(row, `categories.${category}[${index}]`),
  );
  return normalized.sort((left, right) => {
    const leftJson = canonicalJson(left);
    const rightJson = canonicalJson(right);
    if (leftJson < rightJson) return -1;
    if (leftJson > rightJson) return 1;
    return 0;
  });
}

export function buildRuntimeAclBaseline({ identity, categories, capturedAt, backupReference }) {
  if (!identity || typeof identity !== 'object') {
    throw new Error('Runtime ACL baseline identity is required');
  }
  if (!categories || typeof categories !== 'object') {
    throw new Error('Runtime ACL baseline categories are required');
  }
  if (typeof backupReference !== 'string' || !/^[a-f0-9]{64}$/.test(backupReference)) {
    throw new Error('Runtime ACL baseline backup reference must be a lowercase SHA-256 digest');
  }
  const expectedCategories = runtimeAclBaselineCategoryNames;
  const actualCategories = Object.keys(categories).sort();
  if (canonicalJson(actualCategories) !== canonicalJson(expectedCategories)) {
    throw new Error('Runtime ACL baseline categories are incomplete or unexpected');
  }

  const normalizedIdentity = canonicalize(identity);
  assertNoCredentialMaterial(normalizedIdentity, 'identity');
  const normalizedCategories = Object.fromEntries(
    expectedCategories.map((category) => {
      const records = normalizedRows(categories[category], category);
      return [
        category,
        {
          rowCount: records.length,
          fingerprint: fingerprint(records),
          records,
        },
      ];
    }),
  );
  const contract = {
    format: runtimeAclBaselineFormat,
    mode: 'catalog-only-read-only',
    restoration: 'manual-review-required',
    executableSqlIncluded: false,
    backup: {
      referenceAlgorithm: 'sha256',
      referenceDomain: runtimeAclBackupReferenceDomain,
      reference: backupReference,
      provenance: 'operator-declared-provider-backup',
      providerApiVerified: false,
    },
    identity: normalizedIdentity,
    categories: normalizedCategories,
  };
  const timestamp =
    capturedAt instanceof Date && !Number.isNaN(capturedAt.getTime())
      ? capturedAt.toISOString()
      : capturedAt;
  if (
    typeof timestamp !== 'string' ||
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  ) {
    throw new Error('Runtime ACL baseline capturedAt must be an ISO timestamp');
  }

  return {
    ...contract,
    capturedAt: timestamp,
    fingerprint: fingerprint(contract),
  };
}

const identityQuery = `/* runtime-acl-baseline:identity */
      SELECT current_database() AS "database",
             pg_get_userbyid(database_info.datdba) AS "databaseOwner",
             session_user AS "sessionUser",
             current_user AS "currentUser",
             current_setting('server_version_num')::integer AS "serverVersionNumber",
             current_setting('transaction_read_only') = 'on' AS "transactionReadOnly",
             current_setting('transaction_isolation') AS "transactionIsolation"
      FROM pg_database AS database_info
      WHERE database_info.datname = current_database()`;

export async function inspectRuntimeAclBaseline(
  client,
  {
    expectedDatabase,
    expectedUser,
    expectedPostgresMajor = 18,
    capturedAt = new Date(),
    backupReference,
  } = {},
) {
  const identityResult = await client.query(identityQuery);
  const identity = identityResult.rows[0];
  if (identityResult.rowCount !== 1 || !identity) {
    throw new Error('Runtime ACL baseline could not identify the current database session');
  }
  if (identity.database !== expectedDatabase || identity.currentUser !== expectedUser) {
    throw new Error('Runtime ACL baseline session does not match the reviewed database identity');
  }
  if (identity.sessionUser !== identity.currentUser) {
    throw new Error('Runtime ACL baseline refuses sessions that used SET ROLE');
  }
  if (identity.databaseOwner !== identity.currentUser) {
    throw new Error('Runtime ACL baseline must authenticate as the target database owner');
  }
  if (identity.currentUser === runtimeAclBaselineRole) {
    throw new Error(`Runtime ACL baseline must not authenticate as ${runtimeAclBaselineRole}`);
  }
  if (Math.floor(identity.serverVersionNumber / 10_000) !== expectedPostgresMajor) {
    throw new Error(
      'Runtime ACL baseline PostgreSQL major version does not match the reviewed value',
    );
  }
  if (
    identity.transactionReadOnly !== true ||
    identity.transactionIsolation !== 'repeatable read'
  ) {
    throw new Error('Runtime ACL baseline requires a repeatable-read, read-only transaction');
  }

  const categories = {};
  for (const [category, query] of Object.entries(catalogQueries)) {
    const result = query.includes('$1')
      ? await client.query(query, [runtimeAclBaselineRole])
      : await client.query(query);
    categories[category] = result.rows;
  }
  if (categories.runtimeRole.length !== 1) {
    throw new Error(`Runtime ACL baseline requires exactly one ${runtimeAclBaselineRole} role`);
  }

  return buildRuntimeAclBaseline({ identity, categories, capturedAt, backupReference });
}

export function runtimeAclBaselineProductionOptions(environment = process.env) {
  return {
    ...productionDatabaseOptions(environment),
    backupId: requireProtectedBackupIdentifier(environment.HZENSE_RUNTIME_ACL_BACKUP_ID, {
      environmentName: 'HZENSE_RUNTIME_ACL_BACKUP_ID',
      purpose: 'the new recoverable pre-normalization backup',
    }),
  };
}

export function runtimeAclBaselineFailureMessage(error) {
  const sqlstate =
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : undefined;
  return sqlstate ? `unavailable; sqlstate=${sqlstate}` : 'unavailable';
}

export async function runRuntimeAclBaselineCapture({
  connectionString,
  profile,
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedUser,
  nodeTlsRejectUnauthorized,
  expectedPostgresMajor = 18,
  backupId,
  connectionTimeoutMillis = 10_000,
  capturedAt = new Date(),
  createClient,
} = {}) {
  const backupReference = runtimeAclBackupReference(backupId);
  const policy = validateConnectionTarget({
    connectionString,
    profile,
    expectedHost,
    expectedPort,
    expectedDatabase,
    expectedUser,
    configurationPrefix: 'HZENSE_DATABASE',
    nodeTlsRejectUnauthorized,
  });
  if (policy.user === runtimeAclBaselineRole) {
    throw new Error(
      `Runtime ACL baseline must authenticate as the database owner, not ${policy.user}`,
    );
  }
  if (
    profile === 'production' &&
    (pooledHostPattern.test(policy.host) || !policy.host.endsWith(neonHostSuffix))
  ) {
    throw new Error(
      'Runtime ACL baseline production capture requires an approved Neon direct endpoint',
    );
  }

  const clientFactory = createClient ?? ((options) => new Client(options));
  const client = clientFactory({
    connectionString,
    application_name: 'hzense-runtime-acl-baseline',
    connectionTimeoutMillis,
    query_timeout: 35_000,
    ...(profile === 'production' ? { enableChannelBinding: true } : {}),
  });
  if (
    !client ||
    typeof client.connect !== 'function' ||
    typeof client.query !== 'function' ||
    typeof client.end !== 'function'
  ) {
    throw new Error('Runtime ACL baseline requires a PostgreSQL client factory');
  }

  let transactionStarted = false;
  let baselineResult;
  let operationError;
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '45s'");
    const transport =
      profile === 'production'
        ? await inspectProductionTls(client, policy.host)
        : { source: 'local-test', version: null, cipher: null };
    const baseline = await inspectRuntimeAclBaseline(client, {
      expectedDatabase: expectedDatabase ?? policy.database,
      expectedUser: expectedUser ?? policy.user,
      expectedPostgresMajor,
      capturedAt,
      backupReference,
    });
    baselineResult = {
      ...baseline,
      transport: {
        profile,
        tlsEvidence: transport.source,
        tlsVersion: transport.version,
        tlsCipher: transport.cipher,
      },
    };
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  if (transactionStarted) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    await client.end();
  } catch (error) {
    cleanupError ??= error;
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return baselineResult;
}

export function assertRuntimeAclBaselineCliArguments(arguments_) {
  if (arguments_.length !== 0) {
    throw new Error(
      'Runtime ACL baseline accepts configuration only through protected environment values',
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  Promise.resolve()
    .then(() => assertRuntimeAclBaselineCliArguments(process.argv.slice(2)))
    .then(() => runRuntimeAclBaselineCapture(runtimeAclBaselineProductionOptions()))
    .then((baseline) => console.log(JSON.stringify(baseline, null, 2)))
    .catch((error) => {
      console.error(`[db:runtime-acl-baseline] ${runtimeAclBaselineFailureMessage(error)}`);
      process.exitCode = 1;
    });
}
