import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate, getInsightEntries, getTopicTitleMap } from '@/lib/content-runtime';

export const metadata: Metadata = {
  title: '洞察',
  description: 'HZense 对关键科技信号的深入分析与独立判断。',
  alternates: {
    canonical: '/insights',
  },
  openGraph: {
    title: 'HZense 洞察',
    description: '把分散的科技信号转化为可追溯的判断。',
    url: '/insights',
    type: 'website',
  },
};

export default async function InsightsPage() {
  const [entries, topicTitleMap] = await Promise.all([getInsightEntries(), getTopicTitleMap()]);

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE 洞察</p>
          <h1>把信号转化为判断。</h1>
          <p>围绕关键技术变化形成结构化分析，并保留专题、证据信号与判断依据之间的关联。</p>
        </section>
        <section className="insights-index-grid" aria-label="洞察列表">
          {entries.map((entry) => (
            <Link
              className="insight-index-card"
              href={`/insights/${entry.frontMatter.id}`}
              key={entry.frontMatter.id}
            >
              <div className="insight-index-meta">
                <span>重要度 {entry.frontMatter.importance}/5</span>
                <time dateTime={entry.frontMatter.date}>
                  {formatZhDate(entry.frontMatter.date)}
                </time>
              </div>
              <h2>{entry.frontMatter.title}</h2>
              <p>{entry.summary}</p>
              <div className="topic-row">
                {entry.frontMatter.topics.map((topic) => (
                  <span key={topic}>{topicTitleMap.get(topic) ?? topic}</span>
                ))}
              </div>
            </Link>
          ))}
        </section>
      </main>
    </SiteShell>
  );
}
