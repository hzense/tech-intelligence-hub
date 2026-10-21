import { importResponse, readImportJSON } from './import-io.ts';

/** Explicit authenticated POST only; visiting a task never changes publication. */
export function createAutomaticPublicationHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  publish(owner: string, runId: string): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        request.headers.get('origin') !== origin ||
        ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site'))
      )
        return importResponse({ error: 'forbidden' }, 403);
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      const url = new URL(request.url);
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      const body = await readImportJSON(request, 4096);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).join(',') !== 'runId' ||
        !('runId' in body) ||
        typeof body.runId !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.runId)
      )
        return importResponse({ error: 'invalid_request' }, 400);
      return importResponse(await deps.publish(session.user.id, body.runId));
    } catch {
      return importResponse({ error: 'unavailable' }, 503);
    }
  };
}
