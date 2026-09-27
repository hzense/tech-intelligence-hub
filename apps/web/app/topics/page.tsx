import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { TopicInsightCard, type TopicInsightCardEntry } from '@/components/topic-insight-card';
import styles from '@/components/topic-insight-pages.module.css';
import { getInsightEntries, getTopicEntries } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { visibleTopicInsights } from '@/lib/server/topic-insights';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '专题洞察',
  description: '浏览已公开的专题洞察报告与持续跟踪的技术方向。',
  alternates: { canonical: '/topics' },
};

export default async function TopicsPage() {
  const [topics, signals, editorial] = await Promise.all([
    getTopicEntries(),
    getSignalEntries(),
    getInsightEntries(),
  ]);
  const published = await visibleTopicInsights(signals);
  const topicTitles = new Map(
    topics.map((topic) => [topic.frontMatter.id, topic.frontMatter.title]),
  );
  const readableSignalIds = new Set(signals.map((signal) => signal.id));
  const reports: TopicInsightCardEntry[] = [
    ...published.map((row) => ({
      id: row.id,
      href: `/topics/${row.result.topicIds[0]}/editions/${row.id}`,
      title: row.result.report.title,
      summary: row.result.report.summary,
      date: row.published_at.slice(0, 10),
      evidenceCount: row.result.inputs.length,
      topics: row.result.topicIds.map((id) => topicTitles.get(id) ?? id),
    })),
    ...editorial.map((entry) => ({
      id: entry.frontMatter.id,
      href: `/insights/${entry.frontMatter.id}`,
      title: entry.frontMatter.title,
      summary: entry.summary,
      date: entry.frontMatter.date,
      evidenceCount: entry.frontMatter.evidence_signals.filter((id) => readableSignalIds.has(id))
        .length,
      topics: entry.frontMatter.topics.map((id) => topicTitles.get(id) ?? id),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <header className={styles.indexHero}>
          <div>
            <p className={styles.eyebrow}>HZENSE / 专题洞察</p>
            <h1>
              理解变化，
              <br />
              看清方向。
            </h1>
          </div>
          <p>
            从已公开的信号出发，把证据、研判和不确定性汇成可追溯的专题报告。点击卡片阅读完整分析。
          </p>
        </header>

        <section className={styles.catalogSection} aria-labelledby="reports-heading">
          <div className={styles.sectionHeading}>
            <h2 id="reports-heading">洞察报告</h2>
            <p>{reports.length} 份已公开报告 · 按发布日期排序</p>
          </div>
          {reports.length ? (
            <div className={styles.reportGrid}>
              {reports.map((report) => (
                <TopicInsightCard key={report.id} report={report} />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p>暂无已公开的深度报告。专题仍在跟踪；不会把尚未确认的分析作为报告展示。</p>
            </div>
          )}
        </section>

        <section className={styles.catalogSection} aria-labelledby="topics-heading">
          <div className={styles.sectionHeading}>
            <h2 id="topics-heading">跟踪专题</h2>
            <p>这些是持续观察的技术方向；专题简介不等同于已发布的洞察报告。</p>
          </div>
          <div className={styles.topicGrid}>
            {topics.map((topic) => {
              const id = topic.frontMatter.id;
              const signalCount = signals.filter((signal) => signal.topics.includes(id)).length;
              const reportCount =
                published.filter((row) => row.result.topicIds.includes(id)).length +
                editorial.filter((entry) => entry.frontMatter.topics.includes(id)).length;
              return (
                <Link className={styles.topicCard} href={`/topics/${id}`} key={id}>
                  <div className={styles.topicCardTop}>
                    <span>专题 / {topic.frontMatter.title}</span>
                    <span aria-hidden="true">↗</span>
                  </div>
                  <h3>{topic.frontMatter.title}</h3>
                  <p>{topic.summary}</p>
                  <div className={styles.topicCardFooter}>
                    <span>{signalCount} 条关联信号</span>
                    <span>{reportCount} 份报告</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
