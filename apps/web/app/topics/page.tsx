import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { TopicInsightCard, type TopicInsightCardEntry } from '@/components/topic-insight-card';
import { TopicInsightCatalog } from '@/components/topic-insight-catalog';
import styles from '@/components/topic-insight-pages.module.css';
import { getInsightEntries, getLeafTopicIds, getTopicEntries } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { visibleTopicInsights } from '@/lib/server/topic-insights';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '专题洞察',
  description: '按专题浏览已公开的洞察报告，了解技术变化、支持证据与不确定性。',
  alternates: { canonical: '/topics' },
};

export default async function TopicsPage() {
  const [topics, signals, editorial, leafTopicIds] = await Promise.all([
    getTopicEntries(),
    getSignalEntries(),
    getInsightEntries(),
    getLeafTopicIds(),
  ]);
  const published = await visibleTopicInsights(signals);
  const topicTitles = new Map(
    topics.map((topic) => [topic.frontMatter.id, topic.frontMatter.title]),
  );
  const readableSignalIds = new Set(signals.map((signal) => signal.id));
  const reports: (TopicInsightCardEntry & { topicIds: string[] })[] = [
    ...published.map((row) => ({
      id: row.id,
      href: `/topics/${row.result.topicIds[0]}/editions/${row.id}`,
      title: row.result.report.title,
      summary: row.result.report.summary,
      date: row.published_at.slice(0, 10),
      evidenceCount: row.result.inputs.length,
      topics: row.result.topicIds.map((id) => ({
        id,
        name: topicTitles.get(id),
        isLeaf: leafTopicIds.has(id),
      })),
      topicIds: row.result.topicIds,
    })),
    ...editorial.map((entry) => ({
      id: entry.frontMatter.id,
      href: `/insights/${entry.frontMatter.id}`,
      title: entry.frontMatter.title,
      summary: entry.summary,
      date: entry.frontMatter.date,
      evidenceCount: entry.frontMatter.evidence_signals.filter((id) => readableSignalIds.has(id))
        .length,
      topics: entry.frontMatter.topics.map((id) => ({
        id,
        name: topicTitles.get(id),
        isLeaf: leafTopicIds.has(id),
      })),
      topicIds: entry.frontMatter.topics,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const signalCounts = new Map<string, number>();
  const reportCounts = new Map<string, number>();
  for (const signal of signals) {
    for (const id of new Set(signal.topics)) signalCounts.set(id, (signalCounts.get(id) ?? 0) + 1);
  }
  for (const report of reports) {
    for (const id of new Set(report.topicIds))
      reportCounts.set(id, (reportCounts.get(id) ?? 0) + 1);
  }
  const trackedTopics = topics
    .map((topic) => ({
      id: topic.frontMatter.id,
      title: topic.frontMatter.title,
      summary: topic.summary,
      signalCount: signalCounts.get(topic.frontMatter.id) ?? 0,
      reportCount: reportCounts.get(topic.frontMatter.id) ?? 0,
    }))
    .filter((topic) => topic.signalCount > 0 || topic.reportCount > 0)
    .sort(
      (a, b) =>
        b.reportCount - a.reportCount ||
        b.signalCount - a.signalCount ||
        a.title.localeCompare(b.title, 'zh-CN'),
    );
  const topicCards = trackedTopics.map((topic) => (
    <Link
      className={styles.trackedCard}
      href={`/topics/${topic.id}`}
      key={topic.id}
      prefetch={false}
    >
      <div className={styles.trackedCardHeading}>
        <h3>{topic.title}</h3>
        <span aria-hidden="true">↗</span>
      </div>
      <p>{topic.summary}</p>
      <div className={styles.trackedCardCounts}>
        <span>{topic.signalCount} 条关联信号</span>
        <span>{topic.reportCount} 份报告</span>
      </div>
    </Link>
  ));

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <header className={styles.indexHero}>
          <div>
            <p className={styles.eyebrow}>HZENSE / INSIGHTS</p>
            <h1>专题洞察</h1>
          </div>
          <p>从技术信号中理解变化。按专题阅读报告，追溯证据、研判与不确定性。</p>
        </header>

        <section className={styles.trackingSection} aria-labelledby="tracking-heading">
          <div className={styles.sectionHeading}>
            <h2 id="tracking-heading">跟踪专题</h2>
            <p>进入专题，查看关联信号与洞察报告。</p>
          </div>
          {trackedTopics.length ? (
            <>
              <div className={styles.trackedGrid}>{topicCards.slice(0, 6)}</div>
              {trackedTopics.length > 6 ? (
                <details className={styles.moreTrackedTopics}>
                  <summary>其余 {trackedTopics.length - 6} 个专题</summary>
                  <div className={styles.trackedGrid}>{topicCards.slice(6)}</div>
                </details>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyState}>
              <p>暂无有公开信号或报告的专题。</p>
            </div>
          )}
        </section>

        <TopicInsightCatalog
          topics={topics.map((topic) => ({
            id: topic.frontMatter.id,
            title: topic.frontMatter.title,
          }))}
          reports={reports.map((report) => ({
            id: report.id,
            topicIds: report.topicIds,
            card: <TopicInsightCard report={report} />,
          }))}
        />
      </main>
    </SiteShell>
  );
}
