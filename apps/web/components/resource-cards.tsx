import Image from 'next/image';
import Link from 'next/link';
import type { PublicEntitySummary } from '@/lib/public-exploration-core';
import {
  formatEntityType,
  resourceHref,
  resourceInitials,
  resourceIntroduction,
  resourceMedia,
  resourceProfile,
  resourceTopics,
} from '@/lib/resource-presentation';
import styles from './resource-directory.module.css';

export function ResourceImage({
  entity,
  decorative = false,
}: {
  entity: PublicEntitySummary;
  decorative?: boolean;
}) {
  const media = resourceMedia(entity.id);
  return (
    <span className={`${styles.imageFrame} ${entity.type === 'person' ? styles.personFrame : ''}`}>
      {media ? (
        <Image
          src={media.url}
          alt={
            decorative
              ? ''
              : media.kind === 'portrait'
                ? `${entity.name} 的公开照片`
                : `${entity.name} 标识`
          }
          width={96}
          height={96}
          sizes="96px"
          unoptimized
          className={media.kind === 'portrait' ? styles.portrait : styles.logo}
        />
      ) : (
        <span
          className={styles.monogram}
          role={decorative ? undefined : 'img'}
          aria-label={decorative ? undefined : '图像待核实'}
          aria-hidden={decorative ? true : undefined}
        >
          {resourceInitials(entity.name)}
        </span>
      )}
    </span>
  );
}

export function ResourceCard({
  entity,
  topicNames,
}: {
  entity: PublicEntitySummary;
  topicNames: ReadonlyMap<string, string>;
}) {
  const topics = resourceTopics(entity, topicNames).slice(0, 2);
  const media = resourceMedia(entity.id);
  const profile = resourceProfile(entity);
  return (
    <article className={styles.card}>
      <Link className={styles.cardLink} href={resourceHref(entity)}>
        <div className={styles.cardTop}>
          <ResourceImage entity={entity} decorative />
          <span className={styles.kind}>{formatEntityType(entity.type)}</span>
        </div>
        <div>
          <h3>{entity.name}</h3>
          <p className={styles.introduction}>{resourceIntroduction(entity)}</p>
        </div>
        <div className={styles.topicList} aria-label="关联议题">
          {topics.length ? (
            topics.map((topic) => <span key={topic.id}>{topic.name}</span>)
          ) : (
            <span>议题待关联</span>
          )}
        </div>
        <div className={styles.cardFooter}>
          <span>近 30 天 {entity.recentCount} 条</span>
          <strong>查看资料 ↗</strong>
        </div>
      </Link>
      {(profile || media) && (
        <div className={styles.attributionLinks}>
          {profile && (
            <a
              href={profile.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${entity.name}简介来源（在新窗口打开）`}
            >
              简介来源 ↗
            </a>
          )}
          {media && (
            <a
              href={media.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${entity.name}图像来源与许可（在新窗口打开）`}
            >
              图像：{media.credit} · {media.license} · 来源与许可 ↗
            </a>
          )}
        </div>
      )}
    </article>
  );
}
