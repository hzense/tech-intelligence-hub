// Match typography, never aliases: spelling, words and punctuation remain significant.
const typography = (text) =>
  text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u2010-\u2015]/gu, '-')
    .replace(/\s+/gu, ' ');

export function resourceNameMention(name, text) {
  const normalized = typography(name);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[\p{Script=Latin}\p{N}]/u.test(normalized)
    ? '(?<![\\p{Script=Latin}\\p{N}_])'
    : '';
  const right = /[\p{Script=Latin}\p{N}]$/u.test(normalized)
    ? '(?![\\p{Script=Latin}\\p{N}_])'
    : '';
  return new RegExp(`${left}${escaped}${right}`, 'iu').test(typography(text));
}

/**
 * Only prepend an immediately adjacent name at the start of the same clause.
 * Returned text is an unchanged source substring; no cross-fragment search,
 * alias inference, quote correction or new provider request is involved.
 */
export function completeResourceNameEvidence(name, evidence, fragments, otherNames, limit) {
  if (evidence.some(({ quote }) => resourceNameMention(name, quote))) return evidence;
  for (const [index, reference] of evidence.entries()) {
    const text = fragments.get(reference.fragment_id)?.text;
    if (!text || [...reference.quote.trim()].length < 8) continue;
    const start = text.indexOf(reference.quote);
    if (start < 0 || text.indexOf(reference.quote, start + 1) !== -1) continue;
    const end = start + reference.quote.length;
    let from = 0;
    // Clauses, sentences and all line endings are hard boundaries. Conservative
    // splitting intentionally does not interpret names, abbreviations or syntax.
    const boundaries = [...text.matchAll(/[，,；;。！？.!?\r\n]/gu)].map(
      (match) => match.index + match[0].length,
    );
    for (const to of [...boundaries, text.length]) {
      if (start >= from && end <= to) {
        const quote = text.slice(from, to).trim();
        if (
          typography(text.slice(from, start)).trim().toLocaleLowerCase('en-US') ===
            typography(name).toLocaleLowerCase('en-US') &&
          [...quote].length <= limit &&
          quote.includes(reference.quote) &&
          resourceNameMention(name, quote) &&
          !otherNames.some((other) => resourceNameMention(other, quote))
        ) {
          const completed = evidence.map((item, at) =>
            at === index ? { fragment_id: item.fragment_id, quote } : item,
          );
          // Expansion must not manufacture a duplicate of another saved quote.
          if (
            new Set(completed.map((item) => JSON.stringify([item.fragment_id, item.quote])))
              .size === completed.length
          )
            return completed;
        }
        break;
      }
      from = to;
    }
  }
  return evidence;
}
