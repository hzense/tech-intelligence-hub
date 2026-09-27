import Link from 'next/link';
import type { TopicInsightResult } from '@/lib/topic-insight-core';
import type { SignalEntry } from '@/lib/public-signal-reader-core';
import { InsightEvidenceTimeline } from './insight-evidence-timeline';
import styles from './topic-insight.module.css';

export function TopicInsightReport({
  result,
  signals,
}: {
  result: TopicInsightResult;
  signals: SignalEntry[];
}) {
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  const evidence = result.inputs.flatMap((input) => {
    const signal = signalsById.get(input.id);
    return signal ? [signal] : [];
  });
  return (
    <article className={styles.report} aria-label="专题分析正文">
      <div className={styles.lead}>
        <p className={styles.eyebrow}>报告摘要</p>
        <p className={styles.summary}>{result.report.summary}</p>
      </div>

      <InsightEvidenceTimeline
        signals={evidence}
        rangeLabel={`分析窗口 ${result.windowStart.slice(0, 10)}—${result.windowEnd.slice(0, 10)}（UTC）`}
      />

      {result.report.sections.map((section, index) => (
        <section className={styles.section} key={`${index}-${section.heading}`}>
          <div className={styles.sectionHeading}>
            <span>{String(index + 1).padStart(2, '0')} / 分析</span>
            <h2>{section.heading}</h2>
          </div>
          <div className={styles.sectionBody}>
            {section.body.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
          </div>
          <div className={styles.sectionEvidence}>
            <strong>本节证据</strong>
            <ul>
              {section.signalIds.map((id) => (
                <li key={id}>
                  <Link href={`/signals/${id}`}>{signalsById.get(id)?.title ?? id} ↗</Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      <section className={styles.uncertainties}>
        <p className={styles.eyebrow}>审慎阅读</p>
        <h2>不确定性与反面解释</h2>
        <ul>
          {result.report.uncertainties.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      <p className={styles.note}>
        本报告由 AI
        基于已公开信号生成，经管理员确认发布；图表只展示证据信号的日期分布，不构成对来源主张的独立事实认证。
      </p>
    </article>
  );
}
