import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate } from '@/lib/content-runtime';
import { formatPercentage, formatSignalType } from '@/lib/signal-presentation';
import { getSignalEntryById } from '@/lib/seed-runtime';
import { toUnifiedSignal } from '@/lib/unified-signal-core';

interface SignalDetailProps {
  params: Promise<{ id: string }>;
}

// Empty static params still opt into fallback prerendering. Public readers use
// connection() and must observe publication/withdrawal on every request.
export const dynamic = 'force-dynamic';

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
  const entry = await getSignalEntryById(id);
  if (!entry) notFound();

  const unified = toUnifiedSignal(entry);

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/signals">
          ← 返回全部信号
        </Link>
        <header className="article-header">
          <div className="article-meta">
            <span>{unified.type ? formatSignalType(unified.type) : '未分类'}</span>
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
            {unified.assessment === null ? (
              <p>管理员确认</p>
            ) : (
              <div className="signal-dimension-grid">
                <div>
                  <span>重要度</span>
                  <strong>{unified.assessment.importance}/5</strong>
                </div>
                <div>
                  <span>置信度（新闻可信程度）</span>
                  <strong>{formatPercentage(unified.assessment.confidence)}</strong>
                </div>
                <div>
                  <span>新颖度</span>
                  <strong>{formatPercentage(unified.assessment.novelty)}</strong>
                </div>
              </div>
            )}
          </article>
          <aside className="signal-context-panel">
            <section>
              <span>来源</span>
              {unified.sources.length === 0 ? (
                <p>未提供公开来源链接</p>
              ) : (
                unified.sources.map((item) => (
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
              )}
            </section>
            <section>
              <span>专题</span>
              <div className="context-link-list">
                {unified.topics.map((topic) => (
                  <Link href={`/topics/${topic.id}`} key={topic.id}>
                    {topic.title}
                  </Link>
                ))}
              </div>
            </section>
            <section>
              <span>
                {unified.publication.basis === 'legacy_seed' ? '关联实体' : '关键人物与相关组织'}
              </span>
              <div className="context-link-list">
                {[
                  ...unified.people.map((person) => ({ ...person, kind: 'person' })),
                  ...unified.organizations.map((organization) => ({
                    ...organization,
                    kind: 'organization',
                  })),
                  ...unified.relatedEntities.map((entity) => ({
                    ...entity,
                    eventRole: '',
                    kind: 'entity',
                  })),
                ].map((entity, index) => (
                  <p key={`${entity.id}:${entity.kind}:${index}`}>
                    {entity.id ? (
                      <Link
                        href={
                          entity.kind === 'person'
                            ? `/persons/${entity.id}`
                            : `/resources/${entity.id}`
                        }
                      >
                        {entity.name}
                      </Link>
                    ) : (
                      <span>{entity.name}</span>
                    )}
                    {entity.eventRole ? ` · ${entity.eventRole}` : ''}
                  </p>
                ))}
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
