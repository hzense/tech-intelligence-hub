export type OrganizationType = 'company' | 'institution';
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentionsOrganization(text: string, name: string) {
  const left = /^[\p{Script=Latin}\p{N}]/u.test(name) ? '(?<![\\p{Script=Latin}\\p{N}_])' : '';
  const right = /[\p{Script=Latin}\p{N}]$/u.test(name) ? '(?![\\p{Script=Latin}\\p{N}_])' : '';
  return new RegExp(`${left}${escape(name)}${right}`, 'u').test(text);
}

/** Conservative grammatical relations, not keyword co-occurrence. Unrecognized
 * wording can go through evidence-bound human review, never an automatic guess. */
export function supportsOrganizationType(quote: string, name: string, type: OrganizationType) {
  const englishType =
    type === 'company'
      ? '(?:company|corporation|firm|(?:investment|commercial) bank)'
      : '(?:institution|institute|university|research (?:institute|institution|organization)|nonprofit organization)';
  const modifiers =
    '(?:(?:a|an|the|leading|global|independent|international|American|Chinese|AI|artificial intelligence|technology|research|software|private|public|financial services|investment banking|investment management|advisory|non-profit)\\s+){0,8}';
  const chineseType =
    type === 'company'
      ? '(?:公司|企业|投资银行|商业银行)'
      : '(?:机构|研究所|大学|研究机构|非营利组织)';
  const chineseModifiers =
    '(?:(?:一家|一所|一个|全球|领先的?|独立的?|国际|美国|中国|人工智能|科技|研究|软件|私营|公立|金融服务|投资管理|非营利性?)){0,8}';
  // Only a direct subject at the start of a statement can introduce a type.
  // Embedded claims ("Assuming X is...", "The claim that X is...") are not
  // assertions by the source. Unrecognized grammar is left to human review.
  const subject = `^\\s*${escape(name)}`;
  const boundary = '(?=\\s*(?:$|[,，]))';
  const relation = new RegExp(
    `${subject}(?:\\s+(?:is|operates as)\\s+|,\\s*|\\s*—\\s*)${modifiers}${englishType}\\b${boundary}|${subject}\\s*(?:是|是一家|是一所|是一个|作为)${chineseModifiers}${chineseType}${boundary}`,
    'iu',
  );
  // Never carry a type across a sentence or negation/uncertainty. Protect dots in
  // an exact entity name (e.g. Example Inc.) before splitting sentences.
  const protectedQuote = quote.split(name).join(name.replaceAll('.', '\uE000'));
  return protectedQuote.split(/[。！？!?;；\n.]/u).some((part) => {
    const sentence = part.replaceAll('\uE000', '.');
    if (
      /[?？]/u.test(quote) ||
      /\b(?:not|never|isn't|isn’t|might|may|could|would|if|whether|formerly|allegedly|assuming|assume|suppose|supposing|hypothetically|denied|false|untrue|incorrect|disputed)\b|并非|不是|不再是|可能|据称|曾经|假设|如果|倘若|否认|不属|并不是|不成立/u.test(
        quote.toLowerCase(),
      )
    )
      return false;
    return relation.test(sentence);
  });
}
