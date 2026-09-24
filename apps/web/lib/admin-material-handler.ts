import { importResponse, readImportJSON } from './import-io.ts';
const safe = new Set([
  'limit_exceeded',
  'invalid_request',
  'not_found',
  'not_configured',
  'material_changed',
  'source_unavailable',
  'invalid_candidate_source_bundle',
  'invalid_material_plan',
  'verification_invalid',
  'verification_expired',
  'catalog_conflict',
  'topic_reference_invalid',
  'commit_unknown',
  'request_id_conflict',
  'source_conflict',
  'entity_reference_invalid',
  'material_entity_ambiguous',
  'material_registration_conflict',
  'material_topic_invalid',
  'material_evidence_rejected',
  'invalid_attestation',
  'invalid_bundle',
  'catalog_limit',
]);
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(','),
  );
}
function validCreate(value: unknown) {
  return (
    exact(value, ['id', 'runId', 'candidateIndex', 'materialHash', 'supplements', 'consent']) &&
    uuid(value.id) &&
    uuid(value.runId) &&
    Number.isInteger(value.candidateIndex) &&
    Number(value.candidateIndex) >= 0 &&
    Number(value.candidateIndex) <= 4 &&
    hash(value.materialHash) &&
    value.consent === true &&
    Array.isArray(value.supplements) &&
    value.supplements.length <= 3 &&
    value.supplements.every(
      (row) => exact(row, ['batchId', 'itemId']) && uuid(row.batchId) && uuid(row.itemId),
    )
  );
}
function validConfirm(value: unknown) {
  return (
    exact(value, ['requestId', 'reportId', 'planHash', 'consent']) &&
    uuid(value.requestId) &&
    uuid(value.reportId) &&
    hash(value.planHash) &&
    value.consent === true
  );
}
export function materialError(error: unknown) {
  const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const code = safe.has(raw) ? raw : 'unavailable';
  return importResponse(
    { error: code },
    code === 'limit_exceeded'
      ? 413
      : code === 'not_found'
        ? 404
        : ['not_configured', 'unavailable', 'commit_unknown'].includes(code)
          ? 503
          : code === 'invalid_request'
            ? 400
            : 409,
  );
}
export function createAdminMaterialHandler(deps: {
  session(): Promise<{ user: { id: string } } | null>;
  origin(): string | undefined;
  read(owner: string, runId: string, index: number): Promise<unknown>;
  create(owner: string, input: unknown): Promise<unknown>;
  confirm(owner: string, input: unknown): Promise<unknown>;
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
      if (url.hash) return importResponse({ error: 'invalid_request' }, 400);
      if (request.method === 'GET') {
        const runId = url.searchParams.get('runId') ?? '',
          index = url.searchParams.get('candidateIndex') ?? '';
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
      const body = (await readImportJSON(request, 8192)) as { action?: string; request?: unknown };
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(',') !== 'action,request'
      )
        return importResponse({ error: 'invalid_request' }, 400);
      if (body.action === 'create' && validCreate(body.request))
        return importResponse(await deps.create(session.user.id, body.request));
      if (body.action === 'confirm' && validConfirm(body.request))
        return importResponse(await deps.confirm(session.user.id, body.request));
      return importResponse({ error: 'invalid_request' }, 400);
    } catch (error) {
      return materialError(error);
    }
  };
}
