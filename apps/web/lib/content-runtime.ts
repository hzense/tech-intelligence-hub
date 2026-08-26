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
type WeeklyFrontMatter = Extract<FrontMatter, { type: 'weekly' }>;

export type DailyEntry = ContentEntry<DailyFrontMatter>;
export type InsightEntry = ContentEntry<InsightFrontMatter>;
export type TopicEntry = ContentEntry<TopicFrontMatter>;
export type WeeklyEntry = ContentEntry<WeeklyFrontMatter>;

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

function isWeekly(entry: ContentEntry): entry is WeeklyEntry {
  return entry.frontMatter.type === 'weekly';
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

export async function getWeeklyEntries(): Promise<WeeklyEntry[]> {
  return (await getContent())
    .filter(isWeekly)
    .filter((entry) => entry.frontMatter.status === 'published')
    .sort((left, right) => right.frontMatter.week.localeCompare(left.frontMatter.week));
}

export async function getWeeklyEntryByWeek(week: string): Promise<WeeklyEntry | undefined> {
  return (await getWeeklyEntries()).find((entry) => entry.frontMatter.week === week);
}

export async function getDailyEntriesForWeekly(week: string): Promise<DailyEntry[]> {
  const weekly = await getWeeklyEntryByWeek(week);
  if (!weekly) return [];

  const dailyById = new Map(
    (await getDailyEntries()).map((entry) => [entry.frontMatter.id, entry]),
  );
  return weekly.frontMatter.daily_refs.flatMap((id) => {
    const entry = dailyById.get(id);
    return entry ? [entry] : [];
  });
}

export async function getInsightEntries(): Promise<InsightEntry[]> {
  return (await getContent())
    .filter(isInsight)
    .filter((entry) => entry.frontMatter.status === 'published')
    .sort((left, right) => right.frontMatter.date.localeCompare(left.frontMatter.date));
}

export async function getInsightEntryById(id: string): Promise<InsightEntry | undefined> {
  return (await getInsightEntries()).find((entry) => entry.frontMatter.id === id);
}

export async function getTopicEntries(): Promise<TopicEntry[]> {
  return (await getContent())
    .filter(isTopic)
    .filter((entry) => entry.frontMatter.status !== 'archived')
    .sort(
      (left, right) =>
        (right.frontMatter.attention ?? 0) - (left.frontMatter.attention ?? 0) ||
        left.frontMatter.title.localeCompare(right.frontMatter.title, 'zh-CN'),
    );
}

export async function getTopicEntryById(id: string): Promise<TopicEntry | undefined> {
  return (await getTopicEntries()).find((entry) => entry.frontMatter.id === id);
}

export async function getInsightsForTopic(topicId: string): Promise<InsightEntry[]> {
  return (await getInsightEntries()).filter((entry) =>
    entry.frontMatter.topics.includes(topicId),
  );
}

export async function getDailyEntriesForTopic(topicId: string): Promise<DailyEntry[]> {
  return (await getDailyEntries()).filter((entry) =>
    entry.frontMatter.rising_topics.includes(topicId),
  );
}

export async function getTopicTitleMap(): Promise<Map<string, string>> {
  return new Map(
    (await getTopicEntries()).map((entry) => [entry.frontMatter.id, entry.frontMatter.title]),
  );
}

export function formatZhWeek(week: string): string {
  const [year = '0000', weekNumber = '00'] = week.split('-W');
  return `${year} 年第 ${Number(weekNumber)} 周`;
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
