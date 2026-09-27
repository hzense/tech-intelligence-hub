import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { SiteShell } from '@/components/site-shell';
import { TopicInsightReport } from '@/components/topic-insight-report';
import styles from '@/components/topic-insight-pages.module.css';
import { formatZhDate } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { visibleTopicInsightById } from '@/lib/server/topic-insights';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; edition: string }> };

const loadEdition = cache(async (id: string, edition: string) => {
  const signals = await getSignalEntries();
  const candidate = await visibleTopicInsightById(edition, signals);
  const row = candidate?.result.topicIds.includes(id) ? candidate : null;
  return { row, signals };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, edition } = await params;
  const { row } = await loadEdition(id, edition);
  return row
    ? {
        title: row.result.report.title,
        description: row.result.report.summary,
        alternates: { canonical: `/topics/${id}/editions/${edition}` },
      }
    : {};
}

export default async function InsightEdition({ params }: Props) {
  const { id, edition } = await params;
  const { row, signals } = await loadEdition(id, edition);
  if (!row) notFound();
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <header className={styles.editionHero}>
          <Link className={styles.backLink} href="/topics">
            ← 所有专题洞察
          </Link>
          <div className={styles.eyebrow}>HZENSE / 深度报告</div>
          <h1>{row.result.report.title}</h1>
          <div className={styles.editionStats}>
            <span>发布于 {formatZhDate(row.published_at.slice(0, 10))}</span>
            <span>分析截止 {formatZhDate(row.result.windowEnd.slice(0, 10))}</span>
            <span>{row.result.inputs.length} 条证据信号</span>
          </div>
        </header>
        <TopicInsightReport result={row.result} signals={signals} />
      </main>
    </SiteShell>
  );
}
