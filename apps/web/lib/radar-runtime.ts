import type { SeedEntity, SeedRadarSnapshot, SeedSignal } from '@hzense/content';
import { getTopicEntries, type TopicEntry } from '@/lib/content-runtime';
import { filterLatestRadarSnapshots, type RadarFilters } from '@/lib/radar-model';
import { getRadarSnapshots, getResourceEntries, getSignalEntries } from '@/lib/seed-runtime';

export interface RadarEntry {
  snapshot: SeedRadarSnapshot;
  topic: TopicEntry;
  signals: SeedSignal[];
  resources: SeedEntity[];
}

export async function getRadarEntries(filters: RadarFilters = {}): Promise<RadarEntry[]> {
  const [snapshots, topics, signals, resources] = await Promise.all([
    getRadarSnapshots(),
    getTopicEntries(),
    getSignalEntries(),
    getResourceEntries(),
  ]);
  const topicById = new Map(topics.map((topic) => [topic.frontMatter.id, topic]));
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  return filterLatestRadarSnapshots(snapshots, filters)
    .flatMap((snapshot) => {
      const topic = topicById.get(snapshot.topic);
      if (!topic) return [];
      const relatedSignals = signals.filter((signal) => signal.topics.includes(snapshot.topic));
      const relatedResources = [
        ...new Set(relatedSignals.flatMap((signal) => signal.entities)),
      ].flatMap((id) => {
        const resource = resourceById.get(id);
        return resource ? [resource] : [];
      });
      return [{ snapshot, topic, signals: relatedSignals, resources: relatedResources }];
    })
    .sort(
      (left, right) =>
        right.snapshot.attention - left.snapshot.attention ||
        left.topic.frontMatter.title.localeCompare(right.topic.frontMatter.title, 'zh-CN'),
    );
}
