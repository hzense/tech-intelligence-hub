import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import {
  formatZhDate,
  getDailyEntriesForTopic,
  getInsightsForTopic,
  getTopicEntries,
  getTopicEntryById,
} from '@/lib/content-runtime';
import {
  formatTopicMaturity,
  formatTopicStatus,
  formatTopicStrategicValue,
  formatTopicTrend,
} from '@/lib/topic-presentation';

interface TopicDetailProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return (await getTopicEntries()).map((entry) => ({ id: entry.frontMatter.id }));
}

export async function generateMetadata({ params }: TopicDetailProps): Promise<Metadata> {
  const { id } = await params;
  const entry = await getTopicEntryById(id);
  if (!entry) return {};

  const canonical = `/topics/${entry.frontMatter.id}`;
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
      type: 'website',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
    },
  };
}

export default async function TopicDetailPage({ params }: TopicDetailProps) {
  const { id } = await params;
  const [entry, relatedInsights, relatedDailyEntries] = await Promise.all([
    getTopicEntryById(id),
    getInsightsForTopic(id),
    getDailyEntriesForTopic(id),
  ]);
  if (!entry) notFound();

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/topics">
          ← 返回全部专题
        </Link>
        <header className="article-header">
          <div className="article-meta">
            <span>HZENSE 专题</span>
            <span>{formatTopicStatus(entry.frontMatter.status)}</span>
          </div>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
        </header>
        <div className="topic-detail-grid">
          <article className="topic-overview">
            <span className="topic-section-label">专题脉络</span>
            <h2>为什么值得持续关注</h2>
            <p>{entry.summary}</p>
            {entry.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
          </article>
          <aside className="topic-metrics-panel" aria-label="专题指标">
            <div>
              <span>关注度</span>
              <strong>{entry.frontMatter.attention ?? '—'}</strong>
            </div>
            <dl>
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
          </aside>
        </div>
        <section className="topic-related-section">
          <div className="section-heading">
            <div>
              <p className="kicker">关联情报</p>
              <h2>沿专题继续阅读。</h2>
            </div>
          </div>
          <div className="topic-related-grid">
            <div>
              <h3>深度洞察</h3>
              {relatedInsights.length > 0 ? (
                <div className="related-link-list">
                  {relatedInsights.map((insight) => (
                    <Link href={`/insights/${insight.frontMatter.id}`} key={insight.frontMatter.id}>
                      <span>{formatZhDate(insight.frontMatter.date)}</span>
                      <strong>{insight.frontMatter.title}</strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="related-empty">相关洞察正在形成。</p>
              )}
            </div>
            <div>
              <h3>每日简报</h3>
              {relatedDailyEntries.length > 0 ? (
                <div className="related-link-list">
                  {relatedDailyEntries.map((daily) => (
                    <Link href={`/daily/${daily.frontMatter.date}`} key={daily.frontMatter.id}>
                      <span>{formatZhDate(daily.frontMatter.date)}</span>
                      <strong>{daily.frontMatter.title}</strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="related-empty">暂无关联简报。</p>
              )}
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
