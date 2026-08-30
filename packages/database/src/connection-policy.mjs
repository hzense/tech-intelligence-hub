import process from 'node:process';
import { URL } from 'node:url';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const allowedQueryParameters = new Set([
  'channel_binding',
  'sslcert',
  'sslkey',
  'sslmode',
  'sslrootcert',
]);

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function decoded(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
}

function isUnsafeLocalEndpoint(hostname) {
  let canonicalHost;
  try {
    canonicalHost = new URL(`http://${hostname}`).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    throw new Error('Database connection string host is not a valid network host');
  }
  const unbracketedHost = canonicalHost.replace(/^\[|\]$/g, '');
  if (
    unbracketedHost === 'localhost' ||
    unbracketedHost === '::' ||
    unbracketedHost === '::1' ||
    unbracketedHost.startsWith('::ffff:')
  ) {
    return true;
  }
  const ipv4Octets = unbracketedHost.split('.').map(Number);
  return (
    ipv4Octets.length === 4 &&
    ipv4Octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    (ipv4Octets[0] === 0 || ipv4Octets[0] === 127)
  );
}

export function validateConnectionTarget({
  connectionString,
  profile,
  expectedHost,
  expectedPort,
  expectedDatabase,
  expectedUser,
  configurationPrefix = 'HZENSE_DATABASE',
  nodeTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED,
}) {
  const rawConnectionString = requireString(connectionString, 'database connection string');
  if (rawConnectionString !== connectionString) {
    throw new Error('Database connection string must not contain leading or trailing whitespace');
  }
  if (
    [...rawConnectionString].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error('Database connection string must not contain control characters');
  }
  if (!/^(?:postgres|postgresql):\/\//.test(rawConnectionString)) {
    throw new Error('Database connection string must be an absolute lowercase PostgreSQL URL');
  }
  let url;
  try {
    url = new URL(rawConnectionString);
  } catch {
    throw new Error('Database connection string is not a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Database connection string must use postgres:// or postgresql://');
  }
  if (url.hash) throw new Error('Database connection string must not contain a fragment');
  if (url.hostname.includes('%')) {
    throw new Error('Database connection string host must not use percent encoding');
  }
  const parameterCounts = new Map();
  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.toLowerCase();
    if (!allowedQueryParameters.has(normalizedKey)) {
      throw new Error(`Database connection string query parameter is not allowed: ${key}`);
    }
    parameterCounts.set(normalizedKey, (parameterCounts.get(normalizedKey) ?? 0) + 1);
  }
  for (const [key, count] of parameterCounts) {
    if (count !== 1) {
      throw new Error(`Database connection string query parameter must appear once: ${key}`);
    }
  }

  const database = decoded(url.pathname.replace(/^\//, ''), 'database name');
  const user = decoded(url.username, 'database user');
  if (!database || database.includes('/')) {
    throw new Error('Database connection string must contain exactly one database name');
  }
  if (!user) throw new Error('Database connection string must contain a user');

  if (profile === 'local-test') {
    if (!loopbackHosts.has(url.hostname)) {
      throw new Error('local-test database connections must use a literal loopback host');
    }
    return { database, host: url.hostname, port: url.port || '5432', user };
  }
  if (profile !== 'production') {
    throw new Error('database profile must be local-test or production');
  }
  if (nodeTlsRejectUnauthorized === '0') {
    throw new Error('Production database connections refuse NODE_TLS_REJECT_UNAUTHORIZED=0');
  }

  const prefix = requireString(configurationPrefix, 'database configuration prefix');
  const host = requireString(expectedHost, `${prefix}_EXPECTED_HOST`).toLowerCase();
  const port = requireString(expectedPort, `${prefix}_EXPECTED_PORT`);
  const expectedName = requireString(expectedDatabase, `${prefix}_EXPECTED_NAME`);
  const expectedRole = requireString(expectedUser, `${prefix}_EXPECTED_USER`);
  if (isUnsafeLocalEndpoint(url.hostname)) {
    throw new Error('production database connections cannot use a loopback host');
  }
  if (!url.port) {
    throw new Error('production database connection string must include an explicit port');
  }
  if (url.hostname.toLowerCase() !== host || url.port !== port) {
    throw new Error('Production database endpoint does not match the reviewed direct endpoint');
  }
  if (database !== expectedName || user !== expectedRole) {
    throw new Error('Production database URL identity does not match the reviewed target');
  }
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode !== 'verify-full') {
    throw new Error('Production database URL must set sslmode=verify-full exactly once');
  }

  return { database, host: url.hostname, port: url.port, user };
}

export function productionDatabaseOptions(environment = process.env) {
  return {
    connectionString: environment.DATABASE_DIRECT_URL,
    profile: 'production',
    expectedHost: environment.HZENSE_DATABASE_EXPECTED_HOST,
    expectedPort: environment.HZENSE_DATABASE_EXPECTED_PORT,
    expectedDatabase: environment.HZENSE_DATABASE_EXPECTED_NAME,
    expectedUser: environment.HZENSE_DATABASE_EXPECTED_USER,
    nodeTlsRejectUnauthorized: environment.NODE_TLS_REJECT_UNAUTHORIZED,
    expectedPgvectorVersion: environment.HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION,
    expectedPostgresMajor: Number(environment.HZENSE_DATABASE_EXPECTED_POSTGRES_MAJOR ?? '18'),
  };
}

export function topicSyncProductionOptions(environment = process.env) {
  return {
    connectionString: environment.HZENSE_TOPIC_SYNC_DATABASE_URL,
    profile: 'production',
    expectedHost: environment.HZENSE_TOPIC_SYNC_EXPECTED_HOST,
    expectedPort: environment.HZENSE_TOPIC_SYNC_EXPECTED_PORT,
    expectedDatabase: environment.HZENSE_TOPIC_SYNC_EXPECTED_NAME,
    expectedUser: environment.HZENSE_TOPIC_SYNC_EXPECTED_USER,
    configurationPrefix: 'HZENSE_TOPIC_SYNC',
    nodeTlsRejectUnauthorized: environment.NODE_TLS_REJECT_UNAUTHORIZED,
    expectedPostgresMajor: Number(environment.HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR ?? '18'),
    expectedConnectionLimit: Number(environment.HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT ?? '2'),
  };
}
