import type { MetadataRoute } from 'next';
import process from 'node:process';
import { readSignalReadMode } from '@/lib/public-signal-reader-core';
import { getInsightEntries, getTopicEntries } from '@/lib/content-runtime';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { resourceHref } from '@/lib/resource-presentation';
import { visibleTopicInsights } from '@/lib/server/topic-insights';
import { unifiedSignalEnabled } from '@/lib/unified-signal-mode';

const siteUrl = 'https://hzense.com';

// Published insight visibility can change when a source Signal is revised or withdrawn.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [insightEntries, exploration, topicEntries] = await Promise.all([
    getInsightEntries(),
    getPublicExploration(),
    getTopicEntries(),
  ]);
  const signalEntries = exploration.signals;
  const publishedTopicInsights = await visibleTopicInsights(signalEntries);

  return [
    {
      url: siteUrl,
      changeFrequency: 'daily',
      priority: 1,
    },
    ...insightEntries.map((entry) => ({
      url: `${siteUrl}/insights/${entry.frontMatter.id}`,
      lastModified: new Date(`${entry.frontMatter.date}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...publishedTopicInsights.map((row) => ({
      url: `${siteUrl}/topics/${row.result.topicIds[0]}/editions/${row.id}`,
      lastModified: new Date(row.published_at),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    {
      url: `${siteUrl}/resources`,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...exploration.entities
      .filter(
        (entity) =>
          entity.signals.length > 0 &&
          (entity.type === 'company' || entity.type === 'institution' || entity.type === 'person'),
      )
      .map((entity) => ({
        url: `${siteUrl}${resourceHref(entity)}`,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      })),
    {
      url: `${siteUrl}/signals`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...signalEntries.map((entry) => ({
      url: `${siteUrl}/signals/${entry.id}`,
      lastModified: new Date(entry.occurred_at),
      changeFrequency:
        unifiedSignalEnabled(process.env) || readSignalReadMode(process.env) === 'database'
          ? ('daily' as const)
          : ('never' as const),
      priority: 0.7,
    })),
    {
      url: `${siteUrl}/topics`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...topicEntries.map((entry) => ({
      url: `${siteUrl}/topics/${entry.frontMatter.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
