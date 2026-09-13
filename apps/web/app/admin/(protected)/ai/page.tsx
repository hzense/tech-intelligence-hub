import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getAiDashboard } from '@/lib/server/admin-ai';
import { AdminAiConsole } from '@/components/admin-ai-console';
import { AiNavigation } from '@/components/admin-ai-shared';
import styles from '@/components/admin-ai.module.css';

export const metadata: Metadata = {
  title: 'AI 连接与模型测试',
  robots: { index: false, follow: false },
};
export default async function AdminAiPage() {
  await requireAdminSession();
  const state = await getAiDashboard();
  return (
    <main className={`section-shell ${styles.main}`}>
      <AiNavigation />
      <header className={styles.header}>
        <p className="kicker">管理后台 · AI</p>
        <h1>AI 连接与模型测试</h1>
        <p className={styles.muted}>
          安全管理接口、凭证与模型能力。测试使用固定内容，可能产生供应商费用；此页面不采集或发布信号。
        </p>
      </header>
      <AdminAiConsole
        initialConnections={state.connections}
        initialProbes={state.probes}
        configured={state.configured}
        available={state.available}
        allowedHosts={state.allowedHosts}
      />
    </main>
  );
}
