import type { ContentEntry, FrontMatter, SeedRadarSnapshot } from '@hzense/content';
import { filterLatestRadarSnapshots } from './radar-model.ts';

type TopicDocument = ContentEntry<Extract<FrontMatter, { type: 'topic' }>>;

export type TopicEntry = TopicDocument & {
  assessment: SeedRadarSnapshot | undefined;
};

// Topic Markdown owns editorial content, not scores. Never fall back to legacy metrics.
export function projectTopicAssessments(
  topics: readonly TopicDocument[],
  snapshots: readonly SeedRadarSnapshot[],
): TopicEntry[] {
  const latestByTopic = new Map(
    filterLatestRadarSnapshots(snapshots).map((snapshot) => [snapshot.topic, snapshot]),
  );
  return topics
    .filter((topic) => topic.frontMatter.status !== 'archived')
    .map((topic) => ({ ...topic, assessment: latestByTopic.get(topic.frontMatter.id) }))
    .sort(
      (left, right) =>
        (right.assessment?.attention ?? -1) - (left.assessment?.attention ?? -1) ||
        left.frontMatter.title.localeCompare(right.frontMatter.title, 'zh-CN'),
    );
}
