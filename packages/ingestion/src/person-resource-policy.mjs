/** This is a person-resource scope rule, not a rule for deleting reported facts. */
export const PERSON_RESOURCE_POLICY_TEXT =
  '人物关联与人物资源不包含国家领导人（国家元首或政府首脑）。即使原文提及或存在事件证据，也不要把这些人物填入 persons；保留信号事实、来源和相关组织。不要用部长、议员、地方领导人或公司负责人凑数；没有其他符合范围且有证据的事件人物时，persons 保持空数组。该排除规则不扩大为排除所有政府官员或企业总裁。';

const excludedIds = new Set([
  'person-xi-jinping',
  'person-li-qiang',
  'person-donald-trump',
  'person-anthony-albanese',
]);

function normalized(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
}

function nameKey(value) {
  return normalized(value).replace(/[\s.\u00b7\u30fb_-]+/gu, '');
}

// Known identities cover records without a job title, including manual name-only input.
const excludedNames = new Set(
  [
    '习近平',
    '習近平',
    'Xi Jinping',
    '李强',
    '李強',
    'Li Qiang',
    'Donald Trump',
    'Donald J. Trump',
    'Donald John Trump',
    '特朗普',
    '唐纳德·特朗普',
    '唐納德·特朗普',
    '川普',
    '唐纳德·川普',
    '唐納德·川普',
    'Anthony Albanese',
    '安东尼·阿尔巴尼斯',
    '安東尼·阿爾巴尼斯',
    '阿尔巴尼斯',
    '阿爾巴尼斯',
  ].map(nameKey),
);

// Common title/name input from the manual editor must not bypass exact aliases.
// Anchor the entire value so an alias embedded in another person's name or a
// sentence is not treated as identity evidence.
const knownNameOffice =
  '(?:(?:us|unitedstates|american|chinese|australian)?president|primeminister(?:of(?:australia|china))?|(?:美国|美國)?(?:总统|總統)|(?:澳大利亚|澳大利亞|澳洲)?(?:总理|總理)|(?:中国|中國)?(?:国家主席|國家主席)|国务院总理|國務院總理)';
const titledKnownName = new RegExp(
  `^(?:${knownNameOffice}[:：]?)?(?:${[...excludedNames].join('|')})(?:(?:${knownNameOffice})|(?:[,，/:：].+)|(?:\\([^()]+\\)))?$`,
  'u',
);
function hasKnownName(value) {
  return titledKnownName.test(nameKey(value));
}

// Keep the title check deliberately narrow. "President" alone also describes
// companies and universities; advisors, deputies and regional heads are not heads of state.
const nonHeadOffice =
  /顾问|顧問|助理|办公室|辦公室|发言人|發言人|特使|候选人|候選人|副总统|副總統|副主席|副总理|副總理|副首相|部长|部長|议员|議員|州长|州長|首席部长|首席部長|记者|記者|公司|企业|企業|集团|集團|大学|大學|协会|協會|研究所|\b(?:advis[eo]r|aide|assistant|spokesperson|envoy|candidate|deputy|vice|chief minister|governor|senator|congress(?:man|woman)|secretary|reporter|journalist|company|corporation|university|association|ceo)\b/iu;

// Explicit country names make "President of Indonesia" a national office but
// not "President of Microsoft" or "President of France Telecom". This list is
// a recognition dictionary, not an assertion about who currently holds office.
const nationalCountries = [
  'united states',
  'united states of america',
  'china',
  'india',
  'indonesia',
  'japan',
  'south korea',
  'republic of korea',
  'vietnam',
  'thailand',
  'malaysia',
  'singapore',
  'philippines',
  'australia',
  'new zealand',
  'united kingdom',
  'france',
  'germany',
  'italy',
  'spain',
  'portugal',
  'ireland',
  'austria',
  'switzerland',
  'netherlands',
  'belgium',
  'denmark',
  'sweden',
  'norway',
  'finland',
  'poland',
  'ukraine',
  'russia',
  'russian federation',
  'turkey',
  'türkiye',
  'israel',
  'saudi arabia',
  'united arab emirates',
  'egypt',
  'south africa',
  'nigeria',
  'kenya',
  'canada',
  'mexico',
  'brazil',
  'argentina',
  'chile',
];
const countryHeadOffice = new RegExp(
  `\\b(?:president|king|queen|chancellor) of (?:the )?(?:${nationalCountries.join('|')})(?=$|[,;:()]|\\s+(?:and|who)\\b)`,
  'iu',
);
const explicitHeadOffice =
  /国家元首|國家元首|政府首脑|政府首腦|国家主席|國家主席|国务院总理|國務院總理|日本天皇|(?:^|[，,:：(])\p{Script=Han}{2,12}(?:总统|總統|总理|總理|首相|国王|國王|女王)|\b(?:head of (?:state|government)|prime minister)\b|\b(?:u\.?s\.?|united states|american|chinese|indian|indonesian|french|russian|brazilian|ukrainian|south korean|mexican) president\b/iu;

function hasHeadOffice(value) {
  return Boolean(
    value &&
    !nonHeadOffice.test(value) &&
    (explicitHeadOffice.test(value) ||
      countryHeadOffice.test(value) ||
      /^(?:总统|總統|总理|總理|首相|国王|國王|女王)$/u.test(value)),
  );
}

/** No inference from an organization, source byline, quote, or article body. */
export function isExcludedPublicPerson(person) {
  if (typeof person === 'string') return hasKnownName(person) || hasHeadOffice(normalized(person));
  if (!person || typeof person !== 'object' || Array.isArray(person)) return false;
  return (
    excludedIds.has(normalized(person.id)) ||
    hasKnownName(person.name) ||
    [person.name, person.role, person.event_role].some((value) => hasHeadOffice(normalized(value)))
  );
}
