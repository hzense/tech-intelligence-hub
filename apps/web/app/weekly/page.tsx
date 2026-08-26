import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import {
  formatZhDate,
  formatZhWeek,
  getTopicTitleMap,
  getWeeklyEntries,
} from '@/lib/content-runtime';

export const metadata: Metadata = {
  title: '每周综述',
  description: 'HZense 对一周关键科技信号的结构化综合与趋势判断。',
  alternates: {
    canonical: '/weekly',
  },
  openGraph: {
    title: 'HZense 每周综述',
    description: '从每日信号中提炼一周真正值得持续关注的变化。',
    url: '/weekly',
    type: 'website',
  },
};

export default async function WeeklyPage() {
  const [entries, topicTitleMap] = await Promise.all([
    getWeeklyEntries(),
    getTopicTitleMap(),
  ]);

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE WEEKLY</p>
          <h1>把一周变化连成趋势。</h1>
          <p>综合每日简报与重点专题，识别跨越单日噪声、值得进入长期判断的科技变化。</p>
        </section>
        <section className="weekly-index-list" aria-label="每周综述列表">
          {entries.map((entry) => (
            <Link
              className="weekly-index-card"
              href={`/weekly/${entry.frontMatter.week}`}
              key={entry.frontMatter.id}
            >
              <div className="weekly-index-period">
                <span>{formatZhWeek(entry.frontMatter.week)}</span>
                <small>
                  {formatZhDate(entry.frontMatter.start_date)} —{' '}
                  {formatZhDate(entry.frontMatter.end_date)}
                </small>
              </div>
              <div>
                <h2>{entry.frontMatter.title}</h2>
                <p>{entry.summary}</p>
                <div className="topic-row">
                  {entry.frontMatter.featured_topics.map((topic) => (
                    <span key={topic}>{topicTitleMap.get(topic) ?? topic}</span>
                  ))}
                </div>
              </div>
              <div className="weekly-index-score">
                <strong>{entry.frontMatter.importance ?? '—'}</strong>
                <span>重要度 / 5</span>
                <small>{entry.frontMatter.signal_count} 条信号</small>
              </div>
            </Link>
          ))}
        </section>
      </main>
    </SiteShell>
  );
}
