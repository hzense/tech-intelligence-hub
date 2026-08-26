import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate, getTopicTitleMap } from '@/lib/content-runtime';
import {
  formatPercentage,
  formatSignalType,
  formatSourceType,
} from '@/lib/signal-presentation';
import {
  getSeedEntityMap,
  getSeedSourceMap,
  getSignalEntries,
  getSignalEntryById,
} from '@/lib/seed-runtime';

interface SignalDetailProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return (await getSignalEntries()).map((entry) => ({ id: entry.id }));
}

export async function generateMetadata({ params }: SignalDetailProps): Promise<Metadata> {
  const { id } = await params;
  const entry = await getSignalEntryById(id);
  if (!entry) return {};

  const canonical = `/signals/${entry.id}`;
  return {
    title: entry.title,
    description: entry.summary,
    alternates: {
      canonical,
    },
    openGraph: {
      title: entry.title,
      description: entry.summary,
      url: canonical,
      type: 'article',
      publishedTime: entry.occurred_at,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
    },
  };
}

export default async function SignalDetailPage({ params }: SignalDetailProps) {
  const { id } = await params;
  const [entry, entityMap, sourceMap, topicTitleMap] = await Promise.all([
    getSignalEntryById(id),
    getSeedEntityMap(),
    getSeedSourceMap(),
    getTopicTitleMap(),
  ]);
  if (!entry) notFound();

  const source = sourceMap.get(entry.source_id);

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/signals">← 返回全部信号</Link>
        <header className="article-header">
          <div className="article-meta">
            <span>{formatSignalType(entry.type)}</span>
            <time dateTime={entry.occurred_at}>
              {formatZhDate(entry.occurred_at.slice(0, 10))}
            </time>
          </div>
          <h1>{entry.title}</h1>
          <p>{entry.summary}</p>
        </header>
        <div className="signal-detail-grid">
          <article className="signal-detail-body">
            <span className="topic-section-label">信号判断</span>
            <h2>为什么值得记录</h2>
            <p>{entry.summary}</p>
            <div className="signal-dimension-grid">
              <div><span>重要度</span><strong>{entry.importance}/5</strong></div>
              <div><span>强度</span><strong>{entry.strength}/5</strong></div>
              <div><span>置信度</span><strong>{formatPercentage(entry.confidence)}</strong></div>
              <div><span>新颖度</span><strong>{formatPercentage(entry.novelty)}</strong></div>
            </div>
          </article>
          <aside className="signal-context-panel">
            <section>
              <span>来源</span>
              <strong>{source?.name ?? entry.source_id}</strong>
              <small>
                {source ? formatSourceType(source.type) : '待补充'} · 信任分{' '}
                {source?.trust_score ?? '—'}
              </small>
            </section>
            <section>
              <span>专题</span>
              <div className="context-link-list">
                {entry.topics.map((topic) => (
                  <Link href={`/topics/${topic}`} key={topic}>
                    {topicTitleMap.get(topic) ?? topic}
                  </Link>
                ))}
              </div>
            </section>
            <section>
              <span>关联实体</span>
              <div className="context-link-list">
                {entry.entities.map((entity) => (
                  <Link href={`/resources/${entity}`} key={entity}>
                    {entityMap.get(entity)?.name ?? entity}
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </SiteShell>
  );
}
