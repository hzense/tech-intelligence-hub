import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import {
  formatZhDate,
  formatZhWeek,
  getDailyEntriesForWeekly,
  getTopicTitleMap,
  getWeeklyEntries,
  getWeeklyEntryByWeek,
} from '@/lib/content-runtime';

interface WeeklyDetailProps {
  params: Promise<{ week: string }>;
}

export async function generateStaticParams() {
  return (await getWeeklyEntries()).map((entry) => ({ week: entry.frontMatter.week }));
}

export async function generateMetadata({ params }: WeeklyDetailProps): Promise<Metadata> {
  const { week } = await params;
  const entry = await getWeeklyEntryByWeek(week);
  if (!entry) return {};

  const canonical = `/weekly/${entry.frontMatter.week}`;
  return {
    title: entry.frontMatter.title,
    description: entry.summary,
    alternates: {
      canonical,
    },
    openGraph: {
      title: entry.frontMatter.title,
      description: entry.summary,
      url: canonical,
      type: 'article',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
    },
  };
}

export default async function WeeklyDetailPage({ params }: WeeklyDetailProps) {
  const { week } = await params;
  const [entry, relatedDailyEntries, topicTitleMap] = await Promise.all([
    getWeeklyEntryByWeek(week),
    getDailyEntriesForWeekly(week),
    getTopicTitleMap(),
  ]);
  if (!entry) notFound();

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/weekly">← 返回全部周报</Link>
        <header className="article-header">
          <div className="article-meta">
            <span>HZENSE WEEKLY</span>
            <time dateTime={entry.frontMatter.start_date}>
              {formatZhWeek(entry.frontMatter.week)}
            </time>
          </div>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
          <div className="brief-stats">
            <span>重要度 {entry.frontMatter.importance ?? '—'}/5</span>
            <span>{entry.frontMatter.signal_count} 条信号</span>
            <span>
              {formatZhDate(entry.frontMatter.start_date)} —{' '}
              {formatZhDate(entry.frontMatter.end_date)}
            </span>
          </div>
        </header>
        <article className="weekly-detail-body">
          <section className="weekly-narrative">
            <span>本周判断</span>
            <h2>从信号到趋势</h2>
            <p>{entry.summary}</p>
          </section>
          {entry.sections.map((section) => (
            <section className="weekly-narrative" key={section.heading}>
              <span>专题分析</span>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </article>
        <section className="weekly-related-section">
          <div className="section-heading">
            <div>
              <p className="kicker">关联脉络</p>
              <h2>回到证据与专题。</h2>
            </div>
          </div>
          <div className="weekly-related-grid">
            <div>
              <h3>本周每日简报</h3>
              {relatedDailyEntries.length > 0 ? (
                <div className="related-link-list">
                  {relatedDailyEntries.map((daily) => (
                    <Link
                      href={`/daily/${daily.frontMatter.date}`}
                      key={daily.frontMatter.id}
                    >
                      <span>{formatZhDate(daily.frontMatter.date)}</span>
                      <strong>{daily.frontMatter.title}</strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="related-empty">本周暂无关联每日简报。</p>
              )}
            </div>
            <div>
              <h3>重点专题</h3>
              {entry.frontMatter.featured_topics.length > 0 ? (
                <div className="related-link-list">
                  {entry.frontMatter.featured_topics.map((topic) => (
                    <Link href={`/topics/${topic}`} key={topic}>
                      <span>持续跟踪</span>
                      <strong>{topicTitleMap.get(topic) ?? topic}</strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="related-empty">本周暂无重点专题。</p>
              )}
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
