import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { ImportIOError, importResponse, readImportJSON } from './import-io.ts';
import { safeImportConflictReason } from './import-conflict.ts';

export interface ImportAdminDependencies {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  execute(owner: string, method: string, body: unknown): Promise<unknown>;
}
const exposed = new Set([
  'invalid_request',
  'manifest_rejected',
  'not_found',
  'request_id_conflict',
  'daily_batch_limit',
  'configuration_conflict',
  'not_configured',
  'limit_exceeded',
  'budget_exceeded',
  'worker_busy',
  'not_claimable',
  'retry_not_allowed',
  'cancelled',
  'document_conflict',
  'stale_attempt',
  'commit_unknown',
  'ocr_required',
  'source_unavailable',
  'source_expired',
  'unsupported_content',
]);
export function importError(error: unknown) {
  const code =
    (error instanceof ImportTaskError || error instanceof ImportIOError) && exposed.has(error.code)
      ? error.code
      : 'unavailable';
  const reason =
    code === 'document_conflict' && error instanceof ImportTaskError
      ? safeImportConflictReason(error.reason)
      : undefined;
  if (reason) console.warn('import_document_conflict', { reason });
  return importResponse(
    { error: code, ...(reason ? { reason } : {}) },
    code === 'not_found'
      ? 404
      : code === 'not_configured' || code === 'unavailable'
        ? 503
        : code === 'invalid_request' || code === 'manifest_rejected'
          ? 400
          : 409,
  );
}
export function createImportAdminHandler(deps: ImportAdminDependencies) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (!origin || new URL(request.url).origin !== origin)
        return importResponse({ error: 'forbidden' }, 403);
      if (
        request.method !== 'GET' &&
        (request.headers.get('origin') !== origin ||
          ['cross-site', 'none'].includes(request.headers.get('sec-fetch-site') ?? ''))
      )
        return importResponse({ error: 'forbidden' }, 403);
      if (!['GET', 'POST'].includes(request.method))
        return importResponse({ error: 'method_not_allowed' }, 405);
      const query = new URL(request.url).searchParams;
      if (
        [...query.keys()].some((k) => !['before', 'view'].includes(k)) ||
        query.getAll('before').length > 1 ||
        query.getAll('view').length > 1 ||
        (query.has('view') && !['current', 'history'].includes(query.get('view')!))
      )
        return importResponse({ error: 'invalid_request' }, 400);
      return importResponse(
        await deps.execute(
          session.user.id,
          request.method,
          request.method === 'POST'
            ? await readImportJSON(request)
            : query.size
              ? Object.fromEntries(query)
              : null,
        ),
      );
    } catch (error) {
      return importError(error);
    }
  };
}
