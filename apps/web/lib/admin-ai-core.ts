import { readRuntimeReaderConfig } from './runtime-reader-core.ts';
import { readAiKeyring } from '../../../packages/database/src/ai-config-crypto.mjs';
import type { AiKeyring } from '../../../packages/database/src/ai-config-store.mjs';
import { types } from 'node:util';

export class AiBackendConfigurationError extends Error {
  constructor() {
    super('ai_not_configured');
  }
}

export function readAiAllowedHosts(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) throw new AiBackendConfigurationError();
  const hosts = raw.split(',');
  if (
    hosts.length > 20 ||
    hosts.some(
      (host) =>
        host !== host.trim() ||
        host !== host.toLowerCase() ||
        host.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host),
    )
  )
    throw new AiBackendConfigurationError();
  return [...new Set(hosts)];
}

export function readAiBackendConfiguration(env: Readonly<Record<string, string | undefined>>): {
  connectionString: string;
  keyring: AiKeyring;
  allowedHosts: string[];
} {
  try {
    const value = env.HZENSE_AI_DATABASE_URL;
    if (
      !value ||
      /\s/.test(value) ||
      [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      !/^postgres(?:ql)?:\/\//.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (decodeURIComponent(url.username) !== 'hzense_ai_admin') throw new Error();
    // Validation only: reuse the reviewed target/TLS/pooler contract without
    // ever connecting as Runtime, Publisher or a migration owner.
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
    return {
      connectionString: value,
      keyring: readAiKeyring(env.HZENSE_AI_KEYRING),
      allowedHosts: readAiAllowedHosts(env.HZENSE_AI_ALLOWED_HOSTS),
    };
  } catch {
    throw new AiBackendConfigurationError();
  }
}

export type AiAdminOperation =
  | 'list-connections'
  | 'create-connection'
  | 'update-connection'
  | 'connection-history'
  | 'list-profiles'
  | 'save-profile'
  | 'profile-history'
  | 'list-probes'
  | 'run-probe'
  | 'get-probe';
const methods: Record<AiAdminOperation, string> = {
  'list-connections': 'GET',
  'create-connection': 'POST',
  'update-connection': 'PATCH',
  'connection-history': 'GET',
  'list-profiles': 'GET',
  'save-profile': 'POST',
  'profile-history': 'GET',
  'list-probes': 'GET',
  'run-probe': 'POST',
  'get-probe': 'GET',
};
const fields: Partial<Record<AiAdminOperation, readonly string[]>> = {
  'create-connection': ['id', 'name', 'protocol', 'base_url', 'enabled', 'settings', 'api_key'],
  'update-connection': [
    'id',
    'expected_revision',
    'name',
    'protocol',
    'base_url',
    'enabled',
    'settings',
    'api_key',
    'revoke_key',
  ],
  'save-profile': ['id', 'expected_revision', 'name', 'stages'],
  'run-probe': ['id', 'connection_id', 'connection_revision', 'kind', 'model_id'],
};
const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};
const failure = (error: string, status: number) =>
  Response.json({ error }, { status, headers: responseHeaders });
export const aiAdminErrorStatus: Readonly<Record<string, number>> = {
  invalid_request: 400,
  invalid_configuration: 400,
  endpoint_key_required: 400,
  not_found: 404,
  revision_conflict: 409,
  request_id_conflict: 409,
  connection_unavailable: 409,
  key_unavailable: 409,
  profile_not_ready: 409,
  daily_budget_exceeded: 429,
  concurrency_limit: 429,
  daily_probe_limit: 429,
  database_unavailable: 503,
  probe_outcome_unknown: 503,
  ai_not_configured: 503,
  keyring_unavailable: 503,
};

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const max = 32768;
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) throw new Error();
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value;
}

/** Authentication precedes body parsing, database access, and paid probes. */
export function createAiAdminHandler(dependencies: {
  authenticate: () => Promise<unknown>;
  origin: () => string | null;
  execute: (operation: AiAdminOperation, command: Record<string, unknown>) => Promise<unknown>;
}) {
  return async (request: Request, operation: AiAdminOperation, id?: string): Promise<Response> => {
    if (request.method !== methods[operation]) return failure('method_not_allowed', 405);
    try {
      if (!(await dependencies.authenticate())) return failure('unauthorized', 401);
    } catch {
      return failure('authentication_unavailable', 503);
    }
    let origin: string | null;
    try {
      origin = dependencies.origin();
    } catch {
      return failure('ai_not_configured', 503);
    }
    const incoming = request.headers.get('origin');
    if (
      !origin ||
      !['same-origin', null].includes(request.headers.get('sec-fetch-site')) ||
      (request.method === 'GET' ? incoming !== null && incoming !== origin : incoming !== origin)
    )
      return failure('forbidden_origin', 403);
    let command: Record<string, unknown> = {};
    if (request.method !== 'GET') {
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers.get('content-type') ?? '',
        )
      )
        return failure('json_required', 415);
      try {
        command = await readJson(request);
        if (Object.keys(command).some((key) => !fields[operation]?.includes(key)))
          throw new Error();
      } catch {
        return failure('invalid_request', 400);
      }
    } else {
      if (new URL(request.url).search) return failure('invalid_request', 400);
      if (id !== undefined) {
        if (id.match(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)?.[0] !== id)
          return failure('invalid_request', 400);
        command = { id };
      }
    }
    try {
      return Response.json(await dependencies.execute(operation, command), {
        headers: responseHeaders,
      });
    } catch (error) {
      if (error && typeof error === 'object' && types.isProxy(error))
        return failure('ai_unavailable', 503);
      if (error instanceof AiBackendConfigurationError) return failure('ai_not_configured', 503);
      const descriptor =
        error && typeof error === 'object' && !types.isProxy(error)
          ? Object.getOwnPropertyDescriptor(error, 'code')
          : undefined;
      const code = descriptor && typeof descriptor.value === 'string' ? descriptor.value : '';
      return Object.hasOwn(aiAdminErrorStatus, code)
        ? failure(code, aiAdminErrorStatus[code]!)
        : failure('ai_unavailable', 503);
    }
  };
}
