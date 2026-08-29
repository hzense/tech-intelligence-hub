import type { SeedEntity, SeedRadarSnapshot, SeedSignal, SeedSource } from '@hzense/content';
import { getTopicEntries, type TopicEntry } from '@/lib/content-runtime';
import { filterLatestRadarSnapshots, type RadarFilters } from '@/lib/radar-model';
import {
  getRadarSnapshots,
  getResourceEntries,
  getSeedSourceMap,
  getSignalEntries,
} from '@/lib/seed-runtime';

export interface RadarEvidenceSignal {
  signal: SeedSignal;
  source: SeedSource;
}

export interface RadarEntry {
  snapshot: SeedRadarSnapshot;
  topic: TopicEntry;
  evidenceSignals: RadarEvidenceSignal[];
  relatedSignals: SeedSignal[];
  relatedResources: SeedEntity[];
}

export async function getRadarEntries(filters: RadarFilters = {}): Promise<RadarEntry[]> {
  const [snapshots, topics, signals, resources, sourceById] = await Promise.all([
    getRadarSnapshots(),
    getTopicEntries(),
    getSignalEntries(),
    getResourceEntries(),
    getSeedSourceMap(),
  ]);
  const topicById = new Map(topics.map((topic) => [topic.frontMatter.id, topic]));
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  return filterLatestRadarSnapshots(snapshots, filters)
    .map((snapshot) => {
      const topic = topicById.get(snapshot.topic);
      if (!topic) {
        throw new Error(
          `Radar snapshot ${snapshot.id} references unpublished Topic ${snapshot.topic}`,
        );
      }
      const evidenceSignals = snapshot.evidence_signals.map((signalId) => {
        const signal = signalById.get(signalId);
        if (!signal) {
          throw new Error(`Radar snapshot ${snapshot.id} has unavailable evidence ${signalId}`);
        }
        const source = sourceById.get(signal.source_id);
        if (!source) {
          throw new Error(`Radar evidence ${signalId} has unavailable source ${signal.source_id}`);
        }
        return { signal, source };
      });
      const evidenceIds = new Set(snapshot.evidence_signals);
      const relatedSignals = signals.filter(
        (signal) =>
          signal.topics.includes(snapshot.topic) &&
          new Date(signal.occurred_at).toISOString().slice(0, 10) <= snapshot.date &&
          !evidenceIds.has(signal.id),
      );
      const relatedResources = [
        ...new Set(
          [...evidenceSignals.map(({ signal }) => signal), ...relatedSignals].flatMap(
            (signal) => signal.entities,
          ),
        ),
      ].flatMap((id) => {
        const resource = resourceById.get(id);
        return resource ? [resource] : [];
      });
      return { snapshot, topic, evidenceSignals, relatedSignals, relatedResources };
    })
    .sort(
      (left, right) =>
        right.snapshot.attention - left.snapshot.attention ||
        left.topic.frontMatter.title.localeCompare(right.topic.frontMatter.title, 'zh-CN'),
    );
}
