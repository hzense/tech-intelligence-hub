/** Private, review-only material. A catalog match is not a publication permit. */
export type MaterialReference = { fragment_id?: string; quote: string };
export type MaterialCandidate = {
  title: string;
  summary: string;
  event_date: string | null;
  event_date_evidence?: MaterialReference[];
  persons: Array<{
    name: string;
    role: string;
    organization: string | null;
    evidence?: MaterialReference[];
  }>;
  organizations: string[];
  claims: Array<{ text: string; evidence: MaterialReference[] }>;
};
export type FormalEntity = { id: string; name: string; aliases?: string[] | null };
export type FormalEvidence = {
  id: string;
  source_url: string;
  excerpt: string;
  allowed_hosts: string[];
};
export type PublicationCatalog = {
  people: FormalEntity[];
  organizations: FormalEntity[];
  topics: Array<{ id: string; name: string }>;
  // The caller must select only verified evidence from active registered sources.
  evidence: FormalEvidence[];
};
export type PublicationMaterialItem = {
  key: string;
  label: string;
  proposed: string;
  status: 'matched' | 'missing' | 'ambiguous' | 'proposed';
  matches: Array<{ id: string; name: string; sourceUrl?: string }>;
  references: MaterialReference[];
  nextStep: string;
};
export type PublicationMaterials = {
  title: string;
  summary: string;
  items: PublicationMaterialItem[];
};
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function matchFormalEntities(name: string, rows: FormalEntity[]) {
  return rows
    .filter((row) =>
      [row.name, ...(row.aliases ?? [])].some((value) => normalized(value) === normalized(name)),
    )
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
export function allowedEvidenceUrl(evidence: FormalEvidence) {
  try {
    const url = new URL(evidence.source_url);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      Array.isArray(evidence.allowed_hosts) &&
      evidence.allowed_hosts.includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export function matchFormalEvidence(references: MaterialReference[], rows: FormalEvidence[]) {
  const quotes = [
    ...new Set(references.map((reference) => reference.quote.trim()).filter(Boolean)),
  ];
  return quotes.length
    ? rows
        .filter(
          (row) => allowedEvidenceUrl(row) && quotes.every((quote) => row.excerpt.includes(quote)),
        )
        .sort((a, b) => a.id.localeCompare(b.id, 'en'))
    : [];
}

export function buildPublicationMaterials(
  candidate: MaterialCandidate,
  catalog: PublicationCatalog,
  topicIds: string[],
): PublicationMaterials {
  const state = (count: number) =>
    count === 1 ? ('matched' as const) : count ? ('ambiguous' as const) : ('missing' as const);
  const entityItem = (
    kind: 'person' | 'organization',
    name: string,
    proposed: string,
    references: MaterialReference[],
  ) => {
    const matches = matchFormalEntities(
      name,
      kind === 'person' ? catalog.people : catalog.organizations,
    );
    return {
      key: `${kind}:${name}`,
      label: kind === 'person' ? '关键人物' : '相关组织',
      proposed,
      status: state(matches.length),
      matches: matches.map(({ id, name }) => ({ id, name })),
      references,
      nextStep:
        matches.length === 1
          ? '已关联正式目录；事件角色和关系仍须独立核验。'
          : matches.length
            ? '存在同名或别名冲突；需先完成实体消歧，不能自动选择第一项。'
            : '需先登记有依据的正式实体及对应档案；本页不会自动建档。',
    };
  };
  const organizations = [
    ...new Set([
      ...candidate.organizations,
      ...candidate.persons.flatMap((person) => (person.organization ? [person.organization] : [])),
    ]),
  ];
  return {
    title: candidate.title,
    summary: candidate.summary,
    items: [
      {
        key: 'event_date',
        label: '事件日期',
        proposed: candidate.event_date ?? '未找到',
        status: candidate.event_date ? 'matched' : 'missing',
        matches: [],
        references: candidate.event_date_evidence ?? [],
        nextStep: candidate.event_date
          ? '使用事件发生日期；日期依据仍须独立核验。'
          : '需补充原文中的事件时间依据，不能使用上传或生成时间。',
      },
      ...candidate.persons.map((person) =>
        entityItem(
          'person',
          person.name,
          [person.name, person.role, person.organization].filter(Boolean).join(' · '),
          person.evidence ?? [],
        ),
      ),
      ...(candidate.persons.length
        ? []
        : [
            {
              key: 'person:missing',
              label: '关键人物',
              proposed: '未找到',
              status: 'missing' as const,
              matches: [],
              references: [],
              nextStep: '至少需要一位有事件原文依据的人物；不得用组织负责人猜测补位。',
            },
          ]),
      ...organizations.map((name) =>
        entityItem(
          'organization',
          name,
          name,
          candidate.persons
            .filter((person) => person.organization === name)
            .flatMap((person) => person.evidence ?? []),
        ),
      ),
      {
        key: 'topics',
        label: '领域分类',
        proposed: '按启用的 Taxonomy 规则匹配',
        status: topicIds.length ? 'matched' : 'missing',
        matches: catalog.topics
          .filter((topic) => topicIds.includes(topic.id))
          .sort((a, b) => a.id.localeCompare(b.id, 'en')),
        references: [],
        nextStep: topicIds.length
          ? '关联已有领域，不创建新的分类。'
          : '需核对正式分类及匹配规则，不能由模型生成任意领域 ID。',
      },
      ...candidate.claims.map((claim, index) => {
        const matches = matchFormalEvidence(claim.evidence, catalog.evidence);
        return {
          key: `claim:${index}`,
          label: `主张 ${index + 1} / 公开证据`,
          proposed: claim.text,
          status: state(matches.length),
          matches: matches.map((row) => ({
            id: row.id,
            name: '已登记核验的公开证据',
            sourceUrl: row.source_url,
          })),
          references: claim.evidence,
          nextStep:
            matches.length === 1
              ? '引用已匹配登记证据；主张真实性、来源许可和反证仍须独立核验。'
              : matches.length
                ? '存在多个证据匹配；需先核对来源和证据归属，不自动消歧。'
                : '需登记并核验可公开来源、使用许可和对应摘录；私有上传内容不能直接转为公开证据。',
        };
      }),
    ],
  };
}
