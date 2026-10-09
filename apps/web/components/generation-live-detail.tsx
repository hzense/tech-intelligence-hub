'use client';
import { useEffect, useState } from 'react';
import {
  GenerationProgress,
  generationIsActive,
  type GenerationProgressRun,
} from './generation-progress';
import { PrivateResult } from './private-generation-result';
import controls from './admin-controls.module.css';
import type { GenerationPublication } from '../lib/generation-publication';
import { GenerationPublicationSummary } from './generation-publication-status';

type GenerationDetailRun = GenerationProgressRun & {
  result?: unknown;
  publication?: GenerationPublication;
};

export function GenerationLiveDetail({ initialRun }: { initialRun: GenerationDetailRun }) {
  const [run, setRun] = useState(initialRun);
  const [error, setError] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [queueConfirmation, setQueueConfirmation] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const active = generationIsActive(run);
  useEffect(() => {
    if (!active || resolving || refreshing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(
          `/api/admin/signal-generation?id=${encodeURIComponent(initialRun.id)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new Error('unavailable');
        const { run: next } = await response.json();
        if (!next || next.id !== initialRun.id) throw new Error('identity_mismatch');
        if (!controller.signal.aborted) {
          setRun(next);
          if (generationIsActive(next)) timer = setTimeout(poll, 5000);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    timer = setTimeout(poll, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, initialRun.id, resolving, refreshing]);
  async function refresh() {
    if (refreshing || resolving) return;
    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/admin/signal-generation?id=${encodeURIComponent(run.id)}`,
        {
          cache: 'no-store',
        },
      );
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!data.run || data.run.id !== run.id) throw new Error('identity_mismatch');
      setRun(data.run);
      setError(false);
      setNotice('任务与发布状态已刷新；未调用 AI。');
    } catch {
      setError(true);
      setNotice('');
    } finally {
      setRefreshing(false);
    }
  }
  async function resolveQueue() {
    if (!run.progress_at || resolving || !queueConfirmation) return;
    setResolving(true);
    try {
      const response = await fetch('/api/admin/signal-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_queue',
          id: run.id,
          queuedAt: queueConfirmation,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setNotice(
          ['task_active', 'stale_attempt'].includes(data.error)
            ? '任务已开始执行或排队状态已变化，未标记失败。请刷新核对。'
            : '处理结果尚未确认，请刷新核对原任务；不会重新调用 AI。',
        );
        return;
      }
      if (!data.run || data.run.id !== run.id || data.run.status !== 'failed')
        throw new Error('unconfirmed');
      setRun(data.run);
      setNotice('已结束排队并标记为失败。原记录和费用保留，未调用 AI。');
    } catch {
      setNotice('处理结果尚未确认，请刷新核对原任务；不会重新调用 AI。');
    } finally {
      setResolving(false);
    }
  }
  return (
    <>
      <p>任务：{run.id}</p>
      <GenerationProgress run={run} />
      {run.status === 'completed' && (
        <p>
          <GenerationPublicationSummary status={run.status} publication={run.publication} />
        </p>
      )}
      <button
        className={controls.button}
        type="button"
        disabled={refreshing || resolving}
        onClick={() => void refresh()}
      >
        {refreshing ? '正在刷新…' : '刷新任务与发布状态'}
      </button>
      {run.status === 'pending' &&
        run.progress_phase === 'queued' &&
        run.progress_at &&
        !run.started_at && (
          <div>
            <p>排队长期没有开始时，可结束这次排队并标记失败。已开始执行的任务不会被此操作中断。</p>
            {queueConfirmation ? (
              <div role="group" aria-label="确认结束排队">
                <p>
                  确认将这次尚未开始的排队任务标记为失败？原记录和费用保留，不会调用 AI 或重新生成。
                </p>
                <button
                  className={controls.button}
                  type="button"
                  disabled={resolving || refreshing}
                  onClick={() => void resolveQueue()}
                >
                  {resolving ? '正在结束排队…' : '确认标记失败'}
                </button>
                <button
                  className={controls.button}
                  type="button"
                  disabled={resolving}
                  onClick={() => setQueueConfirmation(null)}
                >
                  返回
                </button>
              </div>
            ) : (
              <button
                className={controls.button}
                type="button"
                onClick={() => setQueueConfirmation(new Date(run.progress_at!).toISOString())}
              >
                结束排队并标记失败
              </button>
            )}
          </div>
        )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">状态刷新失败，显示最后一次已保存状态。请刷新页面核对；不会重新调用 AI。</p>
      )}
      <PrivateResult result={run.result} reviewTask={run} />
      <details>
        <summary>查看完整任务记录</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(run, null, 2)}
        </pre>
      </details>
    </>
  );
}
