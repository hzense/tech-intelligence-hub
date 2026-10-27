'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { layoutRadarCloud } from '@/lib/radar-cloud-layout';
import type { RadarHotspot } from '@/lib/radar-hotspots';
import styles from './signal-radar.module.css';

const symbols = {
  rising: '↗',
  falling: '↘',
  steady: '→',
  new: '↗',
  insufficient: '',
  unavailable: '',
} as const;

// All-time has no preceding comparison window. Its palette expresses volume,
// not growth, and equal counts always receive the same color.
const heatLevel = (ratio: number) =>
  ratio <= 0.25 ? 'low' : ratio <= 0.5 ? 'medium' : ratio <= 0.75 ? 'high' : 'peak';

/** Measure the actual translated words before placing them around the hottest term. */
export function RadarWordCloud({
  hotspots,
  rangeLabel,
  onSelect,
}: {
  hotspots: RadarHotspot[];
  rangeLabel: string;
  onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<
    ReturnType<typeof layoutRadarCloud> & { source: RadarHotspot[] }
  >();
  const ready = layout?.source === hotspots;
  const maximum = Math.max(1, ...hotspots.map((hotspot) => hotspot.recentCount));
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let frame = 0;
    let lastWidth = 0;
    const measure = () => {
      if (cancelled || element.clientWidth <= 32) return;
      const width = element.clientWidth;
      const items = Array.from(
        element.querySelectorAll<HTMLButtonElement>('[data-hotspot-id]'),
      ).map((button, index) => ({
        id: button.dataset.hotspotId!,
        width: button.offsetWidth,
        height: button.offsetHeight,
        // Include the existing stable rank for equal-count words.
        weight: hotspots[index]!.recentCount + (hotspots.length - index) / (hotspots.length + 1),
      }));
      setLayout({
        ...layoutRadarCloud(items, {
          width,
          height: width < 600 ? 360 : 580,
          gap: width < 600 ? 9 : 15,
        }),
        source: hotspots,
      });
      lastWidth = width;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    void document.fonts.ready.then(() => {
      if (!cancelled) schedule();
    });
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== lastWidth) schedule();
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hotspots]);
  const placements = new Map(layout?.placements.map((placement) => [placement.id, placement]));
  return (
    <div
      ref={canvas}
      className={styles.cloud}
      role="group"
      aria-label="技术热点词云"
      data-cloud-canvas="true"
      data-layout-ready={ready ? 'true' : 'false'}
      style={{ height: layout?.height ?? 580 }}
    >
      {hotspots.map((hotspot) => {
        const placement = placements.get(hotspot.id);
        const weight = Math.sqrt(hotspot.recentCount / maximum);
        return (
          <button
            key={hotspot.id}
            type="button"
            className={styles.word}
            data-hotspot-id={hotspot.id}
            data-trend={hotspot.trend.state}
            data-heat={
              hotspot.previousCount === null ? heatLevel(hotspot.recentCount / maximum) : undefined
            }
            aria-haspopup="dialog"
            aria-controls="radar-detail-panel"
            aria-label={`${hotspot.name}，${rangeLabel} ${hotspot.recentCount} 条，${hotspot.trend.label}，查看热点详情`}
            title={`${hotspot.recentCount} 条信号 · ${hotspot.trend.label}`}
            style={
              {
                '--word-weight': weight,
                '--word-ratio': hotspot.recentCount / maximum,
                left: placement?.x ?? '50%',
                top: placement?.y ?? '50%',
                transform: placement ? `scale(${placement.scale})` : undefined,
                visibility: ready && placement ? 'visible' : 'hidden',
              } as CSSProperties
            }
            onClick={() => onSelect(hotspot.id)}
          >
            {hotspot.name}
            <span className={styles.wordArrow} aria-hidden="true">
              {symbols[hotspot.trend.state]}
            </span>
          </button>
        );
      })}
      {!hotspots.length && <p className={styles.cloudEmpty}>当前时段没有可展示的热点分类。</p>}
      {!ready && hotspots.length > 0 && (
        <p className={styles.cloudEmpty} role="status">
          正在排列热点…
        </p>
      )}
    </div>
  );
}
