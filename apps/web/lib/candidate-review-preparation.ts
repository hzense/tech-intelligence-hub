import { createHash } from 'node:crypto';

type EvidenceReference = { quote: string };
type Candidate = {
  title: string;
  summary: string;
  event_date: string | null;
  persons: Array<{ name: string; role: string; organization: string | null }>;
  organizations: string[];
  claims: Array<{ text: string; evidence: EvidenceReference[] }>;
};
type EntityRow = { id: string; name: string; aliases?: string[] | null };
type TopicRow = { id: string; name: string };
type EvidenceRow = { id: string; source_url: string; excerpt: string };

export type CandidateReviewDraft = {
  title: string;
  summary: string;
  eventDate: string;
  sourceUrls: string[];
  personIds: string[];
  organizationIds: string[];
  topicIds: string[];
  eventKey: string;
  publicEvidenceIds: string[];
  claims: Array<{ text: string; evidenceId: string }>;
};

export type CandidateReviewPreparation =
  { ready: false; blockers: string[] } | { ready: true; blockers: []; draft: CandidateReviewDraft };

const topicRules: Array<{ id: string; terms: RegExp }> = [
  {
    id: 'topic-language-models',
    terms:
      /(?:large language model|language model|\bllm\b|gpt|chatgpt|claude|gemini|llama|语言模型|大模型)/iu,
  },
  { id: 'topic-multimodal-models', terms: /(?:multimodal|vision-language|多模态)/iu },
  { id: 'topic-reasoning-models', terms: /(?:reasoning model|推理模型)/iu },
  { id: 'topic-small-models', terms: /(?:small language model|\bslm\b|小模型|端侧模型)/iu },
  { id: 'topic-ai-agents', terms: /(?:\bai agents?\b|agentic|智能体)/iu },
  { id: 'topic-tool-use', terms: /(?:tool use|function calling|工具调用)/iu },
  { id: 'topic-agent-memory', terms: /(?:agent memory|智能体记忆)/iu },
  { id: 'topic-multi-agent-systems', terms: /(?:multi-agent|多智能体)/iu },
  { id: 'topic-prompt-injection', terms: /(?:prompt injection|提示词注入)/iu },
  {
    id: 'topic-ai-security',
    terms: /(?:ai security|model security|agent security|模型安全|智能体安全|人工智能安全)/iu,
  },
  { id: 'topic-ai-safety', terms: /(?:ai safety|alignment|人工智能安全性|模型对齐)/iu },
  {
    id: 'topic-inference-infrastructure',
    terms: /(?:inference infrastructure|inference serving|推理基础设施|推理服务)/iu,
  },
  {
    id: 'topic-training-infrastructure',
    terms: /(?:training infrastructure|training cluster|训练基础设施|训练集群)/iu,
  },
  {
    id: 'topic-ai-infrastructure',
    terms: /(?:ai infrastructure|ai data center|人工智能基础设施|智算中心)/iu,
  },
  { id: 'topic-gpu', terms: /(?:\bgpus?\b|图形处理器)/iu },
  { id: 'topic-hbm', terms: /(?:\bhbm\b|high bandwidth memory|高带宽内存)/iu },
  { id: 'topic-dram', terms: /(?:\bdram\b)/iu },
  { id: 'topic-semiconductors', terms: /(?:semiconductor|chipmaker|芯片|半导体)/iu },
  { id: 'topic-humanoid-robotics', terms: /(?:humanoid robot|人形机器人)/iu },
  { id: 'topic-robotics', terms: /(?:robotics|robots?|机器人)/iu },
  { id: 'topic-quantum', terms: /(?:quantum computing|quantum technology|量子计算|量子技术)/iu },
  {
    id: 'topic-cloud-infrastructure',
    terms: /(?:cloud infrastructure|cloud computing|云基础设施|云计算)/iu,
  },
  {
    id: 'topic-autonomous-systems',
    terms: /(?:autonomous systems?|autonomous driving|自动驾驶|自主系统)/iu,
  },
  {
    id: 'topic-energy-technology',
    terms: /(?:energy technology|battery technology|能源技术|电池技术)/iu,
  },
  { id: 'topic-space-technology', terms: /(?:space technology|spaceflight|航天|太空技术)/iu },
  { id: 'topic-biotechnology', terms: /(?:biotechnology|biotech|生物技术)/iu },
  { id: 'topic-cybersecurity', terms: /(?:cybersecurity|cyber security|网络安全)/iu },
  {
    id: 'topic-artificial-intelligence',
    terms: /(?:artificial intelligence|generative ai|machine learning|人工智能|生成式\s*ai)/iu,
  },
];

const normalizedName = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const unique = <T>(items: T[]) => [...new Set(items)];

function entityMatches(name: string, rows: EntityRow[]) {
  const expected = normalizedName(name);
  return rows.filter((row) =>
    [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])].some(
      (value) => normalizedName(value) === expected,
    ),
  );
}

/** Deterministic preparation only. It creates no verification or publication permission. */
export function prepareCandidateReview(
  candidate: Candidate,
  catalog: {
    people: EntityRow[];
    organizations: EntityRow[];
    topics: TopicRow[];
    evidence: EvidenceRow[];
  },
): CandidateReviewPreparation {
  const blockers: string[] = [];
  if (!candidate.event_date) blockers.push('候选缺少有原文依据的事件发生日期。');

  const personIds: string[] = [];
  if (!candidate.persons.length) blockers.push('候选没有关键人物，至少需要一位正式人物实体。');
  for (const person of candidate.persons) {
    const matches = entityMatches(person.name, catalog.people);
    if (matches.length !== 1)
      blockers.push(
        matches.length
          ? `人物“${person.name}”匹配到多个正式实体。`
          : `人物“${person.name}”尚未建立正式实体。`,
      );
    else personIds.push(matches[0]!.id);
  }

  const organizationIds: string[] = [];
  const organizationNames = unique([
    ...candidate.organizations,
    ...candidate.persons.flatMap((person) => (person.organization ? [person.organization] : [])),
  ]);
  for (const organization of organizationNames) {
    const matches = entityMatches(organization, catalog.organizations);
    if (matches.length !== 1)
      blockers.push(
        matches.length
          ? `组织“${organization}”匹配到多个正式实体。`
          : `组织“${organization}”尚未建立正式实体。`,
      );
    else organizationIds.push(matches[0]!.id);
  }

  const activeTopics = new Set(catalog.topics.map((topic) => topic.id));
  const searchable = [
    candidate.title,
    candidate.summary,
    ...candidate.claims.map((claim) => claim.text),
    ...candidate.persons.map((person) => person.role),
    ...organizationNames,
  ].join('\n');
  const topicIds = unique(
    topicRules
      .filter((rule) => activeTopics.has(rule.id) && rule.terms.test(searchable))
      .map((rule) => rule.id),
  ).slice(0, 8);
  if (!topicIds.length) blockers.push('候选尚未唯一归入已启用的正式领域分类。');

  const claims: CandidateReviewDraft['claims'] = [];
  for (const [index, claim] of candidate.claims.entries()) {
    const quotes = unique(
      claim.evidence.map((reference) => reference.quote.trim()).filter(Boolean),
    );
    const matches = catalog.evidence.filter((evidence) =>
      quotes.every((quote) => evidence.excerpt.includes(quote)),
    );
    if (matches.length !== 1)
      blockers.push(
        matches.length
          ? `第 ${index + 1} 条主张匹配到多条已核验公开证据。`
          : `第 ${index + 1} 条主张尚未匹配到已核验公开证据。`,
      );
    else claims.push({ text: claim.text, evidenceId: matches[0]!.id });
  }

  if (blockers.length) return { ready: false, blockers: unique(blockers) };
  const publicEvidenceIds = unique(claims.map((claim) => claim.evidenceId));
  const evidenceById = new Map(catalog.evidence.map((row) => [row.id, row]));
  const sourceUrls = unique(
    publicEvidenceIds.map((id) => evidenceById.get(id)?.source_url).filter(Boolean) as string[],
  );
  const identityHash = createHash('sha256')
    .update(
      JSON.stringify({
        eventDate: candidate.event_date,
        title: candidate.title.normalize('NFKC').trim(),
        personIds: unique(personIds).sort(),
        organizationIds: unique(organizationIds).sort(),
        topicIds: [...topicIds].sort(),
      }),
    )
    .digest('hex')
    .slice(0, 20);
  return {
    ready: true,
    blockers: [],
    draft: {
      title: candidate.title,
      summary: candidate.summary,
      eventDate: candidate.event_date as string,
      sourceUrls,
      personIds: unique(personIds),
      organizationIds: unique(organizationIds),
      topicIds,
      eventKey: `event-${(candidate.event_date as string).replaceAll('-', '')}-${identityHash}`,
      publicEvidenceIds,
      claims,
    },
  };
}

export function publicPreparation(preparation: CandidateReviewPreparation) {
  if (!preparation.ready) return preparation;
  return {
    ready: true as const,
    blockers: [],
    counts: {
      people: preparation.draft.personIds.length,
      organizations: preparation.draft.organizationIds.length,
      topics: preparation.draft.topicIds.length,
      evidence: preparation.draft.publicEvidenceIds.length,
      claims: preparation.draft.claims.length,
    },
  };
}
