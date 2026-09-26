import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import styles from '@/components/public-exploration.module.css';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import {
  buildPublicEntityDirectory,
  isCurrentSignal,
  type ExplorationParams,
} from '@/lib/public-exploration-core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '关键人物',
  description: '已公开科技信号中的关键人物及关联事件。',
  alternates: { canonical: '/persons' },
};
export default async function PersonsPage({
  searchParams,
}: {
  searchParams: Promise<ExplorationParams>;
}) {
  const [data, params] = await Promise.all([getPublicExploration(), searchParams]);
  const q = typeof params.q === 'string' ? params.q.slice(0, 120).trim() : '';
  const people = buildPublicEntityDirectory(data.signals.filter(isCurrentSignal)).filter(
    (entry) =>
      entry.type === 'person' &&
      entry.name
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .includes(q.normalize('NFKC').toLocaleLowerCase('zh-CN')),
  );
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE PEOPLE</p>
          <h1>在事件中理解关键人物。</h1>
          <p>
            已登记人物按近 30 天公开关联信号数排序。同名不自动合并；仅有姓名的关联保留在信号页。
          </p>
        </section>
        <nav className={styles.toolbar}>
          <Link className={styles.button} href="/resources">
            组织与资源
          </Link>
          <Link className={styles.button} href="/signals">
            探索信号
          </Link>
        </nav>
        <form method="get" action="/persons" className={styles.filters}>
          <label>
            人物姓名
            <input type="search" name="q" maxLength={120} defaultValue={q} />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              查询人物
            </button>
            <Link className={styles.button} href="/persons">
              清除筛选
            </Link>
          </div>
        </form>
        <p className={styles.note}>共 {people.length} 位人物。</p>
        {people.length === 0 ? (
          <p className={styles.empty}>暂无匹配的公开人物资料。</p>
        ) : (
          <section className={styles.grid} aria-label="人物列表">
            {people.map((person) => (
              <article className={styles.card} key={person.id}>
                <h2>
                  <Link href={`/persons/${person.id}`}>{person.name}</Link>
                </h2>
                <p>
                  近 30 天 {person.recentCount} 条 · 共 {person.signals.length} 条公开信号
                </p>
                <div className={styles.links}>
                  <span>同事件组织：</span>
                  {person.relatedOrganizations.map((organization) => (
                    <Link key={organization.id} href={`/resources/${organization.id}`}>
                      {organization.name}
                    </Link>
                  ))}
                </div>
                <Link href={`/persons/${person.id}`}>查看关联事件 →</Link>
              </article>
            ))}
          </section>
        )}
      </main>
    </SiteShell>
  );
}
