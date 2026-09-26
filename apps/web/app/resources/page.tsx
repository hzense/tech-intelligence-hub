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
import { formatEntityType } from '@/lib/resource-presentation';
import { formatZhDate } from '@/lib/content-runtime';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '资源',
  description: '从公开信号发现活跃组织及相关人物。',
  alternates: { canonical: '/resources' },
};

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<ExplorationParams>;
}) {
  const [data, params] = await Promise.all([getPublicExploration(), searchParams]);
  const archive = params.archive === '1';
  const q = typeof params.q === 'string' ? params.q.slice(0, 120).trim() : '';
  const allTypes = params.type === 'all';
  const now = new Date();
  const entries = buildPublicEntityDirectory(
    data.signals.filter((signal) => (archive ? !isCurrentSignal(signal) : isCurrentSignal(signal))),
    archive ? data.seedEntities : [],
    now,
  ).filter(
    (entity) =>
      (allTypes || entity.type === 'company' || entity.type === 'institution') &&
      entity.name
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .includes(q.normalize('NFKC').toLocaleLowerCase('zh-CN')),
  );
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE RESOURCES</p>
          <h1>理解信号背后的参与者。</h1>
          <p>
            已登记资源来自公开信号中的组织与人物。仅有名称、尚无实体 ID
            的关联仍在信号页展示，不冒充已登记资源。
          </p>
        </section>
        <nav className={styles.toolbar} aria-label="资源范围">
          <Link
            className={styles.button}
            href="/resources"
            aria-current={!archive ? 'page' : undefined}
          >
            当前组织
          </Link>
          <Link className={styles.button} href="/persons">
            关键人物
          </Link>
          <Link
            className={styles.button}
            href="/resources?archive=1&type=all"
            aria-current={archive ? 'page' : undefined}
          >
            历史资源档案
          </Link>
        </nav>
        <form action="/resources" method="get" className={styles.filters}>
          {archive && <input name="archive" value="1" type="hidden" />}
          <label>
            资源名称
            <input type="search" name="q" maxLength={120} defaultValue={q} />
          </label>
          <label>
            资源类型
            <select name="type" defaultValue={allTypes ? 'all' : 'organizations'}>
              <option value="organizations">组织</option>
              <option value="all">全部资源</option>
            </select>
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              应用筛选
            </button>
            <Link
              className={styles.button}
              href={archive ? '/resources?archive=1&type=all' : '/resources'}
            >
              清除筛选
            </Link>
          </div>
        </form>
        <p className={styles.note}>
          {archive
            ? '历史资源沿用旧实体登记；计数仅对应历史档案，不计入当前活跃度。'
            : `统计截止 ${now.toISOString().slice(0, 10)}（UTC）。每个信号 ID 只计一次；时间依据事件发生时间，未来事件不计入近期活跃度。`}
          共 {entries.length} 项。
        </p>
        {entries.length === 0 ? (
          <p className={styles.empty}>暂无匹配的已登记资源。仅有名称的关联请到信号页查看。</p>
        ) : (
          <section className={styles.grid} aria-label="资源列表">
            {entries.map((entry) => (
              <article className={styles.card} key={entry.id}>
                <span>
                  {archive
                    ? `${formatEntityType(entry.type)} · 历史档案`
                    : entry.type === 'person'
                      ? '人物'
                      : '相关组织'}
                </span>
                <h2>
                  <Link
                    href={
                      entry.type === 'person' ? `/persons/${entry.id}` : `/resources/${entry.id}`
                    }
                  >
                    {entry.name}
                  </Link>
                </h2>
                <p>
                  {archive ? '' : `近 30 天 ${entry.recentCount} 条 · `}共 {entry.signals.length}{' '}
                  条关联信号
                </p>
                {entry.latestAt && <p>最近事件：{formatZhDate(entry.latestAt.slice(0, 10))}</p>}
                {entry.relatedPeople.length ? (
                  <div className={styles.links}>
                    <span>同事件人物：</span>
                    {entry.relatedPeople.slice(0, 3).map((person) => (
                      <Link key={person.id} href={`/persons/${person.id}`}>
                        {person.name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p>
                    {entry.type === 'person'
                      ? '人物关系仅按公开事件展示。'
                      : '暂无公开关联人物资料。'}
                  </p>
                )}
                <Link href={`/resources/${entry.id}`}>查看关联信号 →</Link>
              </article>
            ))}
          </section>
        )}
      </main>
    </SiteShell>
  );
}
