'use client';

import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { filterRadarWindow, type RadarExplorerData, type RadarTimeRange } from '@/lib/radar-window';
import { buildRadarHotspots } from '@/lib/radar-hotspots';
import { RadarWordCloud } from './radar-word-cloud';
import { RadarHotspotDialog } from './radar-hotspot-dialog';
import styles from './signal-radar.module.css';

const date = (value: string) => value.slice(0, 10);
const compactQuery = '(max-width: 720px)';
const subscribeCompact = (listener: () => void) => {
  const query = window.matchMedia(compactQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const isCompact = () => window.matchMedia(compactQuery).matches;
const serverCompact = () => false;

export function SignalRadarExplorer({ data: sourceData }: { data: RadarExplorerData }) {
  const compact = useSyncExternalStore(subscribeCompact, isCompact, serverCompact);
  const cloudLimit = compact ? 12 : 30;
  const [range, setRange] = useState<RadarTimeRange>({ kind: 'days', days: 30 });
  const [rangeChoice, setRangeChoice] = useState('30');
  const [startDate, setStartDate] = useState(date(sourceData.recentStart));
  const [endDate, setEndDate] = useState(date(sourceData.asOf));
  const [rangeError, setRangeError] = useState('');
  const data = useMemo(() => filterRadarWindow(sourceData, range), [sourceData, range]);
  const hotspots = useMemo(() => buildRadarHotspots(sourceData, data), [sourceData, data]);
  // No initial selection: details are created only after an explicit click.
  const [selectedId, setSelectedId] = useState<string | null>();
  const selected = hotspots.find((hotspot) => hotspot.id === selectedId);
  const [showAllWords, setShowAllWords] = useState(false);
  const selectedSignals = useMemo(() => {
    if (!selected) return data.signalIndex;
    const ids = new Set(selected.signalIds);
    return data.signalIndex.filter((signal) => ids.has(signal.id));
  }, [data.signalIndex, selected]);
  const words = useMemo(
    () => (showAllWords ? hotspots : hotspots.slice(0, cloudLimit)),
    [hotspots, showAllWords, cloudLimit],
  );
  const applyRange = (next: RadarTimeRange) => {
    try {
      filterRadarWindow(sourceData, next);
      setRange(next);
      setSelectedId(undefined);
      setRangeError('');
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : '请选择有效的时间范围。');
    }
  };
  const applyCustomRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyRange({ kind: 'custom', startDate, endDate });
  };
  return (
    <main className={`page-main section-shell ${styles.radar}`}>
      <section className={styles.stage} aria-label="技术热点与趋势">
        <header className={styles.stageHeader}>
          <div>
            <p className={styles.eyebrow}>HZENSE / TECHNOLOGY RADAR</p>
            <h1>技术热点词云</h1>
            <p>热点汇聚中央，点击探索技术动向与关键人物。</p>
          </div>
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
          </div>
        </header>
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
        {rangeError && (
          <p id="radar-range-error" className={styles.error} role="alert">
            {rangeError}
          </p>
        )}
        <div className={styles.rangeSummary}>
          <span role="status">
            当前：{data.rangeLabel} · {data.recentCount} 条信号
          </span>
          <span>
            {date(data.rangeStart)} —{' '}
            {range.kind === 'custom' ? range.endDate : date(data.rangeEnd)} UTC · 累计{' '}
            {data.totalCount} 条
          </span>
        </div>
        {data.recentCount === 0 && (
          <p className={styles.empty} role="status">
            所选时间范围暂无公开信号，请扩大范围或选择全部时间。
          </p>
        )}

        <RadarWordCloud hotspots={words} rangeLabel={data.rangeLabel} onSelect={setSelectedId} />
        <div className={styles.cloudActions}>
          <span>热点居中 · 点击词语探索</span>
          {hotspots.length > cloudLimit && (
            <button
              type="button"
              aria-expanded={showAllWords}
              onClick={() => setShowAllWords((value) => !value)}
            >
              {showAllWords ? '收起更多热点' : `显示全部热点（${hotspots.length}）`}
            </button>
          )}
          <button type="button" aria-haspopup="dialog" onClick={() => setSelectedId(null)}>
            全部信号
          </button>
        </div>
        <div className={styles.legend}>
          {data.previousLabel === null ? (
            <>
              <span>字号与颜色：累计信号量</span>
              <span data-heat="low">较少</span>
              <span data-heat="medium">中等</span>
              <span data-heat="high">较多</span>
              <span data-heat="peak">最多</span>
              <span>按相对信号量分档，不表示升降温</span>
            </>
          ) : (
            <>
              <span>字号：所选时段信号量</span>
              <span data-trend="rising">↗ 升温／新收录</span>
              <span data-trend="steady">→ 平稳</span>
              <span data-trend="falling">↘ 降温</span>
              <span>灰色：样本较少</span>
            </>
          )}
        </div>
        {selectedId !== undefined && (
          <RadarHotspotDialog
            hotspot={selected}
            signals={selectedSignals}
            data={data}
            onClose={() => setSelectedId(undefined)}
          />
        )}
      </section>
    </main>
  );
}
