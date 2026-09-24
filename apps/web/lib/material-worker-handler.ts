import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { importResponse, readImportJSON } from './import-io.ts';
import { materialError } from './admin-material-handler.ts';
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(','),
  );
}
const owner = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value === value.trim() &&
  ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const attestation = (value: unknown) =>
  exact(value, ['keyId', 'payload', 'signature']) &&
  ['keyId', 'payload', 'signature'].every(
    (key) => typeof value[key] === 'string' && value[key].length > 0,
  );
export function createMaterialWorkerHandler(deps: {
  token(): string | undefined;
  inbox(after?: string): Promise<unknown>;
  read(owner: string, id: string): Promise<unknown>;
  accept(input: unknown): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      const token = deps.token(),
        provided = request.headers.get('authorization') ?? '';
      if (
        !token ||
        token.length < 32 ||
        Buffer.byteLength(provided) !== Buffer.byteLength(`Bearer ${token}`) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(`Bearer ${token}`))
      )
        return importResponse({ error: 'unauthorized' }, 401);
      const url = new URL(request.url);
      if (url.hash) return importResponse({ error: 'invalid_request' }, 400);
      if (request.method === 'GET') {
        const keys = [...url.searchParams.keys()];
        const after = url.searchParams.get('after');
        if (keys.length && (keys.length !== 1 || keys[0] !== 'after' || !uuid(after)))
          return importResponse({ error: 'invalid_request' }, 400);
        return importResponse(await deps.inbox(after ?? undefined));
      }
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      if (url.search) return importResponse({ error: 'invalid_request' }, 400);
      const body = (await readImportJSON(request, 300000)) as {
        action?: string;
        request?: unknown;
      };
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(',') !== 'action,request'
      )
        return importResponse({ error: 'invalid_request' }, 400);
      if (
        body.action === 'read' &&
        exact(body.request, ['owner', 'requestId']) &&
        owner(body.request.owner) &&
        uuid(body.request.requestId)
      )
        return importResponse(
          await deps.read(body.request.owner as string, body.request.requestId as string),
        );
      if (
        body.action === 'report' &&
        exact(body.request, ['owner', 'requestId', 'plan', 'attestation']) &&
        owner(body.request.owner) &&
        uuid(body.request.requestId) &&
        body.request.plan &&
        typeof body.request.plan === 'object' &&
        !Array.isArray(body.request.plan) &&
        attestation(body.request.attestation)
      )
        return importResponse(await deps.accept(body.request));
      return importResponse({ error: 'invalid_request' }, 400);
    } catch (error) {
      return materialError(error);
    }
  };
}
