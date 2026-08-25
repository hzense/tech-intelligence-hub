import type { MetadataRoute } from 'next';
import { getDailyEntries } from '@/lib/content-runtime';

const siteUrl = 'https://hzense.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dailyEntries = await getDailyEntries();

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
  ];
}
