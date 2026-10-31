/**
 * Publication dates derived only from the pinned source text. These are evidence
 * hints, not a new source contract or a reason to rewrite historical candidates.
 */
const months = new Map(
  [
    ['jan', 'january'],
    ['feb', 'february'],
    ['mar', 'march'],
    ['apr', 'april'],
    ['may'],
    ['jun', 'june'],
    ['jul', 'july'],
    ['aug', 'august'],
    ['sep', 'sept', 'september'],
    ['oct', 'october'],
    ['nov', 'november'],
    ['dec', 'december'],
  ].flatMap((names, index) => names.map((name) => [name, index + 1])),
);

function calendarDate(year, month, day) {
  const values = [year, month, day].map(Number);
  if (values[0] < 1000 || values[0] > 9999) return null;
  const date = new Date(Date.UTC(values[0], values[1] - 1, values[2]));
  if (
    date.getUTCFullYear() !== values[0] ||
    date.getUTCMonth() + 1 !== values[1] ||
    date.getUTCDate() !== values[2]
  )
    return null;
  return `${values[0]}-${String(values[1]).padStart(2, '0')}-${String(values[2]).padStart(2, '0')}`;
}

function parseDate(text) {
  const value = text.trim().replace(/[。.]$/, '');
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (match) return calendarDate(match[1], match[2], match[3]);
  match = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(value);
  if (match) return calendarDate(match[1], match[2], match[3]);
  match = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  if (match && months.has(match[1].toLowerCase()))
    return calendarDate(match[3], months.get(match[1].toLowerCase()), match[2]);
  match = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(value);
  return match && months.has(match[2].toLowerCase())
    ? calendarDate(match[3], months.get(match[2].toLowerCase()), match[1])
    : null;
}

function paragraphs(text) {
  let offset = 0;
  const result = [];
  for (const piece of text.split(/(\r?\n[ \t]*\r?\n)/)) {
    const trimmed = piece.trim();
    if (trimmed) {
      const start = offset + piece.indexOf(trimmed);
      result.push({ text: trimmed, start, end: start + trimmed.length });
    }
    offset += piece.length;
  }
  return result;
}

const readingTime = /^(?:\d{1,3}\s+min(?:ute)?s?\.?\s+read|\d{1,3}\s*分钟阅读)$/i;
const publicationLabel =
  /^(?:published(?:\s+(?:on|at))?|publication\s+date|date\s+published|originally\s+published(?:\s+on)?|first\s+published(?:\s+on)?|发布日期|发布时间|首次发布时间|首次发布(?:于)?|首发(?:时间|日期|于)?|(?:本文|文章)?发表于)\s*[:：]?\s*(.+)$/i;
const updateLabel =
  /^(?:(?:last\s+)?(?:updated|modified)\b|更新(?:时间|日期|于)?|最后更新|修订(?:时间|日期|于)?)/i;
const dateMetadata = (text) => publicationLabel.test(text) || updateLabel.test(text);

function metadataDate(value) {
  const plain = parseDate(value);
  if (plain) return plain;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i.exec(
      value,
    );
  // Preserve the date explicitly written by the publisher, not a timezone-shifted date.
  return match ? parseDate(match[1]) : null;
}

function articleMetadataScopes(source) {
  const articles = new Map();
  for (const fragment of source.fragments) {
    const region = fragment.locator?.region;
    const match =
      typeof region === 'string' &&
      /^html article ([1-9]\d{0,5}); (publication metadata|paragraphs \d+-\d+|paragraph \d+ chars \d+-\d+)$/.exec(
        region,
      );
    if (!match) continue;
    const article = articles.get(match[1]) ?? { metadata: [], body: [] };
    article[match[2] === 'publication metadata' ? 'metadata' : 'body'].push(fragment);
    articles.set(match[1], article);
  }
  const hints = [],
    boundFragments = new Set();
  for (const { metadata, body } of articles.values()) {
    if (!metadata.length) continue;
    for (const fragment of body) boundFragments.add(fragment.id);
    const dates = new Set();
    let evidence = null,
      invalid = false;
    for (const fragment of metadata) {
      const match = /^(?:article:published_time|datePublished|time\[datetime\]): ([^\r\n]+)$/.exec(
        fragment.text,
      );
      const date = match ? metadataDate(match[1]) : null;
      if (!date || [...fragment.text].length > 500) {
        invalid = true;
        continue;
      }
      dates.add(date);
      evidence ??= { fragment_id: fragment.id, quote: fragment.text };
    }
    // A contradictory visible publication label invalidates the metadata fallback.
    for (const fragment of body) {
      for (const part of paragraphs(fragment.text)) {
        const match = publicationLabel.exec(part.text);
        if (!match) continue;
        const date = metadataDate(match[1]);
        if (date) dates.add(date);
        else invalid = true;
      }
    }
    if (invalid || dates.size !== 1 || !evidence || !body.length) continue;
    hints.push({
      date: [...dates][0],
      evidence,
      kind: 'article_metadata',
      fragmentIds: new Set(body.map(({ id }) => id)),
    });
  }
  return { hints, boundFragments };
}

function scopes(source) {
  const { hints: found, boundFragments } = articleMetadataScopes(source);
  for (const fragment of source.fragments) {
    // Conflicting article metadata cannot be bypassed by a narrower label fallback.
    if (boundFragments.has(fragment.id)) continue;
    const parts = paragraphs(fragment.text);
    const hasCardFooter = parts.some((part) => readingTime.test(part.text));
    // A bare card-footer date cannot resolve mixed published/updated metadata.
    // Do not reinterpret a metadata paragraph as the card's title or summary.
    const hasDateMetadata = parts.some((part) => dateMetadata(part.text));
    for (let index = 2; index + 1 < parts.length; index++) {
      const footer = parts[index];
      if (!readingTime.test(footer.text)) continue;
      const title = parts[index - 2],
        body = parts[index - 1],
        datePart = parts[index + 1];
      const date = parseDate(datePart.text);
      const quote = fragment.text.slice(footer.start, datePart.end);
      // Recognize a compact news card, not an arbitrary date elsewhere on a page.
      if (
        !date ||
        hasDateMetadata ||
        title.text.length < 8 ||
        title.text.length > 800 ||
        body.text.length < 16 ||
        body.text.length > 5000 ||
        [...quote].length > 500 ||
        parseDate(title.text) ||
        parseDate(body.text) ||
        readingTime.test(title.text) ||
        readingTime.test(body.text)
      )
        continue;
      found.push({
        date,
        evidence: {
          fragment_id: fragment.id,
          quote,
        },
        kind: 'news_card',
        start: title.start,
        end: datePart.end,
        bodyEnd: body.end,
      });
    }
    // A page/card date must never become a fallback for other cards. Explicit
    // labels are confined to their own fragment and are ignored in card lists.
    if (hasCardFooter) continue;
    for (const [index, part] of parts.entries()) {
      const match = publicationLabel.exec(part.text);
      const date = match ? parseDate(match[1]) : null;
      // Only a compact article excerpt: [optional title], publication label,
      // one body paragraph. Extra paragraphs may be another undated article;
      // never make a fragment-wide fallback from a single publication label.
      const body = parts[index + 1];
      if (
        !date ||
        [...part.text].length > 500 ||
        !body ||
        index > 1 ||
        (index === 1 &&
          (dateMetadata(parts[0].text) ||
            parseDate(parts[0].text) ||
            readingTime.test(parts[0].text))) ||
        parts.length !== index + 2 ||
        body.text.length < 16 ||
        /^#{1,6}\s/.test(body.text) ||
        dateMetadata(body.text) ||
        parseDate(body.text)
      )
        continue;
      found.push({
        date,
        evidence: { fragment_id: fragment.id, quote: part.text },
        kind: 'label',
        start: body.start,
        end: body.end,
        labelStart: part.start,
        labelEnd: part.end,
      });
    }
  }
  return found;
}

export function collectSourcePublicationDates(source) {
  return scopes(source).map(({ date, evidence, kind, fragmentIds }) => ({
    date,
    evidence,
    kind,
    ...(fragmentIds ? { fragment_ids: [...fragmentIds] } : {}),
  }));
}

function referenceDates(reference, fragments, hints) {
  const text = fragments.get(reference.fragment_id);
  if (!text || !reference.quote) return null;
  const matching = hints.filter((hint) =>
    hint.kind === 'article_metadata'
      ? hint.fragmentIds.has(reference.fragment_id)
      : hint.evidence.fragment_id === reference.fragment_id,
  );
  if (!matching.length) return null;
  const dates = new Map();
  let from = 0,
    occurrences = 0;
  for (;;) {
    const start = text.indexOf(reference.quote, from);
    if (start === -1) break;
    const end = start + reference.quote.length;
    const attached = matching.filter(
      (hint) =>
        hint.kind === 'article_metadata' ||
        (start >= hint.start &&
          end <= hint.end &&
          (hint.kind === 'news_card'
            ? start < hint.bodyEnd
            : !(start >= hint.labelStart && end <= hint.labelEnd))),
    );
    // Repeated quotes outside a dated card, or quotes spanning unrelated cards,
    // cannot establish which news item the claim belongs to.
    if (!attached.length) return null;
    for (const hint of attached) dates.set(hint.date, hint);
    occurrences++;
    from = start + 1;
  }
  return occurrences && dates.size === 1 ? [...dates.values()][0] : null;
}

/** Called only for newly generated, already validated candidates; no read-time repair. */
export function completeSourcePublicationDates(result, source) {
  const hints = scopes(source);
  if (!hints.length) return result;
  const fragments = new Map(source.fragments.map(({ id, text }) => [id, text]));
  const candidates = result.candidates.map((candidate) => {
    if (candidate.date_basis !== 'source_published' || candidate.event_date !== null)
      return candidate;
    const dates = new Map();
    const articleScopes = new Set();
    let hasLocalScope = false;
    for (const claim of candidate.claims) {
      if (!claim.evidence.length) return candidate;
      for (const reference of claim.evidence) {
        const hint = referenceDates(reference, fragments, hints);
        if (!hint) return candidate;
        if (hint.kind === 'article_metadata') articleScopes.add(hint.evidence.fragment_id);
        else hasLocalScope = true;
        dates.set(hint.date, hint);
      }
    }
    if (dates.size !== 1 || articleScopes.size > 1 || (articleScopes.size && hasLocalScope))
      return candidate;
    const hint = [...dates.values()][0];
    return {
      ...candidate,
      event_date: hint.date,
      event_date_evidence: [{ ...hint.evidence }],
      issues: candidate.issues.filter((issue) => issue !== 'needs_event_time'),
    };
  });
  return { ...result, candidates };
}
