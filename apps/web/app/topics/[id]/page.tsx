import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { TopicInsightCard, type TopicInsightCardEntry } from '@/components/topic-insight-card';
import styles from '@/components/topic-insight-pages.module.css';
import { formatZhDate, getInsightsForTopic, getTopicEntryById } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { visibleTopicInsights } from '@/lib/server/topic-insights';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await getTopicEntryById((await params).id);
  return entry
    ? {
        title: `${entry.frontMatter.title} · 专题洞察`,
        description: entry.summary,
        alternates: { canonical: `/topics/${entry.frontMatter.id}` },
      }
    : {};
}

export default async function TopicDetailPage({ params }: Props) {
  const { id } = await params;
  const [entry, signals, editorial] = await Promise.all([
    getTopicEntryById(id),
    getSignalEntries(),
    getInsightsForTopic(id),
  ]);
  if (!entry) notFound();
  const topicSignals = signals
    .filter((signal) => signal.topics.includes(id))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
  const published = (await visibleTopicInsights(signals)).filter((row) =>
    row.result.topicIds.includes(id),
  );
  const readableSignalIds = new Set(signals.map((signal) => signal.id));
  const reports: TopicInsightCardEntry[] = [
    ...published.map((row) => ({
      id: row.id,
      href: `/topics/${id}/editions/${row.id}`,
      title: row.result.report.title,
      summary: row.result.report.summary,
      date: row.published_at.slice(0, 10),
      evidenceCount: row.result.inputs.length,
      topics: [entry.frontMatter.title],
    })),
    ...editorial.map((report) => ({
      id: report.frontMatter.id,
      href: `/insights/${report.frontMatter.id}`,
      title: report.frontMatter.title,
      summary: report.summary,
      date: report.frontMatter.date,
      evidenceCount: report.frontMatter.evidence_signals.filter((signalId) =>
        readableSignalIds.has(signalId),
      ).length,
      topics: [entry.frontMatter.title],
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <header className={styles.topicHero}>
          <Link className={styles.backLink} href="/topics">
            ← 所有专题洞察
          </Link>
          <div className={styles.eyebrow}>持续跟踪 / 技术专题</div>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
          <div className={styles.topicStats}>
            <span>{topicSignals.length} 条关联信号</span>
            <span>{reports.length} 份公开报告</span>
          </div>
        </header>

        <section className={styles.catalogSection} aria-labelledby="topic-reports-heading">
          <div className={styles.sectionHeading}>
            <h2 id="topic-reports-heading">专题报告</h2>
            <p>每份报告保留自己的分析时间、证据信号与不确定性。</p>
          </div>
          {reports.length ? (
            <div className={styles.reportGrid}>
              {reports.map((report) => (
                <TopicInsightCard key={report.id} report={report} />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>尚无已公开的深度报告；这里不会用专题简介代替分析结论。</p>
            </div>
          )}
        </section>

        <section className={styles.catalogSection} aria-labelledby="topic-signals-heading">
          <div className={styles.sectionHeading}>
            <h2 id="topic-signals-heading">关联信号</h2>
            <p>最近 {Math.min(topicSignals.length, 12)} 条 · 按事件发生时间排序</p>
          </div>
          {topicSignals.length ? (
            <div className={styles.signalLinks}>
              {topicSignals.slice(0, 12).map((signal) => (
                <Link key={signal.id} href={`/signals/${signal.id}`}>
                  <time dateTime={signal.occurred_at}>
                    {formatZhDate(signal.occurred_at.slice(0, 10))}
                  </time>
                  <strong>{signal.title}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>暂无关联的公开信号。</p>
            </div>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
