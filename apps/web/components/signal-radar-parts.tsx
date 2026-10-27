'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { RadarHotspot } from '@/lib/radar-hotspots';
import type { RadarResourceObservation } from '@/lib/signal-radar-model';
import styles from './signal-radar.module.css';

export function RadarSparkline({
  series,
  compact = false,
}: {
  series: RadarHotspot['series'];
  compact?: boolean;
}) {
  const maximum = Math.max(1, ...series.map((point) => point.count));
  const points = series.map(
    (point, i) =>
      `${6 + (i * 228) / Math.max(1, series.length - 1)},${66 - (point.count / maximum) * 54}`,
  );
  return (
    <svg
      className={compact ? styles.miniCurve : styles.curve}
      viewBox="0 0 240 78"
      aria-hidden={compact ? true : undefined}
      role={compact ? undefined : 'img'}
      aria-label={
        compact ? undefined : `所选时段八段信号数：${series.map((point) => point.count).join('、')}`
      }
    >
      {!compact && <line x1="6" x2="234" y1="66" y2="66" className={styles.curveBaseline} />}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={compact ? 5 : 2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!compact &&
        series.map((point, i) => (
          <circle
            key={i}
            cx={6 + (i * 228) / Math.max(1, series.length - 1)}
            cy={66 - (point.count / maximum) * 54}
            r="3"
            fill="currentColor"
          />
        ))}
    </svg>
  );
}

export function RadarResource({ resource }: { resource: RadarResourceObservation }) {
  const [failedImage, setFailedImage] = useState<string>();
  const initials = resource.name
    .trim()
    .split(/\s+/)
    .map((word) => [...word][0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase();
  const href = `${resource.type === 'person' ? '/persons' : '/resources'}/${encodeURIComponent(resource.id)}`;
  return (
    <article className={styles.resource} data-resource-id={resource.id}>
      <Link className={styles.resourceIdentity} href={href} prefetch={false}>
        <span className={styles.avatar} data-kind={resource.type}>
          {resource.media && failedImage !== resource.media.url ? (
            <Image
              src={resource.media.url}
              alt=""
              width={42}
              height={42}
              unoptimized
              onError={() => setFailedImage(resource.media?.url)}
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </span>
        <span>
          <strong>{resource.name}</strong>
          <small>{resource.recentCount} 条关联信号</small>
        </span>
      </Link>
      {resource.summary && <p>{resource.summary}</p>}
      <div className={styles.resourceSources}>
        {resource.profileSourceUrl && (
          <a href={resource.profileSourceUrl} target="_blank" rel="noopener noreferrer">
            简介来源 ↗
          </a>
        )}
        {resource.media && (
          <a
            href={resource.media.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`${resource.media.credit} · ${resource.media.license}`}
          >
            图像来源与许可 ↗
          </a>
        )}
      </div>
    </article>
  );
}
