const runtimeRole = 'hzense_runtime';
const pooledHostPattern = /(^|[.-])pooler([.-]|$)/;
const neonHostSuffix = '.neon.tech';
const allowedConnectionParameters = new Set(['channel_binding', 'sslmode']);

export const runtimeTopicLimitMinimum = 1;
export const runtimeTopicLimitMaximum = 50;
export const runtimeHealthDurationLimitMs = 5_000;

export const runtimeTopicQuery = `SELECT id,
       title,
       parent_id AS "parentId",
       status::text AS status,
       runtime_enabled AS "runtimeEnabled"
FROM ONLY public.topics
WHERE runtime_enabled IS TRUE
ORDER BY id
LIMIT $1::integer`;

export type RuntimeReaderErrorCode =
  | 'connection_capacity'
  | 'empty_projection'
  | 'health_duration_exceeded'
  | 'invalid_configuration'
  | 'invalid_limit'
  | 'invalid_result'
  | 'missing_configuration'
  | 'not_production'
  | 'pooled_endpoint_required'
  | 'query_cancelled'
  | 'query_failed'
  | 'runtime_role_required'
  | 'target_mismatch'
  | 'tls_required';

export class RuntimeReaderError extends Error {
  readonly code: RuntimeReaderErrorCode;

  constructor(code: RuntimeReaderErrorCode) {
    super('Runtime reader is unavailable');
    this.name = 'RuntimeReaderError';
    this.code = code;
  }
}

export type RuntimeReaderEnvironment = Readonly<Record<string, string | undefined>>;

export interface RuntimeReaderConfig {
  connectionString: string;
  database: string;
  host: string;
  port: number;
  user: typeof runtimeRole;
}

export interface RuntimeReaderPoolOptions {
  allowExitOnIdle: true;
  application_name: 'hzense-web-runtime';
  connectionString: string;
  connectionTimeoutMillis: 3_500;
  enableChannelBinding: true;
  idleTimeoutMillis: 10_000;
  max: 1;
  query_timeout: 3_000;
}

export interface RuntimeReaderPool {
  readonly idleCount: number;
  readonly totalCount: number;
  readonly waitingCount: number;
  query(query: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface RuntimeTopic {
  id: string;
  parentId: string | null;
  runtimeEnabled: true;
  status: string;
  title: string;
}

export interface RuntimeReaderPoolStats {
  idle: number;
  total: number;
  waiting: number;
}

export interface RuntimeTopicReader {
  hasPool(): boolean;
  poolStats(): RuntimeReaderPoolStats;
  readTopics(limit?: number): Promise<RuntimeTopic[]>;
}

export interface RuntimeReaderHealthLog {
  duration_ms: number;
  error_code?: RuntimeReaderErrorCode;
  event: 'runtime_reader_health';
  outcome: 'ok' | 'unavailable';
  pool_idle: number;
  pool_total: number;
  pool_waiting: number;
  request_id?: string;
  sqlstate?: string;
}

function fail(code: RuntimeReaderErrorCode): never {
  throw new RuntimeReaderError(code);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function requiredConfigurationValue(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    hasControlCharacters(value)
  ) {
    fail('missing_configuration');
  }
  return value;
}

function decodeUrlComponent(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.length === 0 || hasControlCharacters(decoded)) {
      fail('invalid_configuration');
    }
    return decoded;
  } catch (error) {
    if (error instanceof RuntimeReaderError) throw error;
    fail('invalid_configuration');
  }
}

function parseExpectedPort(value: string): number {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) fail('invalid_configuration');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535 || String(port) !== value) {
    fail('invalid_configuration');
  }
  return port;
}

function parseConnectionString(connectionString: string): URL {
  if (!/^(?:postgres|postgresql):\/\//.test(connectionString)) {
    fail('invalid_configuration');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    fail('invalid_configuration');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) {
    fail('invalid_configuration');
  }
  if (!url.port) fail('target_mismatch');
  if (!url.password) fail('missing_configuration');
  decodeUrlComponent(url.password);

  const parameterCounts = new Map<string, number>();
  for (const [key, value] of url.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (key !== normalizedKey || !allowedConnectionParameters.has(normalizedKey)) {
      fail('invalid_configuration');
    }
    parameterCounts.set(normalizedKey, (parameterCounts.get(normalizedKey) ?? 0) + 1);
    if (normalizedKey === 'sslmode' && value !== 'verify-full') fail('tls_required');
    if (normalizedKey === 'channel_binding' && value !== 'prefer') fail('tls_required');
  }
  if ([...parameterCounts.values()].some((count) => count !== 1)) {
    fail('invalid_configuration');
  }
  if (url.searchParams.get('sslmode') !== 'verify-full') fail('tls_required');
  if (url.searchParams.get('channel_binding') !== 'prefer') fail('tls_required');

  return url;
}

export function readRuntimeReaderConfig(
  environment: RuntimeReaderEnvironment,
): RuntimeReaderConfig {
  if (environment.VERCEL_ENV !== 'production') fail('not_production');
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('tls_required');

  const connectionString = requiredConfigurationValue(environment.HZENSE_RUNTIME_DATABASE_URL);
  const expectedHost = requiredConfigurationValue(
    environment.HZENSE_RUNTIME_EXPECTED_HOST,
  ).toLowerCase();
  const expectedPortValue = requiredConfigurationValue(environment.HZENSE_RUNTIME_EXPECTED_PORT);
  const expectedDatabase = requiredConfigurationValue(environment.HZENSE_RUNTIME_EXPECTED_NAME);
  const expectedUser = requiredConfigurationValue(environment.HZENSE_RUNTIME_EXPECTED_USER);

  if (!/^[a-z0-9.-]+$/.test(expectedHost) || expectedHost.startsWith('.')) {
    fail('invalid_configuration');
  }
  if (expectedHost.endsWith('.') || expectedDatabase.includes('/')) {
    fail('invalid_configuration');
  }
  if (expectedUser !== runtimeRole) fail('runtime_role_required');

  const expectedPort = parseExpectedPort(expectedPortValue);
  const url = parseConnectionString(connectionString);
  if (url.hostname.includes('%')) fail('invalid_configuration');

  const host = url.hostname.toLowerCase();
  if (!pooledHostPattern.test(host) || !host.endsWith(neonHostSuffix)) {
    fail('pooled_endpoint_required');
  }

  const database = decodeUrlComponent(url.pathname.replace(/^\//, ''));
  const user = decodeUrlComponent(url.username);
  if (database.includes('/')) fail('invalid_configuration');
  if (
    host !== expectedHost ||
    url.port !== expectedPortValue ||
    database !== expectedDatabase ||
    user !== expectedUser
  ) {
    fail('target_mismatch');
  }

  return {
    connectionString,
    database,
    host,
    port: expectedPort,
    user: runtimeRole,
  };
}

export function runtimeReaderPoolOptions(config: RuntimeReaderConfig): RuntimeReaderPoolOptions {
  return {
    allowExitOnIdle: true,
    application_name: 'hzense-web-runtime',
    connectionString: config.connectionString,
    connectionTimeoutMillis: 3_500,
    enableChannelBinding: true,
    idleTimeoutMillis: 10_000,
    max: 1,
    query_timeout: 3_000,
  };
}

export function runtimeTopicLimit(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < runtimeTopicLimitMinimum ||
    value > runtimeTopicLimitMaximum
  ) {
    fail('invalid_limit');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runtimeTopicRows(rows: unknown[]): RuntimeTopic[] {
  return rows.map((row) => {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      row.id.length === 0 ||
      typeof row.title !== 'string' ||
      row.title.length === 0 ||
      (row.parentId !== null && typeof row.parentId !== 'string') ||
      typeof row.status !== 'string' ||
      row.status.length === 0 ||
      row.runtimeEnabled !== true
    ) {
      fail('invalid_result');
    }
    return {
      id: row.id,
      parentId: row.parentId,
      runtimeEnabled: true,
      status: row.status,
      title: row.title,
    };
  });
}

function safePoolCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function poolStats(pool: RuntimeReaderPool | undefined): RuntimeReaderPoolStats {
  if (!pool) return { idle: 0, total: 0, waiting: 0 };
  return {
    idle: safePoolCount(pool.idleCount),
    total: safePoolCount(pool.totalCount),
    waiting: safePoolCount(pool.waitingCount),
  };
}

export function createLazyRuntimeTopicReader({
  createPool,
  environment,
}: {
  createPool: (options: RuntimeReaderPoolOptions) => RuntimeReaderPool;
  environment: () => RuntimeReaderEnvironment;
}): RuntimeTopicReader {
  let pool: RuntimeReaderPool | undefined;

  function getPool(): RuntimeReaderPool {
    pool ??= createPool(runtimeReaderPoolOptions(readRuntimeReaderConfig(environment())));
    return pool;
  }

  return {
    hasPool: () => pool !== undefined,
    poolStats: () => poolStats(pool),
    async readTopics(limit = 1) {
      const boundedLimit = runtimeTopicLimit(limit);
      const result = await getPool().query(runtimeTopicQuery, [boundedLimit]);
      if (!result || !Array.isArray(result.rows)) fail('invalid_result');
      return runtimeTopicRows(result.rows);
    },
  };
}

export function extractPostgresSqlState(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function classifyRuntimeReaderError(error: unknown): RuntimeReaderErrorCode {
  if (error instanceof RuntimeReaderError) return error.code;
  switch (extractPostgresSqlState(error)) {
    case '53300':
      return 'connection_capacity';
    case '57014':
      return 'query_cancelled';
    default:
      return 'query_failed';
  }
}

function safeRequestId(request: Pick<Request, 'headers'> | undefined): string | undefined {
  const value = request?.headers.get('x-vercel-id');
  return value && value.length <= 128 && /^[A-Za-z0-9:_.-]+$/.test(value) ? value : undefined;
}

function elapsedMilliseconds(start: number, end: number): number {
  const elapsed = end - start;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed) : 0;
}

function healthResponse(status: 'ok' | 'unavailable'): Response {
  return new Response(JSON.stringify({ status }), {
    status: status === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...(status === 'unavailable' ? { 'Retry-After': '5' } : {}),
    },
  });
}

export function createRuntimeReaderHealthHandler({
  clock = Date.now,
  log,
  poolStats: readPoolStats,
  readTopics,
}: {
  clock?: () => number;
  log: (record: RuntimeReaderHealthLog) => void;
  poolStats: () => RuntimeReaderPoolStats;
  readTopics: (limit: number) => Promise<RuntimeTopic[]>;
}): (request?: Pick<Request, 'headers'>) => Promise<Response> {
  return async (request) => {
    const startedAt = clock();
    let errorCode: RuntimeReaderErrorCode | undefined;
    let sqlstate: string | undefined;
    let outcome: RuntimeReaderHealthLog['outcome'] = 'ok';

    try {
      const topics = await readTopics(1);
      if (topics.length === 0) fail('empty_projection');
    } catch (error) {
      outcome = 'unavailable';
      errorCode = classifyRuntimeReaderError(error);
      sqlstate = extractPostgresSqlState(error);
    }

    let stats: RuntimeReaderPoolStats = { idle: 0, total: 0, waiting: 0 };
    try {
      stats = readPoolStats();
    } catch {
      // Health reporting must never replace the database outcome with an instrumentation error.
    }

    const duration = elapsedMilliseconds(startedAt, clock());
    if (outcome === 'ok' && duration >= runtimeHealthDurationLimitMs) {
      outcome = 'unavailable';
      errorCode = 'health_duration_exceeded';
    }

    const requestId = safeRequestId(request);
    const record: RuntimeReaderHealthLog = {
      duration_ms: duration,
      event: 'runtime_reader_health',
      outcome,
      pool_idle: stats.idle,
      pool_total: stats.total,
      pool_waiting: stats.waiting,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(requestId ? { request_id: requestId } : {}),
      ...(sqlstate ? { sqlstate } : {}),
    };
    try {
      log(record);
    } catch {
      // Logging is best-effort and must not change the credential-safe HTTP contract.
    }

    return healthResponse(outcome === 'ok' ? 'ok' : 'unavailable');
  };
}
