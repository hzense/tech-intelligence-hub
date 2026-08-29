import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate, getTopicTitleMap } from '@/lib/content-runtime';
import { formatPercentage, formatSignalType } from '@/lib/signal-presentation';
import { getSignalEntries, getSeedSourceMap } from '@/lib/seed-runtime';

export const metadata: Metadata = {
  title: '信号',
  description: 'HZense 收录并校验的原子科技信号。',
  alternates: {
    canonical: '/signals',
  },
  openGraph: {
    title: 'HZense 信号',
    description: '从研究、产品、市场和政策变化中识别可追溯的科技信号。',
    url: '/signals',
    type: 'website',
  },
};

export default async function SignalsPage() {
  const [entries, sourceMap, topicTitleMap] = await Promise.all([
    getSignalEntries(),
    getSeedSourceMap(),
    getTopicTitleMap(),
  ]);

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE SIGNALS</p>
          <h1>记录变化发生的时刻。</h1>
          <p>每条信号保留来源、时间、强度与置信度，为简报、专题和洞察提供可追溯证据。</p>
        </section>
        <section className="signals-index-grid" aria-label="信号列表">
          {entries.map((entry) => (
            <Link className="signal-index-card" href={`/signals/${entry.id}`} key={entry.id}>
              <div className="signal-index-meta">
                <span>{formatSignalType(entry.type)}</span>
                <time dateTime={entry.occurred_at}>
                  {formatZhDate(entry.occurred_at.slice(0, 10))}
                </time>
              </div>
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              <div className="signal-index-source">
                <span>{sourceMap.get(entry.source_id)?.name ?? entry.source_id}</span>
                <strong>置信度 {formatPercentage(entry.confidence)}</strong>
              </div>
              <div className="topic-row">
                {entry.topics.map((topic) => (
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
