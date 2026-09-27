import type { Metadata } from 'next';
import { SiteShell } from '@/components/site-shell';
import { PublicSignalCards } from '@/components/public-signal-cards';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import styles from '@/components/public-signal-cards.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '信号',
  description: '按事件发生时间浏览所有可公开读取的科技信号。',
  alternates: { canonical: '/signals' },
};

export default async function SignalsPage() {
  const { signals } = await getPublicExploration();
  const entries = [...signals].sort(
    (left, right) =>
      right.occurred_at.localeCompare(left.occurred_at) || left.id.localeCompare(right.id),
  );

  return (
    <SiteShell>
      <main className={`page-main section-shell ${styles.page}`}>
        <section className={styles.hero}>
          <p className="kicker">HZENSE SIGNALS</p>
          <h1>每一个变化，都有迹可循。</h1>
          <p>
            所有可公开读取的信号按事件发生时间倒序排列。点击标题或详情链接，查看完整判断、相关人物组织与公开来源。
          </p>
        </section>
        <section aria-label="信号列表">
          <div className={styles.listHeader}>
            <div>
              <span className={styles.eyebrow}>SIGNAL STREAM</span>
              <h2>全部信号</h2>
            </div>
            <p>{entries.length} 条 · 最新事件在前</p>
          </div>
          {entries.length ? (
            <PublicSignalCards signals={entries} />
          ) : (
            <p className={styles.empty}>
              暂无可公开读取的信号。已撤回或未发布的候选不会出现在这里。
            </p>
          )}
        </section>
      </main>
    </SiteShell>
  );
}
