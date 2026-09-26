import Link from 'next/link';
import { SiteShell } from './site-shell';
import { PublicSignalCards } from './public-signal-cards';
import styles from './public-exploration.module.css';
import { formatZhDate } from '@/lib/content-runtime';
import { isCurrentSignal, type PublicEntitySummary } from '@/lib/public-exploration-core';
import { formatEntityType } from '@/lib/resource-presentation';
import { formatRelationType } from '@/lib/resource-presentation';
import type { SeedRelation, SeedEntity } from '@hzense/content';

export function PublicEntityDetail({
  entity,
  relations = [],
  seedEntities = [],
}: {
  entity: PublicEntitySummary;
  relations?: SeedRelation[];
  seedEntities?: SeedEntity[];
}) {
  const current = entity.signals.filter(isCurrentSignal);
  const archive = entity.signals.filter((signal) => !isCurrentSignal(signal));
  const person = entity.type === 'person';
  const roles = [
    ...new Set(
      current
        .flatMap((signal) =>
          [...(signal.public_people ?? []), ...(signal.public_organizations ?? [])]
            .filter((reference) => reference.id === entity.id)
            .map((reference) => reference.event_role),
        )
        .filter(Boolean),
    ),
  ];
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href={person ? '/persons' : '/resources'}>
          ← 返回{person ? '人物' : '资源'}目录
        </Link>
        <header className="article-header">
          <div className="article-meta">
            <span>
              {person ? '人物' : current.length ? '相关组织' : formatEntityType(entity.type)}
            </span>
            {current.length === 0 && <span>历史档案</span>}
          </div>
          <h1>{entity.name}</h1>
          <p>
            关联来自当前公开信号；同事件出现不代表存在任职、隶属或合作关系。人物同名但 ID
            不同的记录不会自动合并。
          </p>
          <div className="brief-stats">
            <span>{current.length} 条当前信号</span>
            <span>{archive.length} 条历史信号</span>
          </div>
        </header>
        {entity.latestAt && (
          <p className={styles.note}>最近关联事件：{formatZhDate(entity.latestAt.slice(0, 10))}</p>
        )}
        {roles.length > 0 && (
          <p className={styles.note}>
            公开事件中的角色：{roles.join('、')}。具体依据请查看对应信号。
          </p>
        )}
        <section className={styles.group}>
          <h2>{person ? '同事件组织' : '同事件关键人物'}</h2>
          <p>仅展示信号中已公开的关联，不推断当前职务或任职有效期。</p>
          <div className={styles.links}>
            {(person ? entity.relatedOrganizations : entity.relatedPeople).map((reference) => (
              <Link
                className={styles.button}
                key={reference.id}
                href={person ? `/resources/${reference.id}` : `/persons/${reference.id}`}
              >
                {reference.name}
              </Link>
            ))}
          </div>
          {(person ? entity.relatedOrganizations : entity.relatedPeople).length === 0 && (
            <p className={styles.empty}>暂无公开关联资料。</p>
          )}
        </section>
        <section className={styles.group}>
          <h2>当前关联信号</h2>
          {current.length ? (
            <PublicSignalCards signals={current} />
          ) : (
            <p className={styles.empty}>暂无当前公开关联信号。</p>
          )}
        </section>
        {archive.length > 0 && (
          <section className={styles.group}>
            <h2>历史信号档案</h2>
            <p className={styles.note}>保留历史内容与引用，不代表已按新版发布规则核验。</p>
            <PublicSignalCards signals={archive} />
          </section>
        )}
        {relations.length > 0 && (
          <section className={styles.group}>
            <h2>历史实体关系</h2>
            <p className={styles.note}>
              以下为原有资源档案中的关系登记，并非本次事件推导的当前任职关系。
            </p>
            {relations.map((relation) => {
              const source = seedEntities.find((entry) => entry.id === relation.source);
              const target = seedEntities.find((entry) => entry.id === relation.target);
              if (!source || !target) return null;
              return (
                <p className={styles.links} key={relation.id}>
                  <Link href={`/resources/${source.id}`}>{source.name}</Link>
                  <span>{formatRelationType(relation.relation_type)}</span>
                  <Link href={`/resources/${target.id}`}>{target.name}</Link>
                </p>
              );
            })}
          </section>
        )}
      </main>
    </SiteShell>
  );
}
