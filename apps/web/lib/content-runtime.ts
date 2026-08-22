import { resolve } from 'node:path';
import {
  loadContent,
  type ContentEntry,
  type FrontMatter,
  type MarkdownSection,
} from '@hzense/content';

type DailyFrontMatter = Extract<FrontMatter, { type: 'daily' }>;
type InsightFrontMatter = Extract<FrontMatter, { type: 'insight' }>;
type TopicFrontMatter = Extract<FrontMatter, { type: 'topic' }>;

export type DailyEntry = ContentEntry<DailyFrontMatter>;
export type InsightEntry = ContentEntry<InsightFrontMatter>;
export type TopicEntry = ContentEntry<TopicFrontMatter>;

let contentPromise: ReturnType<typeof loadContent> | undefined;

function getContent() {
  contentPromise ??= loadContent({
    contentRoot: resolve(process.cwd(), '../../content'),
    seedRoot: resolve(process.cwd(), '../../data/seed'),
  });
  return contentPromise;
}

function isDaily(entry: ContentEntry): entry is DailyEntry {
  return entry.frontMatter.type === 'daily';
}

function isInsight(entry: ContentEntry): entry is InsightEntry {
  return entry.frontMatter.type === 'insight';
}

function isTopic(entry: ContentEntry): entry is TopicEntry {
  return entry.frontMatter.type === 'topic';
}

export async function getDailyEntries(): Promise<DailyEntry[]> {
  return (await getContent())
    .filter(isDaily)
    .filter((entry) => entry.frontMatter.status === 'published')
    .sort((left, right) => right.frontMatter.date.localeCompare(left.frontMatter.date));
}

export async function getDailyEntryByDate(date: string): Promise<DailyEntry | undefined> {
  return (await getDailyEntries()).find((entry) => entry.frontMatter.date === date);
}

export async function getInsightEntries(): Promise<InsightEntry[]> {
  return (await getContent())
    .filter(isInsight)
    .filter((entry) => entry.frontMatter.status !== 'archived')
    .sort((left, right) => right.frontMatter.date.localeCompare(left.frontMatter.date));
}

export async function getTopicTitleMap(): Promise<Map<string, string>> {
  return new Map(
    (await getContent()).filter(isTopic).map((entry) => [entry.frontMatter.id, entry.frontMatter.title]),
  );
}

export function formatZhDate(date: string): string {
  const [year = '0000', month = '00', day = '00'] = date.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

export function splitSignalHeading(section: MarkdownSection): { category: string; title: string } {
  const [category = '情报信号', ...titleParts] = section.heading.split(/[｜|]/).map((part) => part.trim());
  return {
    category: titleParts.length > 0 ? category : '情报信号',
    title: titleParts.length > 0 ? titleParts.join('｜') : category,
  };
}
