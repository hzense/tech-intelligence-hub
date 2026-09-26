import Link from 'next/link';
import type { TopicInsightResult } from '@/lib/topic-insight-core';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import styles from './topic-insight.module.css';

export function TopicInsightReport({
  result,
  signals,
}: {
  result: TopicInsightResult;
  signals: SignalEntry[];
}) {
  const titles = new Map(signals.map((s) => [s.id, s.title]));
  return (
    <article className={styles.report} aria-label="专题分析正文">
      <p className="kicker">AI 分析 · 管理员确认</p>
      <h2>{result.report.title}</h2>
      <p className={styles.summary}>{result.report.summary}</p>
      <p className={styles.meta}>
        分析截止 {result.windowEnd.slice(0, 10)}（UTC） · 输入 {result.inputs.length} 条公开信号 ·
        生成于 {result.generatedAt.slice(0, 10)}
      </p>
      {result.report.sections.map((section, index) => (
        <section key={index}>
          <h3>{section.heading}</h3>
          <p className={styles.body}>{section.body}</p>
          <ul aria-label="本节证据信号">
            {section.signalIds.map((id) => (
              <li key={id}>
                <Link href={`/signals/${id}`}>{titles.get(id) ?? id}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h3>不确定性与反面解释</h3>
        <ul>
          {result.report.uncertainties.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      <p className={styles.meta}>本报告基于本站信号进行分析，不构成对来源主张的独立事实认证。</p>
    </article>
  );
}
