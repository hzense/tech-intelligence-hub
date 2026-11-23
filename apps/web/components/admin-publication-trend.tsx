import { useState } from 'react';
import type { PublicationDay } from '../lib/signal-generation-stats';
import styles from './admin-neon-usage.module.css';

export function AdminPublicationTrend({ days }: { days: PublicationDay[] | undefined }) {
  const [range, setRange] = useState<7 | 30>(30);
  const visible = days?.slice(-range) ?? [];
  const total = visible.reduce((sum, day) => sum + day.count, 0);
  const ceiling = Math.max(2, 2 * Math.ceil(Math.max(0, ...visible.map((day) => day.count)) / 2));
  const points = visible.map((day, i) => ({
    ...day,
    x: (100 * i) / Math.max(1, visible.length - 1),
    y: 100 * (1 - day.count / ceiling),
  }));
  return (
    <section className={styles.trend} aria-labelledby="publication-trend-title">
      <div className={styles.panelHeading}>
        <div>
          <h3 id="publication-trend-title">信号发布趋势</h3>
          <p className={styles.muted}>
            按柏林日期统计首次发布。每条信号只计一次，今天统计至刷新时。
          </p>
        </div>
        {points.length > 0 && (
          <div className={styles.rangeSwitch} role="group" aria-label="信号发布时间范围">
            {([7, 30] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {value} 天
              </button>
            ))}
          </div>
        )}
      </div>
      {points.length === 0 ? (
        <p className={styles.muted}>发布趋势暂不可用。</p>
      ) : (
        <>
          <p className={styles.trendTotal}>
            近 {range} 天首次发布 <strong>{total}</strong> 条
          </p>
          <div className={styles.trendChart}>
            <div className={styles.trendAxis} aria-hidden="true">
              {[ceiling, ceiling / 2, 0].map((value) => (
                <span key={value}>{value}</span>
              ))}
            </div>
            <svg
              className={styles.trendPlot}
              role="img"
              aria-label={`近 ${range} 天每日首次发布信号折线图，共 ${total} 条`}
            >
              {[0, 50, 100].map((y) => (
                <line key={y} x1="0%" x2="100%" y1={`${y}%`} y2={`${y}%`} stroke="var(--line)" />
              ))}
              <svg
                aria-hidden="true"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                overflow="visible"
              >
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {points.map((p) => (
                <circle key={p.date} cx={`${p.x}%`} cy={`${p.y}%`} r="3" fill="currentColor">
                  <title>
                    {p.date} · {p.count} 条
                  </title>
                </circle>
              ))}
            </svg>
            <div className={styles.trendDates} aria-hidden="true">
              {points
                .filter(
                  (_, index) =>
                    index === 0 ||
                    index === Math.floor(points.length / 2) ||
                    index === points.length - 1,
                )
                .map((point) => (
                  <span key={point.date} style={{ left: `${point.x}%` }}>
                    {point.date.slice(5)}
                  </span>
                ))}
            </div>
          </div>
          <details className={styles.method}>
            <summary>查看每日发布数</summary>
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="每日发布数">
              <table className={`${styles.table} ${styles.trendTable}`}>
                <caption className={styles.visuallyHidden}>每日首次发布信号明细</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">首次发布（条）</th>
                  </tr>
                </thead>
                <tbody>
                  {[...visible].reverse().map((day) => (
                    <tr key={day.date}>
                      <th scope="row">{day.date}</th>
                      <td>{day.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
