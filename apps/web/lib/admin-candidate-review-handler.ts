import { importResponse, readImportJSON } from './import-io.ts';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const safeErrors = new Set([
  'limit_exceeded',
  'invalid_request',
  'not_found',
  'not_configured',
  'revision_conflict',
  'request_id_conflict',
  'material_changed',
  'review_not_submitted',
  'review_revision_required',
  'duplicate_event',
  'verification_required',
  'verification_invalid',
  'verification_expired',
  'commit_unknown',
  'review_incomplete',
  'event_already_exists',
  'public_evidence_required',
  'entity_reference_invalid',
  'topic_reference_invalid',
  'trusted_verification_required',
  'conversion_not_found',
  'conversion_conflict',
  'profile_not_ready',
  'connection_unavailable',
  'worker_busy',
  'budget_exceeded',
  'configuration_changed',
]);
export function createCandidateReviewHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  read(owner: string, runId: string, candidateIndex: number): Promise<unknown>;
  confirm(owner: string, request: unknown): Promise<unknown>;
  enrich(owner: string, request: unknown): Promise<unknown>;
  operate(owner: string, action: string, request: Record<string, unknown>): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        !['same-origin', null].includes(request.headers.get('sec-fetch-site')) ||
        (request.method === 'GET'
          ? request.headers.has('origin') && request.headers.get('origin') !== origin
          : request.headers.get('origin') !== origin)
      )
        return importResponse({ error: 'forbidden' }, 403);
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const id = url.searchParams.get('runId') ?? '';
        const index = url.searchParams.get('candidateIndex') ?? '';
        if (
          [...url.searchParams.keys()].sort().join(',') !== 'candidateIndex,runId' ||
          !uuid.test(id) ||
          !/^[0-4]$/.test(index)
        )
          return importResponse({ error: 'invalid_request' }, 400);
        return importResponse(await deps.read(session.user.id, id, Number(index)));
      }
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      const body = await readImportJSON(request, 65536);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(',') !== 'action,request' ||
        !('action' in body) ||
        !('request' in body) ||
        typeof body.action !== 'string' ||
        !body.request ||
        typeof body.request !== 'object' ||
        Array.isArray(body.request)
      )
        return importResponse({ error: 'invalid_request' }, 400);
      if (body.action === 'confirm')
        return importResponse({ review: await deps.confirm(session.user.id, body.request) });
      if (body.action === 'enrich')
        return importResponse(
          { enrichment: await deps.enrich(session.user.id, body.request) },
          202,
        );
      if (
        !['inspect', 'prepare', 'verify', 'assemble', 'publish', 'withdraw'].includes(body.action)
      )
        return importResponse({ error: 'invalid_request' }, 400);
      return importResponse(
        await deps.operate(session.user.id, body.action, body.request as Record<string, unknown>),
      );
    } catch (error) {
      const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const code = safeErrors.has(raw) ? raw : 'unavailable';
      return importResponse(
        { error: code },
        code === 'limit_exceeded'
          ? 413
          : code === 'not_found'
            ? 404
            : code === 'invalid_request'
              ? 400
              : ['not_configured', 'unavailable', 'commit_unknown'].includes(code)
                ? 503
                : 409,
      );
    }
  };
}
