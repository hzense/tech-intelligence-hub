import Link from 'next/link';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import { formatZhDate } from '@/lib/content-runtime';
import { formatSignalType } from '@/lib/signal-presentation';
import { toUnifiedSignal } from '@/lib/unified-signal-core';
import styles from './public-exploration.module.css';

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
              <span>{unified.type ? formatSignalType(unified.type) : '未分类'}</span>
              <span>
                {unified.publication.state === 'archive'
                  ? '历史档案'
                  : unified.publication.basis === 'manual_confirmation'
                    ? '管理员确认'
                    : '当前公开版本'}
              </span>
            </div>
            <h3>
              <Link href={`/signals/${unified.id}`}>{unified.title}</Link>
            </h3>
            <p>{unified.summary}</p>
            {!!unified.people.length && (
              <div className={styles.links}>
                <span>人物：</span>
                {unified.people.map((person, index) =>
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
                {unified.organizations.map((organization, index) =>
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
            {unified.topics.length > 0 && (
              <div className={styles.links}>
                <span>专题：</span>
                {unified.topics.map((topic) => (
                  <Link key={topic.id} href={`/topics/${topic.id}`}>
                    {topic.title}
                  </Link>
                ))}
              </div>
            )}
            <Link href={`/signals/${unified.id}`}>查看事实与公开来源 →</Link>
          </article>
        );
      })}
    </div>
  );
}
