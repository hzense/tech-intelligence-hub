'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  RadarCategoryObservation,
  RadarDomainObservation,
  RadarResourceObservation,
  RadarSignalIndexEntry,
} from '@/lib/signal-radar-model';
import styles from './signal-radar.module.css';

type DomainNode = Pick<
  RadarDomainObservation,
  'id' | 'name' | 'totalCount' | 'recentCount' | 'previousCount' | 'signalIds'
>;

export interface RadarExplorerData {
  asOf: string;
  recentStart: string;
  totalCount: number;
  recentCount: number;
  previousCount: number;
  domains: readonly DomainNode[];
  categories: readonly RadarCategoryObservation[];
  topResources: readonly RadarResourceObservation[];
  signalIndex: readonly RadarSignalIndexEntry[];
}

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
  quiet: '暂无近期记录',
};

function resourceHref(resource: RadarResourceObservation) {
  return resource.type === 'person' ? `/persons/${resource.id}` : `/resources/${resource.id}`;
}

export function SignalRadarExplorer({ data }: { data: RadarExplorerData }) {
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
            <span>近 30 日公开信号</span>
            <strong>{data.recentCount}</strong>
            <small>
              {date(data.recentStart)} — {date(data.asOf)} UTC · 累计 {data.totalCount} 条
            </small>
          </div>
        </header>

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
                  {data.domains.some((domain) => domain.previousCount > 0) && (
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
                    aria-label={`${domain.name}，近 30 日 ${domain.recentCount} 条，累计 ${domain.totalCount} 条，点击查看分类与信号`}
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
                    aria-label={`${category.name}分类，近 30 日 ${category.recentCount} 条，累计 ${category.totalCount} 条，点击查看信号`}
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
                    aria-label={`资源第 ${index + 1} 名，${resource.type === 'person' ? '人物' : '公司'} ${resource.name}，近 30 日 ${resource.recentCount} 条，点击查看关联信号`}
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
                <i className={styles.recentKey} />近 30 日分布
              </span>
              <span>
                <i className={styles.previousKey} />前 30 日分布
              </span>
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
                近 30 日 <strong>{selectedRecent}</strong> 条 · 累计 {selectedTotal} 条
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
              <Link className={styles.profileLink} href={resourceHref(selectedResource)}>
                查看{selectedResource.type === 'person' ? '人物' : '公司'}资料 ↗
              </Link>
            )}

            {categoryChildren.length > 0 && (
              <div className={styles.categoryPanel}>
                <div className={styles.panelSectionHeading}>
                  <h3>领域内分类</h3>
                  <span>近 30 日热度</span>
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
                          <Link href={`/signals/${signal.id}`}>{signal.title}</Link>
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
          热度按本站已公开、去重的信号在近 30 日内的事件数衡量；高／中／低仅相对同层节点，
          不是全行业实时热度。资源 TOP 5
          按全站排序，不随领域选择改变。历史信号仍计入累计；未核实身份 ID 的人物或公司不进入资源榜。
        </p>
      </section>
    </main>
  );
}
