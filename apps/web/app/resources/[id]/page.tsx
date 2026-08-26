import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate } from '@/lib/content-runtime';
import {
  formatEntityType,
  formatRelationType,
} from '@/lib/resource-presentation';
import {
  getRelationsForEntity,
  getResourceEntries,
  getResourceEntryById,
  getSeedEntityMap,
  getSignalsForEntity,
} from '@/lib/seed-runtime';

interface ResourceDetailProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return (await getResourceEntries()).map((entry) => ({ id: entry.id }));
}

export async function generateMetadata({ params }: ResourceDetailProps): Promise<Metadata> {
  const { id } = await params;
  const entry = await getResourceEntryById(id);
  if (!entry) return {};

  const description = `HZense 中与 ${entry.name} 相关的科技信号和实体关系。`;
  const canonical = `/resources/${entry.id}`;
  return {
    title: entry.name,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: entry.name,
      description,
      url: canonical,
      type: 'website',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
    },
  };
}

export default async function ResourceDetailPage({ params }: ResourceDetailProps) {
  const { id } = await params;
  const [entry, entityMap, relations, signals] = await Promise.all([
    getResourceEntryById(id),
    getSeedEntityMap(),
    getRelationsForEntity(id),
    getSignalsForEntity(id),
  ]);
  if (!entry) notFound();

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/resources">← 返回全部资源</Link>
        <header className="article-header">
          <div className="article-meta">
            <span>{formatEntityType(entry.type)}</span>
            <span>{entry.status}</span>
          </div>
          <h1>{entry.name}</h1>
          <p>沿着已校验的关系与信号，查看该实体在 HZense 科技情报网络中的位置。</p>
          <div className="brief-stats">
            <span>{signals.length} 条关联信号</span>
            <span>{relations.length} 条实体关系</span>
          </div>
        </header>
        <div className="resource-detail-grid">
          <section className="resource-detail-section">
            <div className="section-heading">
              <div>
                <p className="kicker">关联信号</p>
                <h2>它出现在哪些变化中。</h2>
              </div>
            </div>
            {signals.length > 0 ? (
              <div className="resource-signal-list">
                {signals.map((signal) => (
                  <Link href={`/signals/${signal.id}`} key={signal.id}>
                    <span>{formatZhDate(signal.occurred_at.slice(0, 10))}</span>
                    <strong>{signal.title}</strong>
                    <small>{signal.summary}</small>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="related-empty">暂无公开关联信号。</p>
            )}
          </section>
          <section className="resource-detail-section">
            <div className="section-heading">
              <div>
                <p className="kicker">实体关系</p>
                <h2>它与谁相连。</h2>
              </div>
            </div>
            {relations.length > 0 ? (
              <div className="resource-relation-list">
                {relations.map((relation) => {
                  const source = entityMap.get(relation.source);
                  const target = entityMap.get(relation.target);
                  return (
                    <div key={relation.id}>
                      <Link href={`/resources/${relation.source}`}>
                        {source?.name ?? relation.source}
                      </Link>
                      <span>{formatRelationType(relation.relation_type)}</span>
                      <Link href={`/resources/${relation.target}`}>
                        {target?.name ?? relation.target}
                      </Link>
                      <small>置信度 {Math.round(relation.confidence * 100)}%</small>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="related-empty">暂无公开实体关系。</p>
            )}
          </section>
        </div>
      </main>
    </SiteShell>
  );
}
