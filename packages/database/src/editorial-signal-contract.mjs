import { URL } from 'node:url';
import { isExcludedPublicPerson } from '@hzense/ingestion/person-resource-policy';
import { SIGNAL_TYPES } from '../../ingestion/src/signal-types.mjs';

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
export const editorialResourceName = (name) =>
  name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function normalizeEditorialResources(value, { generated = false } = {}) {
  return list(
    value,
    36,
    (item) => {
      editorialObject(item, [
        'type',
        'name',
        'introduction',
        'event_role',
        'evidence',
        ...(generated
          ? []
          : ['entity_id', ...(Object.hasOwn(item ?? {}, 'source_urls') ? ['source_urls'] : [])]),
      ]);
      if (!['person', 'company', 'institution'].includes(item.type)) editorialFail();
      const evidence = list(
        item.evidence,
        8,
        (entry) => {
          editorialObject(entry, ['fragment_id', 'quote']);
          return {
            fragment_id: editorialText(entry.fragment_id, 30),
            quote: editorialText(entry.quote, 500),
          };
        },
        (entry) => `${entry.fragment_id}\0${entry.quote}`,
      );
      if (!evidence.length) editorialFail();
      const entityId = generated ? undefined : item.entity_id;
      if (
        !generated &&
        entityId !== null &&
        entityId !== '__new__' &&
        (typeof entityId !== 'string' ||
          entityId.length > 200 ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entityId))
      )
        editorialFail();
      return {
        type: item.type,
        name: editorialText(item.name, item.type === 'person' ? 150 : 200),
        introduction: item.introduction === null ? null : editorialText(item.introduction, 500),
        event_role: item.event_role === null ? null : editorialText(item.event_role, 200),
        evidence,
        ...(generated ? {} : { entity_id: entityId }),
        ...(!generated && Object.hasOwn(item, 'source_urls')
          ? {
              source_urls: list(item.source_urls, 8, (url) => {
                const value = editorialText(url, 2048);
                let parsed;
                try {
                  parsed = new URL(value);
                } catch {
                  editorialFail();
                }
                if (
                  parsed.protocol !== 'https:' ||
                  parsed.username ||
                  parsed.password ||
                  parsed.hash
                )
                  editorialFail();
                return value;
              }),
            }
          : {}),
      };
    },
    (item) =>
      `${item.type === 'person' ? 'person' : 'organization'}:${editorialResourceName(item.name)}`,
  );
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
    ...(Object.hasOwn(value ?? {}, 'signalType') ? ['signalType'] : []),
    ...(Object.hasOwn(value ?? {}, 'resources') ? ['resources'] : []),
  ]);
  if (
    value.signalType !== undefined &&
    value.signalType !== null &&
    !SIGNAL_TYPES.includes(value.signalType)
  )
    editorialFail();
  const eventDate = value.eventDate;
  if (
    eventDate !== null &&
    (typeof eventDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !Number.isFinite(Date.parse(eventDate)) ||
      new Date(eventDate).toISOString().slice(0, 10) !== eventDate)
  )
    editorialFail();
  const content = {
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
    ...(Object.hasOwn(value, 'signalType') ? { signalType: value.signalType } : {}),
    ...(Object.hasOwn(value, 'resources')
      ? { resources: normalizeEditorialResources(value.resources) }
      : {}),
  };
  if (content.resources) {
    const names = (items) => items.map(editorialResourceName).sort();
    for (const [type, declared] of [
      ['person', content.persons],
      ['organization', content.organizations],
    ]) {
      const covered = content.resources
        .filter((resource) => (resource.type === 'person' ? 'person' : 'organization') === type)
        .map((resource) => resource.name);
      if (JSON.stringify(names(covered)) !== JSON.stringify(names(declared)))
        editorialFail('material_changed');
    }
    const ids = content.resources
      .map((resource) => resource.entity_id)
      .filter((id) => id && id !== '__new__');
    if (new Set(ids).size !== ids.length) editorialFail('entity_reference_invalid');
  }
  return content;
}
export function contentReadiness(content) {
  const missing = ['eventDate', 'organizations', 'persons', 'topics'].filter((key) =>
    key === 'eventDate'
      ? !content.eventDate
      : key === 'persons' && content.resources !== undefined
        ? false
        : !content[key]?.length,
  );
  if (!content.signalType) missing.push('signalType');
  return { ready: missing.length === 0, missing };
}
export function normalizeEditorialRequest(request, material, { checkPublication = true } = {}) {
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
    content.summary !== editorialText(material.summary, 500)
  )
    editorialFail('material_changed');
  // Publication policy can change after a successful write. Keep normalization
  // and the historical request hash stable, then check current policy only when
  // the store has established that this is a new request, not a committed replay.
  if (checkPublication) {
    if (request.action !== 'withdraw' && content.persons.some(isExcludedPublicPerson))
      editorialFail('excluded_person');
    if (request.action !== 'withdraw') {
      const expected =
        material.resources === undefined
          ? undefined
          : normalizeEditorialResources(material.resources, { generated: true });
      const actual = content.resources?.map(({ entity_id: entityId, ...resource }, index) => {
        delete resource.source_urls;
        const original = expected?.[index];
        // An explicit canonical organization selection can correct company vs
        // institution. The store verifies that ID and its type under the lock.
        return entityId &&
          entityId !== '__new__' &&
          ['company', 'institution'].includes(resource.type) &&
          ['company', 'institution'].includes(original?.type)
          ? { ...resource, type: original.type }
          : resource;
      });
      if (JSON.stringify(actual) !== JSON.stringify(expected)) editorialFail('material_changed');
      if (content.resources) {
        if (request.action === 'publish' && content.resources.length && !content.sourceUrls.length)
          editorialFail('resource_source_required');
      }
    }
    if (
      request.action !== 'withdraw' &&
      (material.sourceOptions
        ? content.sourceUrls.some((url) => !material.sourceOptions.includes(url))
        : JSON.stringify(content.sourceUrls) !==
          JSON.stringify(material.sourceUrls.map((url) => editorialText(url, 2048))))
    )
      editorialFail('material_changed');
    if (request.action !== 'draft' && !request.consent) editorialFail('confirmation_required');
    if (request.action === 'publish' && !contentReadiness(content).ready)
      editorialFail('confirmation_required');
  }
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
