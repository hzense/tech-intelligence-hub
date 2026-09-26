import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { PublicSignalCards } from '@/components/public-signal-cards';
import styles from '@/components/public-exploration.module.css';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import {
  buildPublicEntityDirectory,
  isCurrentSignal,
  nameOnlySignalFilters,
  parseSignalFilters,
  selectSignals,
  signalDomainIds,
  signalFilterHref,
  type ExplorationParams,
} from '@/lib/public-exploration-core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '信号',
  description: '按事件时间、领域、人物、组织和关键词探索已公开科技信号。',
  alternates: { canonical: '/signals' },
};

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<ExplorationParams>;
}) {
  const [data, params] = await Promise.all([getPublicExploration(), searchParams]);
  const filters = parseSignalFilters(params);
  const result = selectSignals(data.signals, filters, data.taxonomy.topics, data.seedEntities);
  const scope = data.signals.filter((entry) =>
    filters.archive ? !isCurrentSignal(entry) : isCurrentSignal(entry),
  );
  const entities = buildPublicEntityDirectory(scope, filters.archive ? data.seedEntities : []);
  const namedPeople = nameOnlySignalFilters(scope, 'person');
  const namedOrganizations = nameOnlySignalFilters(scope, 'organization');
  const domains = data.taxonomy.topics.filter((topic) => !topic.parentId);
  const groups = new Map<string, typeof result.entries>();
  for (const entry of result.entries) {
    const keys =
      filters.view === 'timeline'
        ? [entry.occurred_at.slice(0, 10)]
        : filters.view === 'domain'
          ? signalDomainIds(entry, data.taxonomy.topics)
          : ['信号列表'];
    for (const key of keys.length ? keys : ['未归类'])
      groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE SIGNALS</p>
          <h1>记录变化发生的时刻。</h1>
          <p>从同一份公开信号探索事实、人物和组织；所有筛选条件保存在网址中。</p>
        </section>
        <nav className={styles.toolbar} aria-label="信号范围">
          <Link
            className={styles.button}
            href="/signals"
            aria-current={!filters.archive ? 'page' : undefined}
          >
            当前公开信号
          </Link>
          <Link
            className={styles.button}
            href="/signals?archive=1"
            aria-current={filters.archive ? 'page' : undefined}
          >
            历史档案
          </Link>
        </nav>
        <p className={styles.note}>
          {filters.archive
            ? '历史档案保留原始内容与引用，不参与当前趋势和活跃度；不代表已按新版发布规则核验。'
            : '仅展示当前公开版本；管理员确认不等同于独立来源核验。撤回内容不保留在筛选或关联统计中。'}
        </p>
        <form className={styles.filters} action="/signals" method="get">
          {filters.archive && <input type="hidden" name="archive" value="1" />}
          <label>
            全文关键词
            <input
              type="search"
              name="q"
              maxLength={120}
              defaultValue={filters.q}
              placeholder="标题、摘要、人物、组织"
            />
          </label>
          <label>
            附加关键词
            <input
              type="search"
              name="keyword"
              maxLength={120}
              defaultValue={filters.keyword}
              placeholder="与其它条件取交集"
            />
          </label>
          <label>
            事件开始日期（UTC）
            <input type="date" name="from" defaultValue={filters.from} />
          </label>
          <label>
            事件结束日期（UTC，含当日）
            <input type="date" name="to" defaultValue={filters.to} />
          </label>
          <label>
            领域
            <select name="domain" defaultValue={filters.domain}>
              <option value="">全部领域</option>
              {domains.map((topic) => (
                <option value={topic.id} key={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            专题
            <select name="topic" defaultValue={filters.topic}>
              <option value="">全部专题</option>
              {data.taxonomy.topics.map((topic) => (
                <option value={topic.id} key={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            关键人物
            <select name="person" defaultValue={filters.person}>
              <option value="">全部人物</option>
              {entities
                .filter((entity) => entity.type === 'person')
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              {namedPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}（按名称）
                </option>
              ))}
            </select>
          </label>
          <label>
            相关组织
            <select name="organization" defaultValue={filters.organization}>
              <option value="">全部组织</option>
              {entities
                .filter((entity) => entity.type === 'company' || entity.type === 'institution')
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              {namedOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}（按名称）
                </option>
              ))}
            </select>
          </label>
          <label>
            展示方式
            <select name="view" defaultValue={filters.view}>
              <option value="list">紧凑列表</option>
              <option value="timeline">事件时间线</option>
              <option value="domain">按领域聚合</option>
            </select>
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              应用筛选
            </button>
            <Link
              className={styles.button}
              href={filters.archive ? '/signals?archive=1' : '/signals'}
            >
              清除筛选
            </Link>
          </div>
        </form>
        <p className={styles.note}>
          共 {result.total} 条匹配信号，按事件发生时间倒序。每页最多 12
          条，分页继续读取当前公开状态。
        </p>
        {filters.view === 'domain' && (
          <p className={styles.note}>
            同一跨领域信号可出现在多个组中，组数之和不等于去重总数。尚无经核验的趋势快照，不为单条信号虚构趋势标签。
          </p>
        )}
        {filters.view === 'domain' && result.total > 0 && (
          <div className={styles.toolbar}>
            {domains.map((domain) => {
              const count = result.matched.filter((entry) =>
                signalDomainIds(entry, data.taxonomy.topics).includes(domain.id),
              ).length;
              return count ? (
                <span key={domain.id}>
                  {domain.name}：{count}
                </span>
              ) : null;
            })}
          </div>
        )}
        {filters.invalid || result.invalidCursor ? (
          <p className={styles.empty}>
            日期范围或分页参数无效。请调整筛选，或
            <Link href={signalFilterHref(filters, { cursor: undefined })}>返回第一页</Link>。
          </p>
        ) : result.entries.length === 0 ? (
          <p className={styles.empty}>
            {result.scopeCount === 0
              ? filters.archive
                ? '暂无历史档案。'
                : '尚无当前公开信号。候选内容须经管理员确认发布后才会展示。'
              : '没有匹配这些条件的信号。请调整筛选，或返回第一页。'}
          </p>
        ) : (
          [...groups].map(([key, entries]) => (
            <section className={styles.group} key={key} aria-label={key}>
              <h2>{domains.find((domain) => domain.id === key)?.name ?? key}</h2>
              <PublicSignalCards signals={entries} />
            </section>
          ))
        )}
        <nav className={styles.toolbar} aria-label="信号分页">
          {filters.cursor && (
            <Link className={styles.button} href={signalFilterHref(filters, { cursor: undefined })}>
              返回第一页
            </Link>
          )}
          {result.nextCursor && (
            <Link
              className={styles.button}
              href={signalFilterHref(filters, { cursor: result.nextCursor })}
            >
              下一页 →
            </Link>
          )}
        </nav>
      </main>
    </SiteShell>
  );
}
