import { types } from 'node:util';
import { readRuntimeReaderConfig } from './runtime-reader-core.ts';

export type SignalWorkbenchOperation = 'list' | 'detail';
export class SignalWorkbenchConfigurationError extends Error {
  constructor() {
    super('workbench_not_configured');
  }
}
export class SignalWorkbenchQueryError extends Error {
  constructor() {
    super('invalid_query');
  }
}

const hasControls = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
function slug(value: string | undefined): string {
  if (!value || value.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new SignalWorkbenchQueryError();
  return value;
}
function integer(value: string, maximum: number): number {
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 10) throw new SignalWorkbenchQueryError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new SignalWorkbenchQueryError();
  return parsed;
}

/** Shared by the protected SSR pages and GET API. No silent unknown/duplicate parameters. */
export function parseSignalWorkbenchQuery(
  params: URLSearchParams,
  operation: SignalWorkbenchOperation,
  id?: string,
): Record<string, unknown> {
  if (params.toString().length > 2048) throw new SignalWorkbenchQueryError();
  const allowed = operation === 'list' ? ['q', 'after', 'limit'] : ['version'];
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new SignalWorkbenchQueryError();
    seen.add(key);
  }
  if (operation === 'detail') {
    return {
      signal_id: slug(id),
      ...(params.has('version') ? { version: integer(params.get('version')!, 2147483647) } : {}),
    };
  }
  if (id !== undefined) throw new SignalWorkbenchQueryError();
  const q = params.get('q') ?? '';
  if (q.length > 100 || hasControls(q)) throw new SignalWorkbenchQueryError();
  const after = params.get('after') ?? '';
  return {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(after ? { after: slug(after) } : {}),
    limit: params.has('limit') ? integer(params.get('limit')!, 50) : 25,
  };
}

/** Preserve duplicate parameters from Next's async searchParams for rejection. */
export function signalWorkbenchSearchParams(
  values: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') params.append(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

/** Validation only; the Runtime credential is never used for private Signal data. */
export function readSignalWorkbenchConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): { connectionString: string } {
  try {
    const value = env.HZENSE_SIGNAL_ADMIN_DATABASE_URL;
    if (!value || /\s/.test(value) || hasControls(value) || !/^postgres(?:ql)?:\/\//.test(value))
      throw new Error();
    const url = new URL(value);
    if (decodeURIComponent(url.username) !== 'hzense_signal_admin_reader') throw new Error();
    // Reuse the exact Production/Neon pooled endpoint and TLS target contract.
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
    return { connectionString: value };
  } catch {
    throw new SignalWorkbenchConfigurationError();
  }
}

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

/** Every endpoint authenticates before query parsing or private database access. */
export function createSignalWorkbenchHandler(dependencies: {
  authenticate: () => Promise<unknown>;
  origin: () => string | null;
  execute: (
    operation: SignalWorkbenchOperation,
    command: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  return async (
    request: Request,
    operation: SignalWorkbenchOperation,
    id?: string,
  ): Promise<Response> => {
    if (request.method !== 'GET') return failure('method_not_allowed', 405);
    try {
      if (!(await dependencies.authenticate())) return failure('unauthorized', 401);
    } catch {
      return failure('authentication_unavailable', 503);
    }
    let origin: string | null;
    try {
      origin = dependencies.origin();
    } catch {
      return failure('workbench_not_configured', 503);
    }
    if (!origin) return failure('workbench_not_configured', 503);
    // Check the actual HTTP authority, not NextRequest's reconstructed URL or
    // client-provided forwarded headers. Keep localhost and 127.0.0.1 distinct.
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return failure('workbench_not_configured', 503);
    }
    if (request.headers.get('host')?.toLowerCase() !== host.toLowerCase())
      return failure('forbidden_origin', 403);
    const incoming = request.headers.get('origin');
    if (
      !['same-origin', null].includes(request.headers.get('sec-fetch-site')) ||
      (incoming !== null && incoming !== origin)
    )
      return failure('forbidden_origin', 403);
    let command: Record<string, unknown>;
    try {
      const url = new URL(request.url);
      // NextRequest normalizes loopback names and deployments may reconstruct
      // internal URLs. Never derive the trusted auth origin from that URL or
      // forwarded headers. The fixed auth configuration and actual Origin /
      // Fetch Metadata checks above govern this authenticated, read-only GET.
      if (url.hash) throw new SignalWorkbenchQueryError();
      command = parseSignalWorkbenchQuery(url.searchParams, operation, id);
    } catch {
      return failure('invalid_query', 400);
    }
    try {
      return Response.json(await dependencies.execute(operation, command), { headers });
    } catch (error) {
      if (error && typeof error === 'object' && types.isProxy(error))
        return failure('workbench_unavailable', 503);
      if (error instanceof SignalWorkbenchConfigurationError)
        return failure('workbench_not_configured', 503);
      const descriptor =
        error && typeof error === 'object'
          ? Object.getOwnPropertyDescriptor(error, 'code')
          : undefined;
      const code = descriptor && typeof descriptor.value === 'string' ? descriptor.value : '';
      if (code === 'not_found') return failure('not_found', 404);
      if (code === 'incompatible_data') return failure('workbench_incompatible_data', 503);
      if (code === 'invalid_query' || code === 'invalid_request')
        return failure('invalid_query', 400);
      return failure('workbench_unavailable', 503);
    }
  };
}
