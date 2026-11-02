/** The prose is Chinese; names, product IDs and verbatim evidence keep their original spelling. */
export const SIGNAL_LANGUAGE_RULES =
  '信号标题 title 和摘要 summary 必须分别以中文叙述为主，即使输入资料是英文，也须将核心事实译写为中文。允许保留英文人名、组织名、产品名、型号及技术术语（如 OpenAI、NVIDIA、PyTorch、CUDA），不能输出全英文或以英文句子为主的标题、摘要，也不能仅附加“中文”等字样应付要求。翻译应忠实于原文，保留限定条件和不确定性，不添加事实。证据 quote 必须保持原文原语言并可逐字核对，不为符合中文要求翻译引用；实体原名、来源标题、URL 和固定字段标识保持原样。';

/**
 * A deterministic prose check, not a semantic proper-name classifier. Compare
 * Han characters with foreign word units so that NVIDIA is one name, not six
 * competing characters. A short Chinese event clause may contain several
 * capitalized names. Digits and punctuation are not language evidence.
 * Only apply this policy to new title/summary writes, never historical parsing
 * or verbatim source quotations. Normalization is for counting, not storage.
 */
export function isChineseSignalText(value) {
  if (typeof value !== 'string') return false;
  const text = value.normalize('NFKC');
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (han < 2) return false;
  // Japanese/Korean prose is not Chinese merely because it contains Han text.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
  const foreignWords =
    text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}\p{N}]+)*/gu) ??
    [];
  // Common English news predicates indicate prose rather than a proper name.
  // Weight them more heavily to reject English clauses with a Chinese suffix.
  const englishPredicates = foreignWords.filter((word) =>
    /^(?:announces?|announced|launch(?:es)?|launched|introduces?|introduced|releases?|released|unveils?|unveiled|reports?|reported|says|said|is|are|was|were|has|have|will)$/iu.test(
      word,
    ),
  ).length;
  if (han >= foreignWords.length + englishPredicates * 3) return true;
  // E.g. NVIDIA 发布 Open Agent Safety Platform. Do not require translating
  // multiword product names, but do require an actual Chinese event clause.
  const chineseEventClause =
    /发布|發布|推出|公布|宣布|计划|計劃|收购|收購|融资|融資|合作|签署|簽署|启动|啟動|开源|開源|上线|上線|更新|任命|加入|离职|離職|建设|建設|投产|投產|停产|停產|披露|发生|發生|完成|通过|通過|发现|發現|获批|獲批/u.test(
      text,
    );
  const onlyNameLikeWords = foreignWords.every(
    (word) =>
      /^(?:[A-Z][\p{L}\p{M}\p{N}-]*|[a-z][\p{L}\p{M}-]*[A-Z][\p{L}\p{M}\p{N}-]*|[a-z])$/u.test(
        word,
      ) || /^(?:of|for|and|the|in|to|on|with)$/u.test(word),
  );
  return englishPredicates === 0 && chineseEventClause && onlyNameLikeWords;
}
