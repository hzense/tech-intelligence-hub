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
  const boundary = '\\s*[。.]?\\s*$';
  const relation = new RegExp(
    `${subject}(?:\\s+(?:is|operates as)\\s+|,\\s*|\\s*—\\s*)${modifiers}${englishType}\\b${boundary}|${subject}\\s*(?:是|是一家|是一所|是一个|作为)${chineseModifiers}${chineseType}${boundary}`,
    'iu',
  );
  // Match the ENTIRE evidence quote: no arbitrary comma suffix, later sentence,
  // embedded assertion or newline can silently reverse its meaning. Sources
  // using richer syntax must be reviewed by a human with the complete fragment.
  return !/[\r\n]/u.test(quote.trim()) && relation.test(quote);
}
