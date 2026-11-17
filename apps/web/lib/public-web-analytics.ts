import type { BeforeSendEvent } from '@vercel/analytics/next';

const publicOrigins = new Set(['https://hzense.com', 'https://www.hzense.com']);
const publicPagePath =
  /^\/(?:|radar|search|(?:signals|insights|resources|persons)(?:\/[^/]+)?|topics(?:\/[^/]+(?:\/editions\/[^/]+)?)?)\/?$/;

export function isPublicAnalyticsPath(pathname: string | null): boolean {
  return pathname !== null && publicPagePath.test(pathname);
}

// Keep this filter active after client-side navigation, even once the SDK script
// has loaded on a public page. Recorded page URLs omit query strings and fragments.
export function filterPublicPageview(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== 'pageview') return null;

  try {
    const url = new URL(event.url);
    if (!publicOrigins.has(url.origin) || !isPublicAnalyticsPath(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
