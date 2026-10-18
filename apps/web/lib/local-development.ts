import process from 'node:process';

export type LocalDevelopmentEnvironment = Readonly<Record<string, string | undefined>>;

export const localDatabaseEnvironmentRoles: Readonly<Record<string, string>> = Object.freeze({
  HZENSE_RUNTIME_DATABASE_URL: 'hzense_runtime',
  HZENSE_EDITORIAL_DATABASE_URL: 'hzense_editorial_writer',
  HZENSE_EDITORIAL_READER_DATABASE_URL: 'hzense_editorial_reader',
  HZENSE_AI_DATABASE_URL: 'hzense_ai_admin',
  HZENSE_IMPORT_DATABASE_URL: 'hzense_import_admin',
  HZENSE_GENERATION_DATABASE_URL: 'hzense_generation_admin',
  HZENSE_REVIEW_DATABASE_URL: 'hzense_candidate_reviewer',
  HZENSE_SIGNAL_ADMIN_DATABASE_URL: 'hzense_signal_admin_reader',
});

export class LocalDevelopmentError extends Error {
  readonly code = 'local_development_unavailable';
  constructor() {
    super('local_development_unavailable');
  }
}

function localDatabaseTarget(value: string | undefined, role: string): boolean {
  try {
    if (
      !value ||
      value !== value.trim() ||
      /\s/u.test(value) ||
      [...value].some(
        (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
      )
    )
      return false;
    const url = new URL(value);
    return (
      url.protocol === 'postgresql:' &&
      url.hostname === '127.0.0.1' &&
      url.port === '55432' &&
      url.pathname === '/hzense_local' &&
      url.username === role &&
      /^[a-f0-9]{64}$/.test(url.password) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Local development is an independent contract, never a production bypass. */
export function isLocalDevelopment(env: LocalDevelopmentEnvironment = process.env): boolean {
  if (
    env.HZENSE_LOCAL_DEVELOPMENT !== '1' ||
    env.NODE_ENV !== 'development' ||
    (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== 'development') ||
    !/^[1-9][0-9]{0,4}$/.test(env.PORT ?? '') ||
    Number(env.PORT) > 65535 ||
    env.NEXTAUTH_URL !== `http://127.0.0.1:${env.PORT}` ||
    env.HZENSE_RUNTIME_EXPECTED_HOST !== '127.0.0.1' ||
    env.HZENSE_RUNTIME_EXPECTED_PORT !== '55432' ||
    env.HZENSE_RUNTIME_EXPECTED_NAME !== 'hzense_local' ||
    env.HZENSE_RUNTIME_EXPECTED_USER !== 'hzense_runtime' ||
    !localDatabaseTarget(env.HZENSE_RUNTIME_DATABASE_URL, 'hzense_runtime')
  )
    return false;
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (
      key === 'VERCEL' ||
      (key.startsWith('VERCEL_') && key !== 'VERCEL_ENV') ||
      key.startsWith('AWS_') ||
      [
        'CI',
        'GITHUB_ACTIONS',
        'NETLIFY',
        'CF_PAGES',
        'RENDER',
        'NODE_TLS_REJECT_UNAUTHORIZED',
      ].includes(key)
    )
      return false;
    if (/(?:DATABASE_URL|DATABASE_DIRECT_URL)$/.test(key)) {
      const role = localDatabaseEnvironmentRoles[key];
      if (!role || !localDatabaseTarget(value, role)) return false;
    }
  }
  return true;
}

export function localDevelopmentOrigin(
  env: LocalDevelopmentEnvironment = process.env,
): string | null {
  return isLocalDevelopment(env) ? env.NEXTAUTH_URL! : null;
}

export function assertLocalDatabaseUrl(
  value: string | undefined,
  role: string,
  env: LocalDevelopmentEnvironment = process.env,
): string {
  if (
    !isLocalDevelopment(env) ||
    !Object.values(localDatabaseEnvironmentRoles).includes(role) ||
    !localDatabaseTarget(value, role)
  ) {
    throw new LocalDevelopmentError();
  }
  return value!;
}

/** Host is checked independently of forwarded headers to resist DNS rebinding. */
export function assertLocalDevelopmentRequest(
  request: Pick<Request, 'headers' | 'method'> & { url?: string },
  env: LocalDevelopmentEnvironment = process.env,
): void {
  const origin = localDevelopmentOrigin(env);
  if (!origin) throw new LocalDevelopmentError();
  const host = new URL(origin).host;
  const incoming = request.headers.get('origin');
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  // NextURL canonicalizes 127.0.0.1 to localhost internally. It is not the
  // caller authority: the original Host and browser Origin remain strict below.
  const internalOrigins = [origin, `http://localhost:${env.PORT}`];
  if (
    request.headers.get('host') !== host ||
    (request.url !== undefined && !internalOrigins.includes(new URL(request.url).origin)) ||
    ![null, 'same-origin', 'none'].includes(request.headers.get('sec-fetch-site')) ||
    (safeMethod ? incoming !== null && incoming !== origin : incoming !== origin) ||
    request.headers.has('forwarded') ||
    (request.headers.has('x-forwarded-host') && request.headers.get('x-forwarded-host') !== host) ||
    (request.headers.has('x-forwarded-proto') &&
      request.headers.get('x-forwarded-proto') !== 'http') ||
    (request.headers.has('x-forwarded-port') &&
      request.headers.get('x-forwarded-port') !== env.PORT)
  )
    throw new LocalDevelopmentError();
}

/** Use only inside an explicit local branch; the production URL policy stays unchanged. */
export function localRequestMatchesOrigin(
  request: Request,
  origin: string,
  env: LocalDevelopmentEnvironment = process.env,
): boolean {
  if (localDevelopmentOrigin(env) !== origin) return false;
  try {
    assertLocalDevelopmentRequest(request, env);
    return true;
  } catch {
    return false;
  }
}
