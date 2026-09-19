'use client';

import { useEffect, useState } from 'react';
import styles from './admin-signal-generation.module.css';

export type GenerationProgressRun = {
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

export function GenerationProgress({ run }: { run: GenerationProgressRun }) {
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
        : (labels[phase] ?? (active ? '执行中' : '待手动执行'));
  const start = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const end = active ? now : run.finished_at ? new Date(run.finished_at).getTime() : null;
  const elapsed =
    end !== null && Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / 1000)) : null;
  return (
    <section className={styles.progress} aria-label="任务执行进度">
      <p role="status">{label}</p>
      <progress aria-label="已完成的任务阶段" max={5} value={completed ? 5 : Math.max(0, phase)} />
      <small>排队 → 准备 → 生成 → 校验 → 保存。进度按已完成阶段计算，不代表 token 百分比。</small>
      {active && <progress aria-label={label} />}
      {elapsed !== null && (
        <small>
          已执行 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒
        </small>
      )}
      {active && <small>每 5 秒只读刷新。关闭页面不取消任务，也不会重新调用 AI。</small>}
      {failed && <small>未确认成功；费用记录保留，请勿重复执行。</small>}
    </section>
  );
}
