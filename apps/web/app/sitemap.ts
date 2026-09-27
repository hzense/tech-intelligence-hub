import type { MetadataRoute } from 'next';
import process from 'node:process';
import { readSignalReadMode } from '@/lib/public-signal-reader-core';
import { getResourceEntries, getSignalEntries } from '@/lib/seed-runtime';
import { getInsightEntries, getTopicEntries } from '@/lib/content-runtime';

const siteUrl = 'https://hzense.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [insightEntries, resourceEntries, signalEntries, topicEntries] = await Promise.all([
    getInsightEntries(),
    getResourceEntries(),
    getSignalEntries(),
    getTopicEntries(),
  ]);

  return [
    {
      url: siteUrl,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${siteUrl}/insights`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...insightEntries.map((entry) => ({
      url: `${siteUrl}/insights/${entry.frontMatter.id}`,
      lastModified: new Date(`${entry.frontMatter.date}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    {
      url: `${siteUrl}/resources`,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...resourceEntries.map((entry) => ({
      url: `${siteUrl}/resources/${entry.id}`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    {
      url: `${siteUrl}/radar`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/signals`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...signalEntries.map((entry) => ({
      url: `${siteUrl}/signals/${entry.id}`,
      lastModified: new Date(entry.occurred_at),
      changeFrequency:
        readSignalReadMode(process.env) === 'database' ? ('daily' as const) : ('never' as const),
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
