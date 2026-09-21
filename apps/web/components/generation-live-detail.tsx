'use client';
import { useEffect, useState } from 'react';
import {
  GenerationProgress,
  generationIsActive,
  type GenerationProgressRun,
} from './generation-progress';
import { PrivateResult } from './private-generation-result';

export function GenerationLiveDetail({
  initialRun,
}: {
  initialRun: GenerationProgressRun & { result?: unknown };
}) {
  const [run, setRun] = useState(initialRun);
  const [error, setError] = useState(false);
  const active = generationIsActive(run);
  useEffect(() => {
    if (!active) return;
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
  }, [active, initialRun.id]);
  return (
    <>
      <p>任务：{run.id}</p>
      <GenerationProgress run={run} />
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
