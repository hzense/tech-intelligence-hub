import { GenerationError } from './signal-generation-core.ts';
import { SignalGenerationError } from '../../../packages/database/src/signal-generation-store.mjs';
import { AiConfigError } from '../../../packages/database/src/ai-config-contract.mjs';
import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { SignalGenerationError as GenerationContractError } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { importResponse, readImportJSON, ImportIOError } from './import-io.ts';

const exposed = new Set([
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
      if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
      if (request.method === 'GET') return importResponse(await deps.dashboard(session.user.id));
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      return importResponse({
        run: await deps.execute(session.user.id, await readImportJSON(request, 4096)),
      });
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
        { error: code },
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
