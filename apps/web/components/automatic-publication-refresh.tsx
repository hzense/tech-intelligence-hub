'use client';

import { useEffect, useRef, useState } from 'react';
import type { GenerationPublication } from '../lib/generation-publication';

type PublicationRun = {
  id: string;
  status: string;
  automatic_publication?: boolean;
  finished_at?: string | Date | null;
  publication?: GenerationPublication;
};

const delays = [15_000, 30_000, 60_000] as const;
const recentWindow = 5 * 60_000;

function needsRefresh(run: PublicationRun) {
  return (
    run.status === 'completed' &&
    run.automatic_publication === true &&
    (run.publication?.state !== 'available' ||
      run.publication.candidates.some((candidate) => candidate.status === 'unpublished'))
  );
}

/** Generation can finish before its separate publication step. Perform at most
 * three targeted readbacks, never restart generation or keep incomplete tasks
 * polling forever. Old tasks are left to the existing manual refresh controls. */
export function AutomaticPublicationRefresh<T extends PublicationRun>({
  run,
  onUpdate,
}: {
  run: T;
  onUpdate(next: T): void;
}) {
  const update = useRef(onUpdate);
  const [state, setState] = useState<'waiting' | 'finished'>('waiting');
  const pending = needsRefresh(run);
  const finishedAt =
    typeof run.finished_at === 'string'
      ? Date.parse(run.finished_at)
      : run.finished_at instanceof Date
        ? run.finished_at.getTime()
        : NaN;
  const id = run.id;
  useEffect(() => {
    update.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!pending) return;
    const age = Date.now() - finishedAt;
    if (!Number.isFinite(age) || age < 0 || age > recentWindow) {
      setState('finished');
      return;
    }
    setState('waiting');
    let attempt = 0;
    let disposed = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | null = null;
    const visible = () => document.visibilityState !== 'hidden';
    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
    function schedule(delay: number) {
      clearTimer();
      if (!disposed && !settled && !inFlight && visible()) timer = setTimeout(tick, delay);
    }
    async function tick() {
      timer = undefined;
      if (disposed || settled || inFlight || !visible()) return;
      const controller = new AbortController();
      inFlight = controller;
      attempt++;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`/api/admin/signal-generation?id=${encodeURIComponent(id)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('publication_unavailable');
        const { run: next } = await response.json();
        if (
          !next ||
          next.id !== id ||
          next.status !== 'completed' ||
          next.automatic_publication !== true
        )
          throw new Error('publication_identity_mismatch');
        if (!disposed && !controller.signal.aborted) {
          update.current(next as T);
          settled = !needsRefresh(next);
        }
      } catch {
        // Preserve the last confirmed state. Failed reads consume the same
        // bounded allowance and never authorize a write or paid retry.
      } finally {
        clearTimeout(timeout);
        inFlight = null;
        if (!disposed) {
          if (settled || attempt >= delays.length) {
            settled = true;
            setState('finished');
          } else schedule(delays[attempt] ?? 60_000);
        }
      }
    }
    function visibilityChanged() {
      clearTimer();
      if (!visible()) inFlight?.abort();
      else schedule(delays[Math.min(attempt, delays.length - 1)] ?? 60_000);
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    schedule(delays[0]);
    return () => {
      disposed = true;
      clearTimer();
      inFlight?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [id, pending, finishedAt]);

  if (!pending) return null;
  return (
    <p role="status" aria-label="自动发布状态刷新">
      {state === 'waiting'
        ? '生成已完成，正在短时核对自动发布状态；不调用 AI。'
        : '自动刷新已结束。未发布项可刷新状态或进入信号管理处理；不会重新生成。'}
    </p>
  );
}
