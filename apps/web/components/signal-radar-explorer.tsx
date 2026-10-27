'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { RadarResourceObservation } from '@/lib/signal-radar-model';
import { filterRadarWindow, type RadarExplorerData, type RadarTimeRange } from '@/lib/radar-window';
import styles from './signal-radar.module.css';

type DomainNode = RadarExplorerData['domains'][number];

type Selection = { kind: 'all' } | { kind: 'domain' | 'category' | 'resource'; id: string };
type Heat = 'quiet' | 'low' | 'medium' | 'high';

const date = (value: string) => value.slice(0, 10);
const initialLimit = 8;

function polar(index: number, count: number, radius: number): CSSProperties {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, count);
  return {
    left: `${50 + radius * Math.cos(angle)}%`,
    top: `${50 + radius * Math.sin(angle)}%`,
  };
}

function polygon(
  domains: readonly DomainNode[],
  count: (domain: DomainNode) => number,
  maximum: number,
) {
  return domains
    .map((domain, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / domains.length;
      const radius = (count(domain) / maximum) * 35;
      return `${50 + radius * Math.cos(angle)},${50 + radius * Math.sin(angle)}`;
    })
    .join(' ');
}

function heat(count: number, maximum: number): Heat {
  if (count === 0) return 'quiet';
  const ratio = count / Math.max(1, maximum);
  return ratio >= 2 / 3 ? 'high' : ratio >= 1 / 3 ? 'medium' : 'low';
}

const heatLabel: Record<Heat, string> = {
  high: '高',
  medium: '中',
  low: '低',
  quiet: '所选时段无记录',
};

function resourceHref(resource: RadarResourceObservation) {
  return resource.type === 'person' ? `/persons/${resource.id}` : `/resources/${resource.id}`;
}

export function SignalRadarExplorer({ data: sourceData }: { data: RadarExplorerData }) {
  const [range, setRange] = useState<RadarTimeRange>({ kind: 'days', days: 30 });
  const [rangeChoice, setRangeChoice] = useState('30');
  const [startDate, setStartDate] = useState(date(sourceData.recentStart));
  const [endDate, setEndDate] = useState(date(sourceData.asOf));
  const [rangeError, setRangeError] = useState('');
  const data = useMemo(() => filterRadarWindow(sourceData, range), [sourceData, range]);
  const defaultDomain = [...data.domains].sort(
    (left, right) =>
      right.recentCount - left.recentCount ||
      right.totalCount - left.totalCount ||
      left.id.localeCompare(right.id),
  )[0];
  const [selection, setSelection] = useState<Selection>(
    defaultDomain ? { kind: 'domain', id: defaultDomain.id } : { kind: 'all' },
  );
  const [visibleCount, setVisibleCount] = useState(initialLimit);
  const applyRange = (next: RadarTimeRange) => {
    try {
      // Validate before replacing the active range; invalid drafts leave the radar intact.
      filterRadarWindow(sourceData, next);
      setRange(next);
      setSelection({ kind: 'all' });
      setVisibleCount(initialLimit);
      setRangeError('');
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : '请选择有效的时间范围。');
    }
  };
  const applyCustomRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyRange({ kind: 'custom', startDate, endDate });
  };
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const plotViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const centerSmallRadar = () => {
      const viewport = plotViewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = media.matches ? (viewport.scrollWidth - viewport.clientWidth) / 2 : 0;
    };
    centerSmallRadar();
    media.addEventListener('change', centerSmallRadar);
    return () => media.removeEventListener('change', centerSmallRadar);
  }, []);
  const choose = (next: Selection) => {
    setSelection(next);
    setVisibleCount(initialLimit);
    requestAnimationFrame(() => detailHeadingRef.current?.focus());
  };

  const selectedDomain =
    selection.kind === 'domain'
      ? data.domains.find((domain) => domain.id === selection.id)
      : undefined;
  const selectedCategory =
    selection.kind === 'category'
      ? data.categories.find((category) => category.id === selection.id)
      : undefined;
  const selectedResource =
    selection.kind === 'resource'
      ? data.topResources.find((resource) => resource.id === selection.id)
      : undefined;
  const activeDomain =
    selectedDomain ??
    (selectedCategory
      ? data.domains.find((domain) => domain.id === selectedCategory.domainId)
      : undefined) ??
    defaultDomain;
  const childrenOf = (id: string) => data.categories.filter((category) => category.parentId === id);
  const categoryChildren = selectedCategory
    ? childrenOf(selectedCategory.id)
    : selectedDomain
      ? childrenOf(selectedDomain.id)
      : [];
  const orbitParent =
    selection.kind === 'all' || selection.kind === 'resource'
      ? undefined
      : selectedCategory
        ? categoryChildren.length
          ? selectedCategory.id
          : selectedCategory.parentId
        : activeDomain?.id;
  const orbitCategories = orbitParent
    ? childrenOf(orbitParent).filter((category) => category.totalCount > 0)
    : [];
  const selectionName =
    selectedResource?.name ?? selectedCategory?.name ?? selectedDomain?.name ?? '全部信号';
  const selectionLabel = selectedResource
    ? selectedResource.type === 'person'
      ? '人物资源'
      : '公司资源'
    : selectedCategory
      ? `第 ${selectedCategory.depth + 1} 级分类`
      : selectedDomain
        ? '技术领域'
        : '全部领域';
  const selectedSignalIds =
    selectedResource?.signalIds ?? selectedCategory?.signalIds ?? selectedDomain?.signalIds;
  const selectedSignalIdSet = selectedSignalIds ? new Set(selectedSignalIds) : null;
  const selectedSignals = selectedSignalIdSet
    ? data.signalIndex.filter((signal) => selectedSignalIdSet.has(signal.id))
    : data.signalIndex;
  const selectedRecent =
    selectedResource?.recentCount ??
    selectedCategory?.recentCount ??
    selectedDomain?.recentCount ??
    data.recentCount;
  const selectedTotal =
    selectedResource?.totalCount ??
    selectedCategory?.totalCount ??
    selectedDomain?.totalCount ??
    data.totalCount;
  const domainMaximum = Math.max(1, ...data.domains.map((domain) => domain.recentCount));
  const timelineMaximum = Math.max(
    domainMaximum,
    ...data.domains.map((domain) => domain.previousCount),
  );
  const categoryMaximum = Math.max(1, ...orbitCategories.map((category) => category.recentCount));
  const childCategoryMaximum = Math.max(
    1,
    ...categoryChildren.map((category) => category.recentCount),
  );
  const resourceMaximum = Math.max(1, ...data.topResources.map((resource) => resource.recentCount));
  const signalCount = selectedSignals.length;
  const shownSignals = selectedSignals.slice(0, visibleCount);

  return (
    <main className={`page-main section-shell ${styles.radar}`}>
      <section className={styles.stage} aria-label="交互式技术演进雷达">
        <header className={styles.stageHeader}>
          <div>
            <p className={styles.eyebrow}>HZENSE / TECHNOLOGY RADAR</p>
            <h1>技术演进雷达</h1>
            <p>选择领域、分类或资源，查看同一公开样本中的关联信号。</p>
          </div>
          <div className={styles.snapshot}>
            <span>{data.rangeLabel}公开信号</span>
            <strong>{data.recentCount}</strong>
            <small>
              {date(data.rangeStart)} —{' '}
              {range.kind === 'custom' ? range.endDate : date(data.rangeEnd)} UTC
              {' · '}累计 {data.totalCount} 条
            </small>
          </div>
        </header>

        <div className={styles.timeControls}>
          <label htmlFor="radar-time-range">时间范围</label>
          <select
            id="radar-time-range"
            value={rangeChoice}
            onChange={(event) => {
              const choice = event.target.value;
              setRangeChoice(choice);
              setRangeError('');
              if (choice !== 'custom')
                applyRange(
                  choice === 'all' ? { kind: 'all' } : { kind: 'days', days: Number(choice) },
                );
            }}
          >
            {[7, 30, 90, 180, 365].map((days) => (
              <option key={days} value={days}>
                近 {days} 天
              </option>
            ))}
            <option value="all">全部时间</option>
            <option value="custom">自定义日期</option>
          </select>
          {rangeChoice === 'custom' && (
            <form className={styles.customRange} onSubmit={applyCustomRange}>
              <label>
                开始日期
                <input
                  type="date"
                  required
                  value={startDate}
                  max={date(sourceData.asOf)}
                  onChange={(event) => setStartDate(event.target.value)}
                  aria-describedby={rangeError ? 'radar-range-error' : undefined}
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  required
                  value={endDate}
                  max={date(sourceData.asOf)}
                  onChange={(event) => setEndDate(event.target.value)}
                  aria-describedby={rangeError ? 'radar-range-error' : undefined}
                />
              </label>
              <button type="submit">应用日期</button>
            </form>
          )}
          <span className={styles.rangeStatus} role="status">
            当前：{data.rangeLabel} · {data.recentCount} 条信号
          </span>
          {rangeError && (
            <p id="radar-range-error" role="alert">
              {rangeError}
            </p>
          )}
        </div>
        {data.recentCount === 0 && (
          <p className={styles.empty} role="status">
            所选时间范围暂无公开信号，请扩大范围或选择全部时间。
          </p>
        )}

        <div className={styles.stageBody}>
          <div className={styles.plotColumn}>
            <p className={styles.mobileHint}>左右滑动雷达，点击节点查看关联信号。</p>
            <div className={styles.plotViewport} ref={plotViewportRef}>
              <div className={styles.plot} role="group" aria-label="可点击的领域、分类和资源雷达">
                <svg className={styles.plotGrid} viewBox="0 0 100 100" aria-hidden="true">
                  {[12, 24, 36, 44].map((radius) => (
                    <circle key={radius} cx="50" cy="50" r={radius} className={styles.ring} />
                  ))}
                  {data.domains.map((domain, index) => {
                    const angle = -Math.PI / 2 + (index * Math.PI * 2) / data.domains.length;
                    return (
                      <line
                        key={domain.id}
                        className={styles.axis}
                        x1="50"
                        y1="50"
                        x2={50 + 44 * Math.cos(angle)}
                        y2={50 + 44 * Math.sin(angle)}
                      />
                    );
                  })}
                  {data.previousLabel !== null &&
                    data.domains.some((domain) => domain.previousCount > 0) && (
                      <polygon
                        className={styles.previousShape}
                        points={polygon(
                          data.domains,
                          (domain) => domain.previousCount,
                          timelineMaximum,
                        )}
                      />
                    )}
                  {data.domains.some((domain) => domain.recentCount > 0) && (
                    <polygon
                      className={styles.recentShape}
                      points={polygon(
                        data.domains,
                        (domain) => domain.recentCount,
                        timelineMaximum,
                      )}
                    />
                  )}
                </svg>

                <button
                  type="button"
                  className={styles.centerNode}
                  aria-pressed={selection.kind === 'all'}
                  aria-controls="radar-detail-panel"
                  onClick={() => choose({ kind: 'all' })}
                >
                  <span>ALL</span>
                  <strong>全域</strong>
                </button>

                {data.domains.map((domain, index) => (
                  <button
                    key={domain.id}
                    type="button"
                    className={styles.domainNode}
                    style={polar(index, data.domains.length, 41)}
                    data-heat={heat(domain.recentCount, domainMaximum)}
                    aria-pressed={
                      activeDomain?.id === domain.id &&
                      selection.kind !== 'resource' &&
                      selection.kind !== 'all'
                    }
                    aria-controls="radar-detail-panel"
                    aria-label={`${domain.name}，${data.rangeLabel} ${domain.recentCount} 条，累计 ${domain.totalCount} 条，点击查看分类与信号`}
                    onClick={() => choose({ kind: 'domain', id: domain.id })}
                  >
                    <strong>{domain.name}</strong>
                    <span>
                      {domain.recentCount} · {heatLabel[heat(domain.recentCount, domainMaximum)]}
                    </span>
                  </button>
                ))}

                {orbitCategories.map((category, index) => (
                  <button
                    key={category.id}
                    type="button"
                    className={styles.categoryNode}
                    style={polar(index, orbitCategories.length, 27)}
                    data-heat={heat(category.recentCount, categoryMaximum)}
                    aria-pressed={selectedCategory?.id === category.id}
                    aria-controls="radar-detail-panel"
                    aria-label={`${category.name}分类，${data.rangeLabel} ${category.recentCount} 条，累计 ${category.totalCount} 条，点击查看信号`}
                    onClick={() => choose({ kind: 'category', id: category.id })}
                  >
                    <strong>{category.name}</strong>
                    <span>{category.recentCount} 条</span>
                  </button>
                ))}

                {data.topResources.map((resource, index) => (
                  <button
                    key={resource.id}
                    type="button"
                    className={styles.resourceNode}
                    style={polar(index, data.topResources.length, 17)}
                    data-heat={heat(resource.recentCount, resourceMaximum)}
                    data-kind={resource.type}
                    aria-pressed={selectedResource?.id === resource.id}
                    aria-controls="radar-detail-panel"
                    aria-label={`资源第 ${index + 1} 名，${resource.type === 'person' ? '人物' : '公司'} ${resource.name}，${data.rangeLabel} ${resource.recentCount} 条，点击查看关联信号`}
                    onClick={() => choose({ kind: 'resource', id: resource.id })}
                  >
                    <span>
                      #{index + 1} · {resource.type === 'person' ? '人物' : '公司'}
                    </span>
                    <strong>{resource.name}</strong>
                    <span>
                      {resource.recentCount} 条 ·{' '}
                      {heatLabel[heat(resource.recentCount, resourceMaximum)]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.plotLegend}>
              <span>
                <i className={styles.recentKey} />
                {data.rangeLabel}分布
              </span>
              {data.previousLabel && (
                <span>
                  <i className={styles.previousKey} />
                  {data.previousLabel}分布
                </span>
              )}
              <span>
                <i className={styles.categoryKey} />
                当前领域分类
              </span>
              <span>
                <i className={styles.resourceKey} />
                全站人物／公司 TOP 5
              </span>
            </div>
          </div>

          <aside className={styles.detailPanel} id="radar-detail-panel" aria-label="雷达节点详情">
            <div className={styles.panelHeader} aria-live="polite" aria-atomic="true">
              <span className={styles.panelEyebrow}>{selectionLabel}</span>
              <h2 ref={detailHeadingRef} tabIndex={-1}>
                {selectionName}
              </h2>
              <p>
                {data.rangeLabel} <strong>{selectedRecent}</strong> 条 · 累计 {selectedTotal} 条
              </p>
            </div>

            {selectedCategory && activeDomain && (
              <div className={styles.breadcrumbs} aria-label="分类路径">
                <button
                  type="button"
                  onClick={() => choose({ kind: 'domain', id: activeDomain.id })}
                >
                  {activeDomain.name}
                </button>
                {selectedCategory.parentId !== activeDomain.id && (
                  <>
                    <span aria-hidden="true">/</span>
                    <button
                      type="button"
                      onClick={() => choose({ kind: 'category', id: selectedCategory.parentId })}
                    >
                      {data.categories.find((category) => category.id === selectedCategory.parentId)
                        ?.name ?? '上级分类'}
                    </button>
                  </>
                )}
                <span aria-hidden="true">/</span>
                <span>{selectedCategory.name}</span>
              </div>
            )}

            {selectedResource && (
              <Link
                className={styles.profileLink}
                href={resourceHref(selectedResource)}
                prefetch={false}
              >
                查看{selectedResource.type === 'person' ? '人物' : '公司'}资料 ↗
              </Link>
            )}

            {categoryChildren.length > 0 && (
              <div className={styles.categoryPanel}>
                <div className={styles.panelSectionHeading}>
                  <h3>领域内分类</h3>
                  <span>{data.rangeLabel}热度</span>
                </div>
                <div className={styles.categoryList}>
                  {categoryChildren.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => choose({ kind: 'category', id: category.id })}
                      aria-controls="radar-detail-panel"
                      className={styles.categoryRow}
                      data-heat={heat(category.recentCount, childCategoryMaximum)}
                    >
                      <span>{category.name}</span>
                      <i aria-hidden="true">
                        <b
                          style={{
                            width: `${(category.recentCount / childCategoryMaximum) * 100}%`,
                          }}
                        />
                      </i>
                      <strong>{category.recentCount}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.signalPanel} id="radar-signal-list">
              <div className={styles.panelSectionHeading}>
                <h3>关联信号</h3>
                <span>{signalCount} 条</span>
              </div>
              {shownSignals.length ? (
                <ol className={styles.signalList}>
                  {shownSignals.map((signal) => (
                    <li key={signal.id}>
                      <article>
                        <time dateTime={signal.occurredAt}>{date(signal.occurredAt)}</time>
                        <h4>
                          <Link href={`/signals/${signal.id}`} prefetch={false}>
                            {signal.title}
                          </Link>
                        </h4>
                        <p>{signal.summary}</p>
                      </article>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.empty}>该节点暂无符合当前公开口径的信号。</p>
              )}
              {signalCount > visibleCount && (
                <button
                  type="button"
                  className={styles.moreButton}
                  onClick={() => setVisibleCount((count) => count + initialLimit)}
                >
                  显示更多信号（剩余 {signalCount - visibleCount} 条）
                </button>
              )}
            </div>
          </aside>
        </div>

        <p className={styles.footnote}>
          热度按所选时间范围内已公开、去重的信号数衡量，沿用信号日期，按 UTC 统计；累计为全部时间。
          领域、分类、资源和关联信号使用相同范围，无信号的节点不显示。高／中／低仅相对同层节点，
          不是全行业实时热度。资源 TOP 5 随时间范围重排，不随领域选择改变；未核实身份 ID
          的人物或公司不进入资源榜。
          {data.previousLabel
            ? '虚线对比当前可见领域的上一等长时段；自定义日期包含首尾日，今天截至数据加载时刻。'
            : '全部时间不作上一时段对比。'}
        </p>
      </section>
    </main>
  );
}
