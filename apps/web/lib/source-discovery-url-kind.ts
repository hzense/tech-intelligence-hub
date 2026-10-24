/** Conservative route detection only, not proof that an accepted URL contains a full article.
 * Unknown routes and project homepages remain eligible for the existing citation/date checks. */
export function isExplicitNonArticleUrl(value: string): boolean {
  let url: URL;
  let segments: string[];
  try {
    url = new URL(value);
    segments = url.pathname
      .split('/')
      .flatMap((segment) => decodeURIComponent(segment).toLowerCase().split('/'))
      .filter(Boolean);
  } catch {
    return false;
  }
  // Repository owner/name segments are identifiers, not website navigation routes.
  if (['github.com', 'www.github.com', 'gitlab.com', 'www.gitlab.com'].includes(url.hostname))
    return segments.length === 1 && ['search', 'explore'].includes(segments[0]!);

  const taxonomyIndex = segments.findIndex((segment) =>
    ['tag', 'tags', 'category', 'categories'].includes(segment),
  );
  if (taxonomyIndex !== -1) {
    const tail = segments.slice(taxonomyIndex + 1);
    // Match a taxonomy root, one taxonomy slug, or its explicit /page/N pagination.
    // A deeper document path may use TAG as an organization name (e.g. W3C TAG).
    // File-like or otherwise ambiguous routes remain eligible for the ordinary checks.
    const slug = tail[0];
    if (
      !tail.length ||
      (slug &&
        !slug.includes('.') &&
        (tail.length === 1 ||
          (tail.length === 3 && tail[1] === 'page' && /^[1-9]\d*$/.test(tail[2]!))))
    )
      return true;
  }
  const last = segments.at(-1);
  if (
    last &&
    ['search', 'feed', 'feeds', 'rss', 'atom', 'feed.xml', 'rss.xml', 'atom.xml'].includes(last)
  )
    return true;
  const archiveIndex = segments.findIndex((segment) => ['archive', 'archives'].includes(segment));
  if (archiveIndex !== -1) {
    const tail = segments.slice(archiveIndex + 1);
    // A bare archive or year/month/day archive is a listing; /archive/article-slug may be full text.
    if (!tail.length || /^\d{4}(?:\/\d{1,2}){0,2}$/.test(tail.join('/'))) return true;
  }
  return false;
}
