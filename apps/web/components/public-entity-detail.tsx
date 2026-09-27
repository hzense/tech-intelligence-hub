import Link from 'next/link';
import { ResourceImage } from './resource-cards';
import { PublicSignalCards } from './public-signal-cards';
import { SiteShell } from './site-shell';
import styles from './resource-directory.module.css';
import { formatZhDate } from '@/lib/content-runtime';
import type { PublicEntitySummary } from '@/lib/public-exploration-core';
import {
  formatEntityType,
  resourceIntroduction,
  resourceMedia,
  resourceProfile,
  resourceTopics,
  resourceTrendObservation,
  type ResourceReportLink,
} from '@/lib/resource-presentation';
import { toUnifiedSignal } from '@/lib/unified-signal-core';

export function PublicEntityDetail({
  entity,
  topicNames,
  reports,
}: {
  entity: PublicEntitySummary;
  topicNames: ReadonlyMap<string, string>;
  reports: readonly ResourceReportLink[];
}) {
  const person = entity.type === 'person';
  const associated = person ? entity.relatedOrganizations : entity.relatedPeople;
  const topics = resourceTopics(entity, topicNames).slice(0, 4);
  const observation = resourceTrendObservation(entity, new Date());
  const latest = entity.signals[0];
  const media = resourceMedia(entity.id);
  const profile = resourceProfile(entity.id);
  const roles = [
    ...new Set(
      entity.signals
        .flatMap((signal) => {
          const unified = toUnifiedSignal(signal);
          return [...unified.people, ...unified.organizations];
        })
        .filter((reference) => reference.id === entity.id)
        .map((reference) => reference.eventRole.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link
          className="back-link"
          href={person ? '/resources#people' : '/resources#organizations'}
        >
          ← 返回资源目录
        </Link>
        <header className="article-header">
          <div className={styles.detailHeader}>
            <ResourceImage entity={entity} />
            <div>
              <p className="kicker">{formatEntityType(entity.type)} · 资源档案</p>
              <h1>{entity.name}</h1>
              <p>{resourceIntroduction(entity)}</p>
            </div>
          </div>
          <div className="brief-stats">
            <span>{entity.signals.length} 条公开关联信号</span>
            <span>{reports.length} 份关联洞察</span>
            {entity.latestAt && <span>最近事件 {formatZhDate(entity.latestAt.slice(0, 10))}</span>}
          </div>
          {profile && (
            <p className={styles.attribution}>
              简介来源：
              <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer">
                查看人物或组织资料
              </a>
              。简介描述资源本身；下方关联数量仅反映本站公开信号。
            </p>
          )}
          {media && (
            <p className={styles.attribution}>
              图像：{media.credit} · {media.license} ·{' '}
              <a href={media.sourceUrl} target="_blank" rel="noopener noreferrer">
                来源与授权
              </a>
              。{person ? '照片' : '标识'}仅用于指认资源，不表示该组织或人物认可本站。
            </p>
          )}
        </header>

        <section className={styles.detailSection} aria-labelledby="resource-trend">
          <h2 id="resource-trend">技术发展趋势观察</h2>
          <div className={styles.observation}>
            <p>
              截至 {observation.asOf.slice(0, 10)}（UTC），该资源关联的公开信号在近 30 天有{' '}
              {observation.recent} 条，前一个 30 天有 {observation.previous} 条。
              这是本站事件覆盖数量，不足以单独判断行业增长或衰退。
            </p>
            {topics.length > 0 ? (
              <p>
                关联议题主要包括{' '}
                {topics.map((topic) => `${topic.name}（${topic.count} 条）`).join('、')}。
                {latest ? `最近一次关联事件为“${latest.title}”。` : ''}
              </p>
            ) : (
              <p>关联信号尚无可用议题映射，暂不推断技术演进方向。</p>
            )}
            {reports[0] ? (
              <p>
                关联报告《<Link href={reports[0].href}>{reports[0].title}</Link>》的摘要：
                {reports[0].summary} 这是相关议题的研判，不等于对该资源的独立评价。
              </p>
            ) : (
              <p>暂无可公开的关联洞察报告；以下信号提供可追溯的事件脉络。</p>
            )}
          </div>
          {roles.length > 0 && (
            <p className={styles.note}>
              公开信号记录的事件角色：{roles.join('、')}；以具体信号为准。
            </p>
          )}
        </section>

        <section className={styles.detailSection} aria-labelledby="resource-signals">
          <h2 id="resource-signals">关联信号 · {entity.signals.length}</h2>
          <p className={styles.note}>
            全部公开记录按事件发生时间排序，各信号保留自身的来源和发布状态。
          </p>
          {entity.signals.length ? (
            <PublicSignalCards signals={entity.signals} />
          ) : (
            <p className={styles.empty}>尚无公开关联信号。</p>
          )}
        </section>

        <section className={styles.detailSection} aria-labelledby="resource-insights">
          <h2 id="resource-insights">关联洞察 · {reports.length}</h2>
          <p className={styles.note}>
            仅关联已公开且引用本资源信号的报告，或明确登记该组织的文件报告；共享信号不代表报告直接评价该人物或组织。
          </p>
          {reports.length ? (
            <div className={styles.reportGrid}>
              {reports.map((report) => (
                <Link className={styles.reportCard} href={report.href} key={report.id}>
                  <span>
                    {report.kind} · {formatZhDate(report.date.slice(0, 10))}
                  </span>
                  <h3>{report.title}</h3>
                  <p>{report.summary}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>暂无符合公开条件的关联洞察报告。</p>
          )}
        </section>

        <section className={styles.detailSection} aria-labelledby="resource-participants">
          <h2 id="resource-participants">{person ? '同事件组织' : '同事件人物'}</h2>
          <p className={styles.note}>同一公开事件出现不等于任职、隶属、合作或持续关系。</p>
          {associated.length ? (
            <div className={styles.relations}>
              {associated.map((reference) => (
                <Link
                  href={person ? `/resources/${reference.id}` : `/persons/${reference.id}`}
                  key={reference.id}
                >
                  {reference.name}
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>暂无可核实 ID 的同事件参与者。</p>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
