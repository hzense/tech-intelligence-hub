import { importResponse, readImportJSON } from './import-io.ts';
import type { GenerationPreflightResult } from './signal-generation-preflight.ts';

/** Explicit admin gesture only; never route a prefetch/GET to the database. */
export function createGenerationPreflightHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  preflight(): Promise<GenerationPreflightResult>;
}) {
  return async (request: Request) => {
    try {
      if (!(await deps.session())) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        request.headers.get('origin') !== origin ||
        !['same-origin', null].includes(request.headers.get('sec-fetch-site'))
      )
        return importResponse({ error: 'forbidden' }, 403);
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      const url = new URL(request.url);
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      const body = await readImportJSON(request, 256);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        return importResponse({ error: 'invalid_request' }, 400);
      const result = await deps.preflight();
      return importResponse(result, result.status === 'ok' ? 200 : 503);
    } catch {
      // Never serialize driver/config/auth exception values.
      return importResponse({ error: 'preflight_unavailable' }, 503);
    }
  };
}
