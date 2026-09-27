import type { CSSProperties } from 'react';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import styles from './topic-insight.module.css';

export function InsightEvidenceTimeline({
  signals,
  rangeLabel,
}: {
  signals: SignalEntry[];
  rangeLabel?: string;
}) {
  if (!signals.length) return null;
  const dailyCounts = new Map<string, number>();
  for (const signal of signals) {
    const date = signal.occurred_at.slice(0, 10);
    dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1);
  }
  const timeline = [...dailyCounts].sort(([a], [b]) => a.localeCompare(b));
  const maximum = Math.max(...timeline.map(([, count]) => count));

  return (
    <figure className={styles.evidenceFigure}>
      <figcaption>
        <strong>证据日期分布</strong>
        <span>
          仅列出有事件的日期；柱间等距不代表日期间隔。高度是当天关联的公开信号数，不是技术热度评分。
        </span>
      </figcaption>
      <div className={styles.timeline}>
        {timeline.map(([date, count]) => (
          <div className={styles.timelineItem} key={date}>
            <strong>{count}</strong>
            <span
              className={styles.timelineBar}
              style={{ height: `${Math.max(8, (count / maximum) * 100)}%` } as CSSProperties}
              aria-hidden="true"
            />
            <time dateTime={date}>{date}</time>
          </div>
        ))}
      </div>
      <p className={styles.figureNote}>
        {rangeLabel ? `${rangeLabel} · ` : ''}
        {signals.length} 条可公开读取的关联信号
      </p>
    </figure>
  );
}
