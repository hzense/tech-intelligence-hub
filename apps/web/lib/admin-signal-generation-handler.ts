import { GenerationError } from './signal-generation-core.ts';
import { SignalGenerationError } from '../../../packages/database/src/signal-generation-store.mjs';
import { AiConfigError, aiUuid } from '../../../packages/database/src/ai-config-contract.mjs';
import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { SignalGenerationError as GenerationContractError } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { importResponse, readImportJSON, ImportIOError } from './import-io.ts';

const exposed = new Set([
  'task_active',
  'task_deleted',
  'duplicate_source',
  'invalid_request',
  'not_configured',
  'not_found',
  'request_id_conflict',
  'profile_not_ready',
  'revision_conflict',
  'connection_unavailable',
  'worker_busy',
  'budget_exceeded',
  'source_changed',
  'configuration_changed',
  'stale_attempt',
  'commit_unknown',
  'source_unavailable',
  'cancelled',
  'input_too_large',
  'invalid_source',
  'limit_exceeded',
]);
export function createGenerationHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  dashboard(owner: string): Promise<unknown>;
  execute(owner: string, body: unknown): Promise<unknown>;
  delete?(owner: string, id: string): Promise<unknown>;
  detail?(owner: string, id: string): Promise<unknown>;
  inspectSource?(owner: string, body: unknown): Promise<unknown>;
  enqueue?(owner: string, id: string): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin(),
        url = new URL(request.url);
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        !['same-origin', null].includes(request.headers.get('sec-fetch-site')) ||
        (request.method === 'GET'
          ? request.headers.has('origin') && request.headers.get('origin') !== origin
          : request.headers.get('origin') !== origin)
      )
        return importResponse({ error: 'forbidden' }, 403);
      // Next reconstructs an internal URL; authority comes from actual Host and fixed auth origin.
      if (request.method === 'GET' && url.searchParams.has('id') && !url.hash) {
        if ([...url.searchParams.keys()].join(',') !== 'id' || !deps.detail)
          throw new GenerationError('invalid_request');
        return importResponse({
          run: await deps.detail(session.user.id, aiUuid(url.searchParams.get('id'))),
        });
      }
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      if (request.method === 'GET') return importResponse(await deps.dashboard(session.user.id));
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      const body = await readImportJSON(request, 4096);
      if (body && typeof body === 'object' && 'action' in body && body.action === 'run') {
        if (
          Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'action,id' ||
          !('id' in body)
        )
          throw new GenerationError('invalid_request');
        if (!deps.enqueue) throw new GenerationError('not_configured');
        return importResponse({ run: await deps.enqueue(session.user.id, aiUuid(body.id)) }, 202);
      }
      if (body && typeof body === 'object' && 'action' in body && body.action === 'detail') {
        if (
          Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'action,id' ||
          !('id' in body)
        )
          throw new GenerationError('invalid_request');
        const id = aiUuid(body.id);
        if (!deps.detail) throw new GenerationError('not_configured');
        return importResponse({ run: await deps.detail(session.user.id, id) });
      }
      if (body && typeof body === 'object' && 'action' in body && body.action === 'delete') {
        if (
          Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'action,id' ||
          !('id' in body)
        )
          throw new GenerationError('invalid_request');
        if (!deps.delete) throw new GenerationError('not_configured');
        return importResponse(await deps.delete(session.user.id, aiUuid(body.id)));
      }
      if (
        body &&
        typeof body === 'object' &&
        'action' in body &&
        body.action === 'inspect_source'
      ) {
        if (!deps.inspectSource) throw new GenerationError('not_configured');
        return importResponse({ inspection: await deps.inspectSource(session.user.id, body) });
      }
      return importResponse({ run: await deps.execute(session.user.id, body) });
    } catch (error) {
      const trusted =
        error instanceof GenerationError ||
        error instanceof SignalGenerationError ||
        error instanceof GenerationContractError ||
        error instanceof AiConfigError ||
        error instanceof ImportTaskError ||
        error instanceof ImportIOError;
      const raw = trusted ? error.code : 'unavailable';
      const mapped =
        raw === 'generation_source_too_large'
          ? 'input_too_large'
          : raw === 'invalid_generation_source'
            ? 'invalid_source'
            : raw;
      const code = exposed.has(mapped) ? mapped : 'unavailable';
      return importResponse(
        {
          error: code,
          ...(code === 'task_deleted' && error instanceof SignalGenerationError && error.previousId
            ? { previous_id: error.previousId }
            : {}),
        },
        code === 'not_found'
          ? 404
          : code === 'invalid_request' ||
              code === 'input_too_large' ||
              code === 'invalid_source' ||
              code === 'limit_exceeded'
            ? 400
            : code === 'not_configured' || code === 'unavailable'
              ? 503
              : 409,
      );
    }
  };
}
