import 'server-only';
import { getInsightEntries } from '../content-runtime.ts';
import { getPublicExploration } from '../public-exploration-runtime.ts';
import { relatedResourceReports } from '../resource-presentation.ts';
import { visibleTopicInsights } from './topic-insights.ts';

export async function getPublicResourceDetail(id: string) {
  const data = await getPublicExploration();
  const entity = data.entities.find((entry) => entry.id === id);
  if (!entity) return null;
  const [topicReports, fileReports] = await Promise.all([
    visibleTopicInsights(data.signals),
    getInsightEntries(),
  ]);
  return {
    entity,
    topicNames: new Map(data.taxonomy.topics.map((topic) => [topic.id, topic.name])),
    reports: relatedResourceReports(entity, topicReports, fileReports),
  };
}
