import { createHash } from 'node:crypto';
import { validateImportManifest } from '../../ingestion/src/import-manifest.mjs';

export class AutomationError extends Error {
  constructor(code = 'invalid_request') {
    super(code);
    this.name = 'AutomationError';
    this.code = code;
  }
}
export const automationFail = (code) => {
  throw new AutomationError(code);
};
export function automationUuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    automationFail();
  return value;
}
export function automationText(value, max = 200) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    automationFail();
  return value.trim();
}
export function automationExact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    automationFail();
}
export function normalizeAutomationConfig(value) {
  automationExact(value, [
    'name',
    'kind',
    'enabled',
    'frequency',
    'sourceUrls',
    'topicIds',
    'profileId',
    'profileRevision',
    ...(Object.hasOwn(value ?? {}, 'discovery') ? ['discovery'] : []),
  ]);
  if (
    !['source_collection', 'topic_insight'].includes(value.kind) ||
    typeof value.enabled !== 'boolean' ||
    !['manual', 'daily', 'weekly'].includes(value.frequency)
  )
    automationFail();
  if (
    !Array.isArray(value.sourceUrls) ||
    value.sourceUrls.length > 8 ||
    !Array.isArray(value.topicIds) ||
    value.topicIds.length > 5
  )
    automationFail();
  const sourceUrls = value.sourceUrls.map((url) => {
    automationText(url, 2048);
    const result = validateImportManifest(
      { urlLines: url },
      { capabilities: { urlFetch: true, parsers: ['html', 'text', 'pdf'] } },
    );
    if (!result.valid || result.urls.length !== 1) automationFail('source_url_invalid');
    return result.urls[0].canonicalUrl;
  });
  const topicIds = value.topicIds.map((id) => automationText(id, 100));
  if (new Set(sourceUrls).size !== sourceUrls.length || new Set(topicIds).size !== topicIds.length)
    automationFail();
  let discovery;
  if (value.discovery !== undefined) {
    automationExact(value.discovery, ['keywords', 'lookbackDays', 'maxSources']);
    const d = value.discovery;
    if (
      value.kind !== 'source_collection' ||
      sourceUrls.length ||
      !topicIds.length ||
      !Array.isArray(d.keywords) ||
      d.keywords.length > 10 ||
      !Number.isInteger(d.lookbackDays) ||
      d.lookbackDays < 1 ||
      d.lookbackDays > 30 ||
      !Number.isInteger(d.maxSources) ||
      d.maxSources < 1 ||
      d.maxSources > 8
    )
      automationFail();
    const keywords = d.keywords.map((word) => automationText(word, 80));
    if (new Set(keywords).size !== keywords.length) automationFail();
    discovery = { keywords, lookbackDays: d.lookbackDays, maxSources: d.maxSources };
  }
  // Existing URL configurations remain explicit legacy jobs, never silently incur search fees.
  if (
    value.kind === 'source_collection' &&
    ((!sourceUrls.length && !discovery) || value.profileId === null)
  )
    automationFail();
  if (
    value.kind === 'topic_insight' &&
    (!topicIds.length || sourceUrls.length || value.profileId === null)
  )
    automationFail();
  if (value.profileId !== null) {
    automationUuid(value.profileId);
    if (!Number.isSafeInteger(value.profileRevision) || value.profileRevision < 1) automationFail();
  } else if (value.profileRevision !== null) automationFail();
  return {
    name: automationText(value.name, 120),
    kind: value.kind,
    enabled: value.enabled,
    frequency: value.frequency,
    sourceUrls,
    topicIds,
    profileId: value.profileId,
    profileRevision: value.profileRevision,
    ...(discovery ? { discovery } : {}),
  };
}
export const automationHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function automationStableId(value) {
  const hash = automationHash(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
export function automationSlot(frequency, now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime()) || !['daily', 'weekly'].includes(frequency))
    automationFail();
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return `${frequency}:${date.toISOString().slice(0, 10)}`;
}
export function nextAutomationTime(frequency, now) {
  if (frequency === 'manual') return null;
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7 - ((date.getUTCDay() + 6) % 7));
  else date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
