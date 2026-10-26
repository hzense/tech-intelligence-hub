import { URL } from 'node:url';

const keys = ['runId', 'windowStart', 'windowEnd', 'sourceUrl', 'discoveredPublishedAt'];
const dayMilliseconds = 86_400_000;

function calendarDate(value) {
  return (
    typeof value === 'string' &&
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Immutable collection provenance, never a publication date supplied by the browser. */
export function parseCollectionPublicationWindow(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    typeof value.runId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.runId)
  )
    return null;
  for (const key of ['windowStart', 'windowEnd']) {
    const timestamp = value[key];
    if (
      typeof timestamp !== 'string' ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp
    )
      return null;
  }
  const days = (Date.parse(value.windowEnd) - Date.parse(value.windowStart)) / dayMilliseconds;
  if (!Number.isInteger(days) || days < 1 || days > 30) return null;
  try {
    if (
      typeof value.sourceUrl !== 'string' ||
      value.sourceUrl.length > 2048 ||
      value.sourceUrl.includes('#') ||
      value.sourceUrl !== value.sourceUrl.trim()
    )
      return null;
    const url = new URL(value.sourceUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== value.sourceUrl
    )
      return null;
  } catch {
    return null;
  }
  if (
    !calendarDate(value.discoveredPublishedAt) ||
    value.discoveredPublishedAt < value.windowStart.slice(0, 10) ||
    value.discoveredPublishedAt > value.windowEnd.slice(0, 10)
  )
    return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

/** Recheck the date extracted from the original, not the discovery model's claim.
 * Day precision intentionally matches discovery's inclusive UTC-date window. */
export function collectionPublicationDateIssue(collection, eventDate, sourceUrls) {
  const window = parseCollectionPublicationWindow(collection);
  if (!window) return 'invalid_collection_window';
  if (!Array.isArray(sourceUrls) || !sourceUrls.includes(window.sourceUrl))
    return 'collection_source_mismatch';
  if (
    !calendarDate(eventDate) ||
    eventDate < window.windowStart.slice(0, 10) ||
    eventDate > window.windowEnd.slice(0, 10)
  )
    return 'source_date_out_of_window';
  return null;
}
