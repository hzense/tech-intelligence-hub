import Link from 'next/link';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import { isCurrentSignal } from '@/lib/public-exploration-core';
import { formatZhDate } from '@/lib/content-runtime';
import { formatSignalType } from '@/lib/signal-presentation';
import styles from './public-exploration.module.css';

export function PublicSignalCards({ signals }: { signals: readonly SignalEntry[] }) {
  return (
    <div className={styles.grid}>
      {signals.map((signal) => (
        <article className={styles.card} key={signal.id}>
          <div className={styles.meta}>
            <time dateTime={signal.occurred_at}>
              {formatZhDate(signal.occurred_at.slice(0, 10))}
            </time>
            <span>{formatSignalType(signal.type)}</span>
            <span>
              {!isCurrentSignal(signal)
                ? '历史档案'
                : signal.publication_basis === 'manual_confirmation'
                  ? '管理员确认'
                  : '当前公开版本'}
            </span>
          </div>
          <h3>
            <Link href={`/signals/${signal.id}`}>{signal.title}</Link>
          </h3>
          <p>{signal.summary}</p>
          {!!signal.public_people?.length && (
            <div className={styles.links}>
              <span>人物：</span>
              {signal.public_people.map((person) => (
                <Link key={person.id} href={`/persons/${person.id}`}>
                  {person.name}
                </Link>
              ))}
            </div>
          )}
          {!!signal.public_organizations?.length && (
            <div className={styles.links}>
              <span>组织：</span>
              {signal.public_organizations.map((organization) => (
                <Link key={organization.id} href={`/resources/${organization.id}`}>
                  {organization.name}
                </Link>
              ))}
            </div>
          )}
          {!!signal.public_topics?.length && (
            <div className={styles.links}>
              <span>专题：</span>
              {signal.public_topics.map((topic) => (
                <Link key={topic.id} href={`/topics/${topic.id}`}>
                  {topic.title}
                </Link>
              ))}
            </div>
          )}
          <Link href={`/signals/${signal.id}`}>查看事实与公开来源 →</Link>
        </article>
      ))}
    </div>
  );
}
