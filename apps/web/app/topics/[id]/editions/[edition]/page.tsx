import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { TopicInsightReport } from '@/components/topic-insight-report';
import { getSignalEntries } from '@/lib/seed-runtime';
import { visibleTopicInsights } from '@/lib/server/topic-insights';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; edition: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, edition } = await params;
  return { title: '专题洞察版本', alternates: { canonical: `/topics/${id}/editions/${edition}` } };
}
export default async function InsightEdition({ params }: Props) {
  const { id, edition } = await params;
  const signals = await getSignalEntries();
  const row = (await visibleTopicInsights(signals)).find(
    (r) => r.id === edition && r.result.topicIds.includes(id),
  );
  if (!row) notFound();
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href={`/topics/${id}`}>
          ← 返回专题
        </Link>
        <h1>{row.result.report.title}</h1>
        <TopicInsightReport result={row.result} signals={signals} />
      </main>
    </SiteShell>
  );
}
