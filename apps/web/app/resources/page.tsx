import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { formatEntityType } from '@/lib/resource-presentation';
import {
  getResourceEntries,
  getSeedRelations,
  getSignalEntries,
} from '@/lib/seed-runtime';

export const metadata: Metadata = {
  title: '资源',
  description: 'HZense 科技情报中的公司、产品、模型、标准、论文与数据集。',
  alternates: {
    canonical: '/resources',
  },
  openGraph: {
    title: 'HZense 资源',
    description: '浏览构成科技情报网络的关键实体及其关系。',
    url: '/resources',
    type: 'website',
  },
};

export default async function ResourcesPage() {
  const [entries, relations, signals] = await Promise.all([
    getResourceEntries(),
    getSeedRelations(),
    getSignalEntries(),
  ]);

  const relationCounts = new Map<string, number>();
  for (const relation of relations) {
    relationCounts.set(relation.source, (relationCounts.get(relation.source) ?? 0) + 1);
    relationCounts.set(relation.target, (relationCounts.get(relation.target) ?? 0) + 1);
  }

  const signalCounts = new Map<string, number>();
  for (const signal of signals) {
    for (const entity of signal.entities) {
      signalCounts.set(entity, (signalCounts.get(entity) ?? 0) + 1);
    }
  }

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE RESOURCES</p>
          <h1>理解信号背后的参与者。</h1>
          <p>连接公司、产品、模型、标准、论文与数据集，呈现科技变化发生所依赖的实体网络。</p>
        </section>
        <section className="resources-index-grid" aria-label="资源列表">
          {entries.map((entry) => (
            <Link
              className="resource-index-card"
              href={`/resources/${entry.id}`}
              key={entry.id}
            >
              <div className="resource-index-meta">
                <span>{formatEntityType(entry.type)}</span>
                <small>{entry.status}</small>
              </div>
              <h2>{entry.name}</h2>
              <div className="resource-counts">
                <span>{signalCounts.get(entry.id) ?? 0} 条信号</span>
                <span>{relationCounts.get(entry.id) ?? 0} 条关系</span>
              </div>
              <strong>查看情报脉络 ↗</strong>
            </Link>
          ))}
        </section>
      </main>
    </SiteShell>
  );
}
