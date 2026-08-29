import console from 'node:console';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import process from 'node:process';
import { checkServerIdentity } from 'node:tls';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import pg from 'pg';
import { productionDatabaseOptions, validateConnectionTarget } from './connection-policy.mjs';
import { loadMigrations, planPendingMigrations, verifyMigrationManifest } from './migrate.mjs';
import { expectedTableNames } from './verify.mjs';

const { Client } = pg;
const migrationDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const migrationManifest = fileURLToPath(
  new URL('../../../db/migrations/checksums.json', import.meta.url),
);

export async function inspectProductionTls(client, expectedHost) {
  const reviewedHost = requireString(expectedHost, 'HZENSE_DATABASE_EXPECTED_HOST');
  const clientSsl = client?.ssl;
  const connectionSsl = client?.connectionParameters?.ssl;
  if (
    clientSsl === false ||
    clientSsl?.rejectUnauthorized === false ||
    connectionSsl === false ||
    connectionSsl?.rejectUnauthorized === false
  ) {
    throw new Error('Production database TLS certificate verification is disabled');
  }

  const ssl = await client.query(
    `SELECT ssl, version, cipher
     FROM pg_stat_ssl
     WHERE pid = pg_backend_pid()`,
  );
  const serverTls = ssl.rows[0];
  if (
    ssl.rowCount === 1 &&
    serverTls?.ssl === true &&
    typeof serverTls.version === 'string' &&
    ['TLSv1.2', 'TLSv1.3'].includes(serverTls.version) &&
    typeof serverTls.cipher === 'string' &&
    serverTls.cipher.length > 0
  ) {
    return {
      source: 'postgres',
      version: serverTls.version,
      cipher: serverTls.cipher,
    };
  }

  // Providers such as Neon terminate client TLS at a PostgreSQL-aware proxy.
  // In that topology pg_stat_ssl describes the proxy-to-compute hop, so require
  // an authenticated Node TLS socket before accepting client-side evidence.
  const stream = client?.connection?.stream;
  const version = typeof stream?.getProtocol === 'function' ? stream.getProtocol() : undefined;
  const cipherInfo = typeof stream?.getCipher === 'function' ? stream.getCipher() : undefined;
  const cipher = cipherInfo?.standardName ?? cipherInfo?.name;
  const certificate =
    typeof stream?.getPeerCertificate === 'function' ? stream.getPeerCertificate() : undefined;
  const certificateMatchesHost =
    certificate &&
    Object.keys(certificate).length > 0 &&
    Buffer.isBuffer(certificate.raw) &&
    certificate.raw.length > 0 &&
    checkServerIdentity(reviewedHost, certificate) === undefined;
  if (
    stream?.encrypted === true &&
    stream.authorized === true &&
    !stream.authorizationError &&
    typeof version === 'string' &&
    ['TLSv1.2', 'TLSv1.3'].includes(version) &&
    typeof cipher === 'string' &&
    cipher.length > 0 &&
    certificateMatchesHost
  ) {
    return {
      source: 'client',
      version,
      cipher,
    };
  }

  throw new Error('Production database session is not protected by observable TLS');
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export async function inspectDatabasePreflight(
  client,
  {
    expectedHost,
    expectedDatabase,
    expectedUser,
    expectedPgvectorVersion,
    expectedPostgresMajor = 18,
    profile,
  },
) {
  const databaseName = requireString(expectedDatabase, 'HZENSE_DATABASE_EXPECTED_NAME');
  const userName = requireString(expectedUser, 'HZENSE_DATABASE_EXPECTED_USER');
  const vectorVersion = requireString(
    expectedPgvectorVersion,
    'HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION',
  );
  if (!Number.isSafeInteger(expectedPostgresMajor) || expectedPostgresMajor < 14) {
    throw new Error('HZENSE_DATABASE_EXPECTED_POSTGRES_MAJOR must be a supported integer');
  }

  const identity = await client.query(
    `SELECT current_database() AS database_name,
            session_user AS authenticated_role,
            current_user AS effective_role,
            current_schema() AS schema_name,
            current_setting('server_version_num')::integer AS server_version_num,
            current_setting('transaction_read_only') = 'on' AS read_only,
            pg_is_in_recovery() AS in_recovery,
            has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
            has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
            role_info.rolsuper,
            role_info.rolcreatedb,
            role_info.rolcreaterole,
            role_info.rolreplication,
            role_info.rolbypassrls,
            pg_get_userbyid(database_info.datdba) AS database_owner
     FROM pg_roles AS role_info
     JOIN pg_database AS database_info ON database_info.datname = current_database()
     WHERE role_info.rolname = session_user`,
  );
  const target = identity.rows[0];
  if (!target) throw new Error('Database did not return the authenticated role');
  if (
    target.database_name !== databaseName ||
    target.authenticated_role !== userName ||
    target.effective_role !== userName
  ) {
    throw new Error(
      `Database target mismatch; expected ${databaseName}/${userName}, found ${target.database_name}/${target.authenticated_role}/${target.effective_role}`,
    );
  }
  if (target.schema_name !== 'public') throw new Error('Database current_schema must be public');
  if (Math.floor(target.server_version_num / 10_000) !== expectedPostgresMajor) {
    throw new Error(
      `PostgreSQL major mismatch; expected ${expectedPostgresMajor}, found ${Math.floor(target.server_version_num / 10_000)}`,
    );
  }
  if (target.read_only || target.in_recovery) {
    throw new Error('Database target is read-only or in recovery');
  }
  if (!target.public_usage || !target.public_create) {
    throw new Error('Migration role requires USAGE and CREATE on the public schema');
  }
  if (
    target.rolsuper ||
    target.rolcreatedb ||
    target.rolcreaterole ||
    target.rolreplication ||
    target.rolbypassrls
  ) {
    throw new Error(
      'Migration role must not have superuser, database, role, replication or bypass-RLS powers',
    );
  }
  if (target.database_owner !== userName) {
    throw new Error('Migration role must own the dedicated target database');
  }

  const memberships = await client.query(
    `SELECT count(*)::integer AS count
     FROM pg_auth_members AS membership_info
     JOIN pg_roles AS member_info ON member_info.oid = membership_info.member
     WHERE member_info.rolname = session_user`,
  );
  if (memberships.rows[0]?.count !== 0) {
    throw new Error('Migration role must not inherit or be able to SET ROLE into another role');
  }

  const publicAcl = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_namespace AS namespace_info
       CROSS JOIN LATERAL aclexplode(
         COALESCE(namespace_info.nspacl, acldefault('n', namespace_info.nspowner))
       ) AS acl_info
       WHERE namespace_info.nspname = 'public'
         AND acl_info.grantee = 0
         AND acl_info.privilege_type = 'CREATE'
     ) AS public_can_create`,
  );
  if (publicAcl.rows[0]?.public_can_create === true) {
    throw new Error('PUBLIC must not have CREATE on the production schema');
  }

  const vector = await client.query(
    `SELECT extension_info.default_version,
            extension_info.installed_version,
            has_type_privilege(current_user, to_regtype('public.vector'), 'USAGE') AS can_use
     FROM pg_available_extensions AS extension_info
     WHERE extension_info.name = 'vector'`,
  );
  const installedVector = vector.rows[0];
  if (!installedVector || installedVector.installed_version !== vectorVersion) {
    throw new Error(
      `pgvector ${vectorVersion} must be installed by the provider or database administrator before migration`,
    );
  }
  if (installedVector.can_use !== true) {
    throw new Error('Migration role lacks USAGE on the vector type');
  }

  let tlsVersion = 'local plaintext';
  let tlsCipher = 'none';
  let tlsEvidence = 'local';
  if (profile === 'production') {
    const tls = await inspectProductionTls(client, expectedHost);
    tlsVersion = tls.version;
    tlsCipher = tls.cipher;
    tlsEvidence = tls.source;
  } else if (profile !== 'local-test') {
    throw new Error('database profile must be local-test or production');
  }

  const migrations = await loadMigrations(migrationDirectory);
  await verifyMigrationManifest(migrations, migrationManifest);
  const tables = await client.query(
    `SELECT tablename AS name
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`,
  );
  const tableNames = tables.rows.map((row) => row.name);
  const unexpectedTables = tableNames.filter((name) => !expectedTableNames.has(name));
  if (unexpectedTables.length > 0) {
    throw new Error(
      `Dedicated database contains unexpected public tables: ${unexpectedTables.join(', ')}`,
    );
  }

  const historyPresent = tableNames.includes('hzense_schema_migrations');
  let appliedRows = [];
  if (historyPresent) {
    appliedRows = (
      await client.query('SELECT name, checksum FROM hzense_schema_migrations ORDER BY name')
    ).rows;
  } else if (tableNames.length > 0) {
    throw new Error('Dedicated database contains an untracked HZense schema');
  }
  const pending = planPendingMigrations(migrations, appliedRows);

  console.log(
    `[db:preflight] verified ${databaseName}/${userName}, PostgreSQL ${expectedPostgresMajor}, ${tlsVersion}/${tlsCipher} (${tlsEvidence} evidence), pgvector ${vectorVersion}, ${pending.length} pending migrations`,
  );
  return {
    database: databaseName,
    user: userName,
    postgresMajor: expectedPostgresMajor,
    pgvectorVersion: vectorVersion,
    tlsVersion,
    tlsCipher,
    tlsEvidence,
    pendingMigrations: pending.map((migration) => migration.name),
  };
}

export async function runDatabasePreflight({
  connectionString,
  profile,
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedUser,
  nodeTlsRejectUnauthorized,
  expectedPgvectorVersion,
  expectedPostgresMajor = 18,
  connectionTimeoutMillis = 10_000,
} = {}) {
  const policy = validateConnectionTarget({
    connectionString,
    profile,
    expectedHost,
    expectedPort,
    expectedDatabase,
    expectedUser,
    nodeTlsRejectUnauthorized,
  });
  const client = new Client({
    connectionString,
    application_name: 'hzense-database-preflight',
    connectionTimeoutMillis,
  });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '30s'");
    return await inspectDatabasePreflight(client, {
      expectedHost: policy.host,
      expectedDatabase: expectedDatabase ?? policy.database,
      expectedUser: expectedUser ?? policy.user,
      expectedPgvectorVersion,
      expectedPostgresMajor,
      profile,
    });
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  runDatabasePreflight(productionDatabaseOptions()).catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[db:preflight] ${message}`);
    process.exitCode = 1;
  });
}
