import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { getTopicEntries } from '@/lib/content-runtime';
import {
  formatTopicMaturity,
  formatTopicStatus,
  formatTopicStrategicValue,
  formatTopicTrend,
} from '@/lib/topic-presentation';

export const metadata: Metadata = {
  title: '专题',
  description: 'HZense 持续跟踪的关键科技专题、成熟度、趋势与战略价值。',
  alternates: {
    canonical: '/topics',
  },
  openGraph: {
    title: 'HZense 专题',
    description: '沿着专题脉络持续观察技术变化。',
    url: '/topics',
    type: 'website',
  },
};

export default async function TopicsPage() {
  const entries = await getTopicEntries();

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE 专题</p>
          <h1>持续跟踪技术变化。</h1>
          <p>从关注度、趋势、成熟度和战略价值四个维度，组织值得长期观察的技术方向。</p>
        </section>
        <section className="topics-index-grid" aria-label="专题列表">
          {entries.map((entry) => (
            <Link
              className="topic-index-card"
              href={`/topics/${entry.frontMatter.id}`}
              key={entry.frontMatter.id}
            >
              <div className="topic-index-meta">
                <span>{formatTopicStatus(entry.frontMatter.status)}</span>
                <strong>{entry.frontMatter.attention ?? '—'}</strong>
              </div>
              <h2>{entry.frontMatter.title}</h2>
              <p>{entry.summary}</p>
              <dl className="topic-metric-row">
                <div>
                  <dt>趋势</dt>
                  <dd>{formatTopicTrend(entry.frontMatter.trend)}</dd>
                </div>
                <div>
                  <dt>成熟度</dt>
                  <dd>{formatTopicMaturity(entry.frontMatter.maturity)}</dd>
                </div>
                <div>
                  <dt>战略价值</dt>
                  <dd>{formatTopicStrategicValue(entry.frontMatter.strategic_value)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </section>
      </main>
    </SiteShell>
  );
}
