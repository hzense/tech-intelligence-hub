import { URL } from 'node:url';

export class EditorialSignalError extends Error {
  constructor(code = 'invalid_request') {
    super(code);
    this.name = 'EditorialSignalError';
    this.code = code;
  }
}
export const editorialFail = (code) => {
  throw new EditorialSignalError(code);
};
export function editorialObject(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    editorialFail();
}
export function editorialText(value, max) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > max ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    editorialFail();
  return value.trim();
}
export function editorialUuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    editorialFail();
  return value;
}
function list(value, max, normalize, key = (item) => item) {
  if (!Array.isArray(value) || value.length > max) editorialFail();
  const result = value.map(normalize);
  if (new Set(result.map(key)).size !== result.length) editorialFail();
  return result;
}
export function normalizeEditorialContent(value) {
  editorialObject(value, [
    'title',
    'summary',
    'eventDate',
    'organizations',
    'persons',
    'topics',
    'sourceUrls',
  ]);
  const eventDate = value.eventDate;
  if (
    eventDate !== null &&
    (typeof eventDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !Number.isFinite(Date.parse(eventDate)) ||
      new Date(eventDate).toISOString().slice(0, 10) !== eventDate)
  )
    editorialFail();
  return {
    title: editorialText(value.title, 80),
    summary: editorialText(value.summary, 500),
    eventDate,
    organizations: list(value.organizations, 24, (item) => editorialText(item, 200)),
    persons: list(value.persons, 12, (item) => editorialText(item, 200)),
    topics: list(
      value.topics,
      5,
      (item) => {
        editorialObject(item, ['id', 'title']);
        return { id: editorialText(item.id, 100), title: editorialText(item.title, 200) };
      },
      (item) => item.id,
    ),
    sourceUrls: list(value.sourceUrls, 8, (item) => {
      const value = editorialText(item, 2048);
      let url;
      try {
        url = new URL(value);
      } catch {
        editorialFail();
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) editorialFail();
      return value;
    }),
  };
}
export function contentReadiness(content) {
  const missing = ['eventDate', 'organizations', 'persons', 'topics'].filter((key) =>
    key === 'eventDate' ? !content.eventDate : !content[key]?.length,
  );
  return { ready: missing.length === 0, missing };
}
export function normalizeEditorialRequest(request, material) {
  editorialObject(request, [
    'requestId',
    'runId',
    'candidateIndex',
    'expectedRevision',
    'materialHash',
    'action',
    'content',
    'consent',
  ]);
  editorialUuid(request.requestId);
  editorialUuid(request.runId);
  if (
    !Number.isInteger(request.candidateIndex) ||
    request.candidateIndex < 0 ||
    request.candidateIndex > 4 ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    typeof request.materialHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.materialHash) ||
    !['draft', 'publish', 'withdraw'].includes(request.action) ||
    typeof request.consent !== 'boolean'
  )
    editorialFail();
  const content = normalizeEditorialContent(request.content);
  if (
    request.materialHash !== material?.materialHash ||
    content.title !== editorialText(material.title, 80) ||
    content.summary !== editorialText(material.summary, 500) ||
    JSON.stringify(content.sourceUrls) !==
      JSON.stringify(material.sourceUrls.map((url) => editorialText(url, 2048)))
  )
    editorialFail('material_changed');
  if (request.action !== 'draft' && !request.consent) editorialFail('confirmation_required');
  if (request.action === 'publish' && !contentReadiness(content).ready)
    editorialFail('confirmation_required');
  return {
    requestId: request.requestId,
    runId: request.runId,
    candidateIndex: request.candidateIndex,
    expectedRevision: request.expectedRevision,
    materialHash: request.materialHash,
    action: request.action,
    content,
    consent: request.consent,
  };
}
