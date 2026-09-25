import { importResponse, readImportJSON } from './import-io.ts';

const safeErrors = new Set([
  'invalid_request',
  'not_found',
  'not_configured',
  'material_changed',
  'revision_conflict',
  'request_id_conflict',
  'confirmation_required',
  'review_incomplete',
  'topic_reference_invalid',
  'published_draft_forbidden',
  'already_published',
  'not_published',
  'commit_unknown',
  'limit_exceeded',
]);
export function createEditorialHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  read(owner: string, runId: string, candidateIndex: number): Promise<unknown>;
  write(owner: string, request: unknown): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site')) ||
        (request.method === 'GET'
          ? request.headers.has('origin') && request.headers.get('origin') !== origin
          : request.headers.get('origin') !== origin)
      )
        return importResponse({ error: 'forbidden' }, 403);
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const runId = url.searchParams.get('runId') ?? '';
        const index = url.searchParams.get('candidateIndex') ?? '';
        if (
          [...url.searchParams.keys()].sort().join(',') !== 'candidateIndex,runId' ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId) ||
          !/^[0-4]$/.test(index)
        )
          return importResponse({ error: 'invalid_request' }, 400);
        return importResponse(await deps.read(session.user.id, runId, Number(index)));
      }
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      const body = await readImportJSON(request, 32768);
      return importResponse(await deps.write(session.user.id, body));
    } catch (error) {
      const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const code = safeErrors.has(raw) ? raw : 'unavailable';
      return importResponse(
        { error: code },
        code === 'not_found'
          ? 404
          : code === 'invalid_request'
            ? 400
            : code === 'limit_exceeded'
              ? 413
              : ['unavailable', 'not_configured', 'commit_unknown'].includes(code)
                ? 503
                : 409,
      );
    }
  };
}
