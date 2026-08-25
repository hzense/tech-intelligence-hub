import type { MetadataRoute } from 'next';
import { getDailyEntries, getInsightEntries } from '@/lib/content-runtime';

const siteUrl = 'https://hzense.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [dailyEntries, insightEntries] = await Promise.all([
    getDailyEntries(),
    getInsightEntries(),
  ]);

  return [
    {
      url: siteUrl,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${siteUrl}/daily`,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...dailyEntries.map((entry) => ({
      url: `${siteUrl}/daily/${entry.frontMatter.date}`,
      lastModified: new Date(`${entry.frontMatter.date}T00:00:00Z`),
      changeFrequency: 'never' as const,
      priority: 0.7,
    })),
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
  ];
}
