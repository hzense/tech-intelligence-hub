import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import process from 'node:process';
import { readSignalReadMode } from '@/lib/public-signal-reader-core';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate, getTopicTitleMap } from '@/lib/content-runtime';
import { formatPercentage, formatSignalType, formatSourceType } from '@/lib/signal-presentation';
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
  if (readSignalReadMode(process.env) === 'database') return [];
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED === '1') return [];
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
        <Link className="back-link" href="/signals">
          ← 返回全部信号
        </Link>
        <header className="article-header">
          <div className="article-meta">
            <span>{formatSignalType(entry.type)}</span>
            <time dateTime={entry.occurred_at}>{formatZhDate(entry.occurred_at.slice(0, 10))}</time>
          </div>
          <h1>{entry.title}</h1>
          <p>{entry.summary}</p>
        </header>
        <div className="signal-detail-grid">
          <article className="signal-detail-body">
            <span className="topic-section-label">信号判断</span>
            <h2>为什么值得记录</h2>
            <p>{entry.analysis ?? entry.summary}</p>
            {entry.publication_basis === 'manual_confirmation' ? (
              <p>管理员确认</p>
            ) : (
              <div className="signal-dimension-grid">
                <div>
                  <span>重要度</span>
                  <strong>{entry.importance}/5</strong>
                </div>
                <div>
                  <span>强度</span>
                  <strong>{entry.strength}/5</strong>
                </div>
                <div>
                  <span>置信度</span>
                  <strong>{formatPercentage(entry.confidence)}</strong>
                </div>
                <div>
                  <span>新颖度</span>
                  <strong>{formatPercentage(entry.novelty)}</strong>
                </div>
              </div>
            )}
          </article>
          <aside className="signal-context-panel">
            <section>
              <span>来源</span>
              {entry.public_sources?.length === 0 ? <p>未提供公开来源链接</p> : null}
              {entry.public_sources ? (
                entry.public_sources.map((item) => (
                  <a
                    key={`${item.id}:${item.url}`}
                    className="signal-source-link"
                    href={item.url}
                    rel="noopener noreferrer"
                    target="_blank"
                    aria-label={`${item.name} 原始来源（在新窗口打开）`}
                  >
                    <strong>{item.name}</strong>
                    <small>查看原始来源 ↗</small>
                  </a>
                ))
              ) : (
                <>
                  <a
                    aria-label={`${source?.name ?? entry.source_id} 原始来源（在新窗口打开）`}
                    className="signal-source-link"
                    href={entry.source_url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <strong>{source?.name ?? entry.source_id}</strong>
                    <small>查看原始来源 ↗</small>
                  </a>
                  <small>
                    {source ? formatSourceType(source.type) : '待补充'} · 信任分{' '}
                    {source?.trust_score ?? '—'}
                  </small>
                </>
              )}
            </section>
            <section>
              <span>专题</span>
              <div className="context-link-list">
                {entry.topics.map((topic) => (
                  <Link href={`/topics/${topic}`} key={topic}>
                    {entry.public_topics
                      ? (entry.public_topics.find((item) => item.id === topic)?.title ?? topic)
                      : (topicTitleMap.get(topic) ?? topic)}
                  </Link>
                ))}
              </div>
            </section>
            <section>
              <span>{entry.public_people ? '关键人物与相关组织' : '关联实体'}</span>
              <div className="context-link-list">
                {entry.public_people ? (
                  [...entry.public_people, ...(entry.public_organizations ?? [])].map(
                    (person, index) => (
                      <p key={`${person.id}:${person.event_role}:${index}`}>
                        <strong>{person.name}</strong>
                        {person.event_role ? ` · ${person.event_role}` : ''}
                      </p>
                    ),
                  )
                ) : (
                  <>
                    {entry.entities.map((entity) => (
                      <Link href={`/resources/${entity}`} key={entity}>
                        {entityMap.get(entity)?.name ?? entity}
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </section>
            {entry.public_version ? (
              <section>
                <span>当前公开版本</span>
                <p>
                  内容 v{entry.public_version} · 发布修订 {entry.publication_revision}
                </p>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </SiteShell>
  );
}
