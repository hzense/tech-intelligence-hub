'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RadarHotspot } from '@/lib/radar-hotspots';
import type { RadarSignalIndexEntry } from '@/lib/signal-radar-model';
import type { filterRadarWindow } from '@/lib/radar-window';
import { buildRadarAssessment } from '@/lib/radar-assessment';
import { RadarResource, RadarSparkline } from './signal-radar-parts';
import styles from './signal-radar.module.css';

const date = (value: string) => value.slice(0, 10);
const signalHref = (id: string) => `/signals/${encodeURIComponent(id)}`;

export function RadarHotspotDialog({
  hotspot,
  signals,
  data,
  onClose,
}: {
  hotspot: RadarHotspot | undefined;
  signals: RadarSignalIndexEntry[];
  data: ReturnType<typeof filterRadarWindow>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [showSignals, setShowSignals] = useState(!hotspot);
  const [visibleCount, setVisibleCount] = useState(8);
  const assessment = useMemo(
    () => (hotspot ? buildRadarAssessment(hotspot, signals) : undefined),
    [hotspot, signals],
  );
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      id="radar-detail-panel"
      className={styles.detailDialog}
      aria-label="热点详情"
      aria-describedby="radar-detail-description"
      onClose={(event) => {
        // StrictMode replays setup/cleanup; ignore the queued close event if
        // the same native dialog has already been opened again.
        if (!event.currentTarget.open) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((node) => node.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === heading.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          event.currentTarget.close();
      }}
    >
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>
            {hotspot?.domainName ?? '全域概览'} · {data.rangeLabel}
          </p>
          <h2 ref={heading} tabIndex={-1}>
            {hotspot?.name ?? '全部信号'}
          </h2>
          <p id="radar-detail-description">
            {signals.length} 条关联信号{hotspot ? ' · 组织、代表人物与技术趋势研判' : ''}
          </p>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="关闭详情"
          onClick={() => dialog.current?.close()}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className={styles.dialogBody}>
        {hotspot?.scopeNote && <p className={styles.subtle}>{hotspot.scopeNote}</p>}
        {hotspot && assessment && (
          <>
            <section className={styles.assessment} aria-label="技术趋势研判">
              <div className={styles.sectionHeading}>
                <h3>技术趋势研判</h3>
                <span>基于公开信号的观察</span>
              </div>
              <div className={styles.assessmentGrid}>
                <div>
                  <p className={styles.direction}>{assessment.direction}</p>
                  <p className={styles.activity}>{assessment.activity}</p>
                  {assessment.themes.length > 0 && (
                    <div className={styles.themes}>
                      {assessment.themes.map((theme) => (
                        <span key={theme.id}>
                          {theme.label} · {theme.count}
                        </span>
                      ))}
                    </div>
                  )}
                  {assessment.judgments.length > 0 ? (
                    <div className={styles.judgments}>
                      <h4>已有信号研判</h4>
                      {assessment.judgments.map((judgment) => (
                        <article key={judgment.signalId}>
                          <blockquote>
                            {judgment.text}
                            {judgment.truncated ? '…' : ''}
                          </blockquote>
                          <Link href={signalHref(judgment.signalId)} prefetch={false}>
                            依据：{judgment.title} ↗
                          </Link>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.subtle}>
                      当前材料尚无已发布的深入研判；以下进展可作为继续判断的依据。
                    </p>
                  )}
                  <p className={styles.nextQuestion}>
                    <strong>接下来观察</strong>
                    {assessment.nextQuestion}
                  </p>
                </div>
                <div className={styles.trendSection} data-trend={hotspot.trend.state}>
                  <p className={styles.trendStatus}>{hotspot.trend.label}</p>
                  <RadarSparkline series={hotspot.series} />
                  <div className={styles.trendDates}>
                    <span>{date(data.rangeStart)}</span>
                    <span>{date(data.rangeEnd)}</span>
                  </div>
                  <p className={styles.trendCaption}>
                    {hotspot.previousCount === null
                      ? '全部时间不作上一时段对比。'
                      : `${data.previousLabel} ${hotspot.previousCount} 条 → 本期 ${hotspot.recentCount} 条`}
                  </p>
                  <details className={styles.trendNumbers}>
                    <summary>查看分段数据</summary>
                    <ol>
                      {hotspot.series.map((point) => (
                        <li key={point.start}>
                          <span>{point.start.slice(0, 16).replace('T', ' ')} UTC</span>
                          <strong>{point.count} 条</strong>
                        </li>
                      ))}
                    </ol>
                    <p>当前时段等分为 8 段，每段含起点、不含终点。</p>
                  </details>
                </div>
              </div>
              <details className={styles.assessmentLimits}>
                <summary>研判依据与边界</summary>
                <ul>
                  {assessment.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </details>
            </section>
            <div className={styles.resources}>
              {(['company', 'person'] as const).map((kind) => {
                const resources = hotspot.resources.filter((resource) =>
                  kind === 'person' ? resource.type === 'person' : resource.type !== 'person',
                );
                return (
                  <section key={kind} aria-label={kind === 'person' ? '代表人物' : '相关组织'}>
                    <h3>{kind === 'person' ? '代表人物' : '相关组织'}</h3>
                    {kind === 'person' && (
                      <p className={styles.resourceNote}>
                        从关联信号识别关键人物，职务与贡献以来源资料为准。
                      </p>
                    )}
                    {resources.length ? (
                      resources.map((resource) => {
                        const person = assessment.people.find(
                          (person) => person.id === resource.id,
                        );
                        return (
                          <div key={resource.id}>
                            <RadarResource resource={resource} />
                            {person?.roleEvidence && (
                              <p className={styles.personRole}>
                                {person.roleLabel} · {person.roleEvidence}
                              </p>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className={styles.subtle}>
                        当前信号尚未关联{kind === 'person' ? '人物' : '组织'}资料。
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            {assessment.milestones.length > 0 && (
              <section className={styles.development} aria-label="技术进展依据">
                <h3>技术进展依据</h3>
                <div className={styles.milestones}>
                  {assessment.milestones.map((milestone) => (
                    <article key={milestone.signalId}>
                      <time dateTime={milestone.occurredAt}>{date(milestone.occurredAt)}</time>
                      <Link href={signalHref(milestone.signalId)} prefetch={false}>
                        {milestone.title}
                      </Link>
                      <p>{milestone.summary}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        <button
          type="button"
          className={styles.signalToggle}
          aria-expanded={showSignals}
          aria-controls="radar-signal-list"
          onClick={() => setShowSignals((value) => !value)}
        >
          {showSignals ? '收起相关信号' : `查看相关信号（${signals.length}）`}
        </button>
        {showSignals && (
          <div className={styles.signalSection}>
            <ol id="radar-signal-list" className={styles.signalList}>
              {signals.slice(0, visibleCount).map((signal) => (
                <li key={signal.id}>
                  <time dateTime={signal.occurredAt}>{date(signal.occurredAt)}</time>
                  <h3>
                    <Link href={signalHref(signal.id)} prefetch={false}>
                      {signal.title}
                    </Link>
                  </h3>
                  <p>{signal.summary}</p>
                </li>
              ))}
            </ol>
            {!signals.length && <p className={styles.empty}>该热点暂无符合当前公开口径的信号。</p>}
            {signals.length > visibleCount && (
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => setVisibleCount((count) => count + 8)}
              >
                显示更多信号（剩余 {signals.length - visibleCount} 条）
              </button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
