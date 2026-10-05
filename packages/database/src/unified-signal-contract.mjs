import { URL } from 'node:url';
import { SIGNAL_TYPES } from '../../ingestion/src/signal-types.mjs';
import { isExcludedPublicPerson } from '../../ingestion/src/person-resource-policy.mjs';
import { canonicalLegacyArchiveJson } from './legacy-signal-archive.mjs';

export const UNIFIED_SIGNAL_SCHEMA = '4.0.0';
export class UnifiedSignalError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = 'UnifiedSignalError';
  }
}
export const unifiedSignalFail = (code = 'invalid_unified_signal') => {
  throw new UnifiedSignalError(code);
};
const fail = unifiedSignalFail;
const text = (value, nullable = false) => {
  if (value === null && nullable) return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 100_000 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    fail();
  return value;
};
function exact(value, keys) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail();
}
export function unifiedSignalId(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    fail();
  return value;
}
function date(value, nullable = true) {
  if (value === null && nullable) return;
  text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    fail();
}
function list(value, validate, key) {
  if (!Array.isArray(value) || value.length > 1000) fail();
  value.forEach(validate);
  if (new Set(value.map(key)).size !== value.length) fail();
}
function url(value) {
  text(value);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail();
}
function participant(value) {
  exact(value, ['id', 'name', 'event_role', 'kind', 'introduction', 'source_urls']);
  if (value.id !== null) unifiedSignalId(value.id);
  text(value.name);
  text(value.event_role, true);
  text(value.introduction, true);
  list(value.source_urls, url, (item) => item);
}

/** Explicit nulls mean unknown, never a fabricated score, identity or collection time. */
export function assertUnifiedSignalContent(value, { historical = false } = {}) {
  exact(value, [
    'title',
    'summary',
    'type',
    'occurred_at',
    'captured_at',
    'importance',
    'confidence',
    'novelty',
    'people',
    'organizations',
    'topics',
    'sources',
    'related_entities',
  ]);
  text(value.title);
  text(value.summary);
  if (!historical && ([...value.title].length > 80 || [...value.summary].length > 500)) fail();
  if (value.type !== null && !SIGNAL_TYPES.includes(value.type)) fail();
  date(value.occurred_at);
  date(value.captured_at);
  if (
    value.importance !== null &&
    (!Number.isInteger(value.importance) || value.importance < 1 || value.importance > 5)
  )
    fail();
  for (const key of ['confidence', 'novelty']) {
    if (
      value[key] !== null &&
      (typeof value[key] !== 'number' ||
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > 1)
    )
      fail();
  }
  const identity = (item) => item.id ?? item.name.normalize('NFKC').trim().toLowerCase();
  list(
    value.people,
    (item) => {
      participant(item);
      if (item.kind !== 'person' || isExcludedPublicPerson({ ...item, type: 'person' }))
        fail('excluded_public_person');
    },
    identity,
  );
  list(
    value.organizations,
    (item) => {
      participant(item);
      if (![null, 'company', 'institution'].includes(item.kind)) fail();
    },
    identity,
  );
  list(
    value.topics,
    (item) => {
      exact(item, ['id', 'title']);
      unifiedSignalId(item.id);
      text(item.title);
    },
    (item) => item.id,
  );
  list(
    value.sources,
    (item) => {
      exact(item, ['id', 'name', 'url']);
      if (item.id !== null) unifiedSignalId(item.id);
      text(item.name, true);
      url(item.url);
    },
    (item) => item.url,
  );
  list(
    value.related_entities,
    (item) => {
      exact(item, ['id', 'name', 'type']);
      unifiedSignalId(item.id);
      text(item.name);
      text(item.type);
    },
    (item) => item.id,
  );
  // Detached JSON, no aliases to caller-owned mutable arrays.
  return JSON.parse(canonicalLegacyArchiveJson(value));
}

/** Content completeness is not a publication permit or a fact-verification result. */
export function unifiedSignalReadiness(content) {
  const value = assertUnifiedSignalContent(content);
  const missing = [];
  if (!value.occurred_at) missing.push('occurred_at');
  if (!value.people.length) missing.push('people');
  if (!value.organizations.length) missing.push('organizations');
  if (!value.topics.length) missing.push('topics');
  if (!value.type) missing.push('type');
  return { ready: !missing.length, missing };
}
