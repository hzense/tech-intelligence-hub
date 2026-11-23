import type { SignalGenerationStats } from '../lib/signal-generation-stats';
import controls from './admin-controls.module.css';
import styles from './admin-neon-usage.module.css';

export function AdminGenerationStats({ stats }: { stats?: SignalGenerationStats | null }) {
  const publication = stats?.publication;
  return (
    <section className={styles.panel} aria-labelledby="generation-stats-title">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="generation-stats-title">信号生成统计</h2>
          <p className={styles.muted}>当前管理员 · 全部未删除的生成任务</p>
        </div>
        <a className={controls.button} href="/admin/signal-generation">
          查看生成任务
        </a>
      </div>
      {stats ? (
        <>
          <dl className={styles.computeMetrics} aria-label="候选发布状态">
            <div>
              <dt>累计生成候选</dt>
              <dd>{stats.candidates}</dd>
            </div>
            <div>
              <dt>待发布（含草稿）</dt>
              <dd>{publication?.pending ?? '待核对'}</dd>
            </div>
            <div>
              <dt>已发布</dt>
              <dd>{publication?.published ?? '待核对'}</dd>
            </div>
            <div>
              <dt>已撤回</dt>
              <dd>{publication?.withdrawn ?? '待核对'}</dd>
            </div>
          </dl>
          <p className={styles.muted}>
            今日生成 {stats.todayCandidates} 条候选（按柏林时间的任务完成日期）。累计 {stats.tasks}{' '}
            个任务，已完成 {stats.completed} 个，失败 {stats.failed} 个。
          </p>
        </>
      ) : (
        <p className={styles.muted}>生成统计暂不可用，请稍后刷新记录。</p>
      )}
    </section>
  );
}
