import { resolve } from 'node:path';
import { loadContent, type ContentEntry, type FrontMatter } from '@hzense/content';
import { getRadarSnapshots } from './seed-runtime.ts';
import { projectTopicAssessments, type TopicEntry } from './topic-assessments.ts';

type InsightFrontMatter = Extract<FrontMatter, { type: 'insight' }>;
type TopicFrontMatter = Extract<FrontMatter, { type: 'topic' }>;

export type InsightEntry = ContentEntry<InsightFrontMatter>;
export type { TopicEntry } from './topic-assessments.ts';

let contentPromise: ReturnType<typeof loadContent> | undefined;

function getContent() {
  contentPromise ??= loadContent({
    contentRoot: resolve(process.cwd(), '../../content'),
    seedRoot: resolve(process.cwd(), '../../data/seed'),
    taxonomyFile: resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml'),
  });
  return contentPromise;
}

function isInsight(entry: ContentEntry): entry is InsightEntry {
  return entry.frontMatter.type === 'insight';
}

function isTopic(entry: ContentEntry): entry is ContentEntry<TopicFrontMatter> {
  return entry.frontMatter.type === 'topic';
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
  const [content, snapshots] = await Promise.all([getContent(), getRadarSnapshots()]);
  return projectTopicAssessments(content.filter(isTopic), snapshots);
}

export async function getTopicEntryById(id: string): Promise<TopicEntry | undefined> {
  return (await getTopicEntries()).find((entry) => entry.frontMatter.id === id);
}

export async function getInsightsForTopic(topicId: string): Promise<InsightEntry[]> {
  return (await getInsightEntries()).filter((entry) => entry.frontMatter.topics.includes(topicId));
}

export async function getTopicTitleMap(): Promise<Map<string, string>> {
  return new Map(
    (await getTopicEntries()).map((entry) => [entry.frontMatter.id, entry.frontMatter.title]),
  );
}

export function formatZhDate(date: string): string {
  const [year = '0000', month = '00', day = '00'] = date.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}
