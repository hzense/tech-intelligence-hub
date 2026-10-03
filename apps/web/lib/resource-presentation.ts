import type { SeedEntity } from '@hzense/content';
import type { InsightEntry } from './content-runtime.ts';
import type { PublicEntitySummary } from './public-exploration-core.ts';
import type { TopicInsightResult } from './topic-insight-core.ts';
import { organizationProfiles } from './resource-organization-profiles.ts';
import { personProfiles } from './resource-person-profiles.ts';
import { extraResourceMedia } from './resource-media-extra.ts';

export interface ResourceMedia {
  /** A reviewed image of this exact entity, never a name-based image search. */
  url: string;
  sourceUrl: string;
  credit: string;
  license: string;
  kind: 'logo' | 'portrait';
}

// Curated public files. Wikimedia's file pages document identity, author and
// licence; unlisted IDs deliberately receive a typographic placeholder.
const mediaByEntity: Readonly<Record<string, ResourceMedia>> = {
  'company-openai': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/OpenAI_logo_2025_%28symbol%29.svg/330px-OpenAI_logo_2025_%28symbol%29.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:OpenAI_logo_2025_(symbol).svg',
    credit: 'OpenAI',
    license: '著作权及商标说明见来源页',
    kind: 'logo',
  },
  'company-microsoft': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/330px-Microsoft_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Microsoft_logo.svg',
    credit: 'Microsoft',
    license: '著作权及商标说明见来源页',
    kind: 'logo',
  },
  'company-nvidia': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a4/NVIDIA_logo.svg/330px-NVIDIA_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:NVIDIA_logo.svg',
    credit: 'NVIDIA',
    license: '著作权及商标说明见来源页',
    kind: 'logo',
  },
  // Apple is deliberately left as an initial until its cross-jurisdiction
  // reuse status has been checked, rather than declaring it public domain.
  'company-google': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/330px-Google_%22G%22_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Google_%22G%22_logo.svg',
    credit: 'Google',
    license: '著作权及商标说明见来源页',
    kind: 'logo',
  },
  'person-satya-nadella': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Satya_Nadella.jpg/330px-Satya_Nadella.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Satya_Nadella.jpg',
    credit: 'OFFICIAL LEWEB PHOTOS',
    license: 'CC BY 2.0',
    kind: 'portrait',
  },
  'person-lisa-su': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Dr._Lisa_Su.jpg/330px-Dr._Lisa_Su.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Dr._Lisa_Su.jpg',
    credit: 'Deepon',
    license: 'CC BY-SA 4.0',
    kind: 'portrait',
  },
  'person-jensen-huang': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/35/Jensen_Huang_20231109.jpg/330px-Jensen_Huang_20231109.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Jensen_Huang_20231109.jpg',
    credit: '總統府，裁切：Yu tptw',
    license: 'CC BY 2.0',
    kind: 'portrait',
  },
  'person-tim-cook': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/88/Tim_Cook_March_2026_%28cropped%29.jpg/330px-Tim_Cook_March_2026_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tim_Cook_March_2026_(cropped).jpg',
    credit: 'Tessa Bury',
    license: 'CC BY 4.0；使用裁切版',
    kind: 'portrait',
  },
};

export function resourceMedia(id: string): ResourceMedia | undefined {
  return mediaByEntity[id] ?? extraResourceMedia[id];
}

export interface ResourceProfile {
  introduction: string;
  sourceUrl: string;
  sourceUrls?: string[];
}

export function resourceProfile(
  entity: string | Pick<PublicEntitySummary, 'id' | 'profile'>,
): ResourceProfile | undefined {
  const id = typeof entity === 'string' ? entity : entity.id;
  // Existing independently curated introductions are not overwritten by an
  // event-derived generated profile. New identities use their published data.
  return (
    personProfiles[id] ??
    organizationProfiles[id] ??
    (typeof entity === 'string' ? undefined : entity.profile)
  );
}

export function resourceInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1
    ? words
        .slice(0, 2)
        .map((word) => [...word][0] ?? '')
        .join('')
        .toLocaleUpperCase('en')
    : [...name.trim()].slice(0, 2).join('').toLocaleUpperCase('en');
}

export function resourceHref(entity: Pick<PublicEntitySummary, 'id' | 'type'>): string {
  return entity.type === 'person' ? `/persons/${entity.id}` : `/resources/${entity.id}`;
}

export function resourceIntroduction(entity: PublicEntitySummary): string {
  return (
    resourceProfile(entity)?.introduction ??
    `${entity.name}的${entity.type === 'person' ? '身份与履历' : '背景与业务'}简介尚待来源核实。`
  );
}

export function resourceTopics(
  entity: PublicEntitySummary,
  topicNames: ReadonlyMap<string, string>,
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const signal of entity.signals) {
    for (const id of new Set(signal.topics)) {
      if (topicNames.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([id, count]) => ({ id, name: topicNames.get(id)!, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function resourceTrendObservation(entity: PublicEntitySummary, now: Date) {
  const end = now.getTime();
  const day = 86_400_000;
  const recentStart = end - 30 * day;
  const previousStart = end - 60 * day;
  let recent = 0;
  let previous = 0;
  for (const signal of entity.signals) {
    const time = Date.parse(signal.occurred_at);
    if (time <= end && time >= recentStart) recent++;
    else if (time < recentStart && time >= previousStart) previous++;
  }
  return { recent, previous, asOf: now.toISOString() };
}

export interface ResourceReportLink {
  id: string;
  href: string;
  title: string;
  summary: string;
  date: string;
  kind: '已确认专题洞察' | '已发布洞察';
}

/** A shared cited Signal is an auditable connection, not endorsement by the entity. */
export function relatedResourceReports(
  entity: PublicEntitySummary,
  topicReports: readonly { id: string; result: TopicInsightResult }[],
  fileReports: readonly InsightEntry[],
): ResourceReportLink[] {
  const signalIds = new Set(entity.signals.map((signal) => signal.id));
  return [
    ...topicReports.flatMap((row): ResourceReportLink[] =>
      row.result.inputs.some((input) => signalIds.has(input.id)) && row.result.topicIds[0]
        ? [
            {
              id: `topic:${row.id}`,
              href: `/topics/${row.result.topicIds[0]}/editions/${row.id}`,
              title: row.result.report.title,
              summary: row.result.report.summary,
              date: row.result.generatedAt,
              kind: '已确认专题洞察',
            },
          ]
        : [],
    ),
    ...fileReports.flatMap((row): ResourceReportLink[] =>
      row.frontMatter.companies?.includes(entity.id) ||
      row.frontMatter.evidence_signals.some((id) => signalIds.has(id))
        ? [
            {
              id: `file:${row.frontMatter.id}`,
              href: `/insights/${row.frontMatter.id}`,
              title: row.frontMatter.title,
              summary: row.summary,
              date: row.frontMatter.date,
              kind: '已发布洞察',
            },
          ]
        : [],
    ),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

const entityTypeLabels = {
  person: '人物',
  company: '公司',
  institution: '机构',
  technology: '技术',
  product: '产品',
  model: '模型',
  dataset: '数据集',
  standard_protocol: '标准与协议',
  paper: '论文',
  event: '事件',
} satisfies Record<SeedEntity['type'], string>;

const relationTypeLabels: Record<string, string> = {
  works_at: '任职于',
  founded: '创立',
  leads: '领导',
  advises: '顾问',
  invests_in: '投资',
  acquired: '收购',
  invested_in: '被投资',
  partnered_with: '合作',
  competes_with: '竞争',
  supplies: '供应',
  customer_of: '客户',
  develops: '开发',
  owns: '拥有',
  uses: '使用',
  integrates: '集成',
  commercializes: '商业化',
  employs: '雇佣',
  researches: '研究',
  created: '创建',
  collaborates_with: '协作',
  authored_by: '作者',
  published_by: '发布者',
  supports: '支持',
  challenges: '挑战',
  related_to: '关联',
  mentions: '提及',
  influences: '影响',
  depends_on: '依赖',
  part_of: '属于',
  trained_on: '训练于',
  evaluated_on: '评测于',
  implements: '实现',
  conforms_to: '遵循',
  successor_of: '继任',
  version_of: '版本',
  presented_at: '发布于',
  organized_by: '组织者',
  announced_at: '宣布于',
};

export function formatEntityType(value: SeedEntity['type']): string {
  return entityTypeLabels[value];
}

export function formatRelationType(value: string): string {
  return relationTypeLabels[value] ?? value.replaceAll('_', ' ');
}
