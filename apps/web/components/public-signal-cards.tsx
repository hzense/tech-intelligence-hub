import Link from 'next/link';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import { formatZhDate } from '@/lib/content-runtime';
import { formatSignalType } from '@/lib/signal-presentation';
import { toUnifiedSignal } from '@/lib/unified-signal-core';
import styles from './public-signal-cards.module.css';

export function PublicSignalCards({ signals }: { signals: readonly SignalEntry[] }) {
  return (
    <div className={styles.grid}>
      {signals.map((signal) => {
        const unified = toUnifiedSignal(signal);
        return (
          <article className={styles.card} key={unified.id}>
            <div className={styles.meta}>
              <time dateTime={unified.occurredAt}>
                {formatZhDate(unified.occurredAt.slice(0, 10))}
              </time>
              <span className={styles.type}>
                {unified.type ? formatSignalType(unified.type) : '未分类'}
              </span>
            </div>
            <h3>
              <Link href={`/signals/${unified.id}`}>{unified.title}</Link>
            </h3>
            <p className={styles.summary}>{unified.summary}</p>
            {unified.topics.length > 0 && (
              <div className={styles.topics} aria-label="相关专题">
                {unified.topics.slice(0, 3).map((topic) => (
                  <Link key={topic.id} href={`/topics/${topic.id}`}>
                    {topic.title}
                  </Link>
                ))}
              </div>
            )}
            {!!unified.people.length && (
              <div className={styles.links}>
                <span>人物：</span>
                {unified.people.slice(0, 3).map((person, index) =>
                  person.id ? (
                    <Link key={person.id} href={`/persons/${person.id}`}>
                      {person.name}
                    </Link>
                  ) : (
                    <span key={`${person.name}:${index}`}>{person.name}</span>
                  ),
                )}
              </div>
            )}
            {!!unified.organizations.length && (
              <div className={styles.links}>
                <span>组织：</span>
                {unified.organizations.slice(0, 3).map((organization, index) =>
                  organization.id ? (
                    <Link key={organization.id} href={`/resources/${organization.id}`}>
                      {organization.name}
                    </Link>
                  ) : (
                    <span key={`${organization.name}:${index}`}>{organization.name}</span>
                  ),
                )}
              </div>
            )}
            <div className={styles.footer}>
              <span>
                {unified.sources.length
                  ? `${unified.sources.length} 项公开来源`
                  : '未提供公开来源链接'}
              </span>
              <Link href={`/signals/${unified.id}`}>查看详情 ↗</Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
