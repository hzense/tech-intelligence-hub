'use client';

import { useEffect, useState } from 'react';
import styles from './admin-signal-generation.module.css';
import { isLocalSimulationRecord, type GenerationUiMode } from '../lib/generation-ui-mode';

export type GenerationProgressRun = GenerationUiMode & {
  id: string;
  status: string;
  progress_phase?: string | null;
  progress_at?: string | Date | null;
  started_at?: string | Date | null;
  finished_at?: string | Date | null;
};
export function generationIsActive(run: GenerationProgressRun) {
  return run.status === 'running' || (run.status === 'pending' && run.progress_phase === 'queued');
}
const phases = ['queued', 'preparing', 'generating', 'validating', 'saving'];
const labels = ['排队中', '准备资料与预算', '模型生成中', '校验证据与结构', '保存私有候选'];

export function GenerationProgress({
  run,
  localMode = false,
  localRealAi = false,
}: {
  run: GenerationProgressRun;
  localMode?: boolean;
  localRealAi?: boolean;
}) {
  const localSimulation = isLocalSimulationRecord(run, localMode, localRealAi);
  const active = generationIsActive(run);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const phase = phases.indexOf(run.progress_phase ?? '');
  const completed = run.status === 'completed';
  const failed = run.status === 'failed' || run.status === 'unknown';
  const label = completed
    ? '已完成'
    : failed
      ? '失败，需核对原任务'
      : run.status === 'cancelled'
        ? '已取消'
        : ((localSimulation && phase === 2 ? '本地模拟中' : labels[phase]) ??
          (active ? '执行中' : '待手动执行'));
  const start = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const end = active ? now : run.finished_at ? new Date(run.finished_at).getTime() : null;
  const elapsed =
    end !== null && Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / 1000)) : null;
  return (
    <section className={styles.progress} aria-label="任务执行进度">
      <p role="status">{label}</p>
      <progress aria-label="已完成的任务阶段" max={5} value={completed ? 5 : Math.max(0, phase)} />
      <small>
        {localSimulation
          ? '排队 → 准备 → 本地模拟 → 校验 → 保存。不调用模型，进度仅代表流程阶段。'
          : '排队 → 准备 → 生成 → 校验 → 保存。进度按已完成阶段计算，不代表 token 百分比。'}
      </small>
      {active && <progress aria-label={label} />}
      {elapsed !== null && (
        <small>
          已执行 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒
        </small>
      )}
      {active && (
        <small>每 15 秒只读刷新进度，隐藏页面时暂停。关闭页面不取消任务，也不会重新调用 AI。</small>
      )}
      {failed && (
        <small>
          {localSimulation
            ? '未确认成功；本地任务和技术预留记录保留，请勿重复执行。不产生供应商费用。'
            : '未确认成功；费用记录保留，请勿重复执行。'}
        </small>
      )}
    </section>
  );
}
