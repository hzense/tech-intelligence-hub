import { AutomationError } from '../../../packages/database/src/automation-contract.mjs';
import { importResponse, readImportJSON, ImportIOError } from './import-io.ts';

type Session = { user: { id: string } } | null;
type Dependencies = {
  session(): Promise<Session>;
  origin(): string | undefined;
  dashboard(owner: string): Promise<unknown>;
  save(owner: string, request: unknown): Promise<unknown>;
  trigger(owner: string, request: unknown): Promise<unknown>;
  publish(owner: string, id: string, confirm: boolean): Promise<unknown>;
};
const exposed = new Set([
  'invalid_request',
  'not_configured',
  'not_found',
  'revision_conflict',
  'request_id_conflict',
  'task_active',
  'budget_exceeded',
  'profile_not_ready',
  'source_url_invalid',
  'config_limit',
  'insight_stale',
  'dispatch_unknown',
  'database_unavailable',
  'commit_unknown',
]);
function safeRun(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const run = value as Record<string, unknown>;
  const {
    lease_token: _token,
    lease_until: _lease,
    frozen_inputs: _frozen,
    owner_id: _owner,
    ...safe
  } = run;
  void [_token, _lease, _frozen, _owner];
  return safe;
}
function safeResult(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.runs)) return { ...record, runs: record.runs.map(safeRun) };
  if (record.run) return { ...record, run: safeRun(record.run) };
  return safeRun(value);
}
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutomationError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== fields.sort().join(',')) throw new AutomationError();
  return row;
}

export function createAutomationHandler(deps: Dependencies) {
  return async (request: Request) => {
    try {
      const session = await deps.session();
      if (!session) return importResponse({ error: 'unauthorized' }, 401);
      const origin = deps.origin();
      if (
        !origin ||
        request.headers.get('host') !== new URL(origin).host ||
        !['same-origin', null].includes(request.headers.get('sec-fetch-site')) ||
        (request.method === 'POST'
          ? request.headers.get('origin') !== origin
          : request.headers.has('origin') && request.headers.get('origin') !== origin)
      )
        return importResponse({ error: 'forbidden' }, 403);
      const url = new URL(request.url);
      if (url.search || url.hash) throw new AutomationError();
      if (request.method === 'GET')
        return importResponse(safeResult(await deps.dashboard(session.user.id)));
      if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
      const value = await readImportJSON(request, 20000);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutomationError();
      const action = (value as { action?: unknown }).action;
      if (action === 'save') {
        const row = exact(value, ['action', 'request']);
        return importResponse({ config: await deps.save(session.user.id, row.request) });
      }
      if (action === 'trigger') {
        const row = exact(value, ['action', 'request']);
        return importResponse(safeResult(await deps.trigger(session.user.id, row.request)), 202);
      }
      if (action === 'publish') {
        const row = exact(value, ['action', 'id', 'confirm']);
        if (typeof row.id !== 'string' || typeof row.confirm !== 'boolean')
          throw new AutomationError();
        return importResponse({
          run: safeRun(await deps.publish(session.user.id, row.id, row.confirm)),
        });
      }
      throw new AutomationError();
    } catch (error) {
      const code =
        error instanceof AutomationError || error instanceof ImportIOError
          ? error.code
          : 'unavailable';
      const safe = exposed.has(code) ? code : 'unavailable';
      return importResponse(
        { error: safe },
        safe === 'invalid_request'
          ? 400
          : safe === 'not_found'
            ? 404
            : safe === 'not_configured' || safe === 'unavailable' || safe === 'database_unavailable'
              ? 503
              : 409,
      );
    }
  };
}
