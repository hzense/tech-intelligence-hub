import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getAiDashboard } from '@/lib/server/admin-ai';
import { AdminAiProfiles } from '@/components/admin-ai-profiles';
import { AiNavigation } from '@/components/admin-ai-shared';
import styles from '@/components/admin-ai.module.css';

export const metadata: Metadata = {
  title: '分阶段模型配置',
  robots: { index: false, follow: false },
};
export default async function AdminAiProfilesPage() {
  await requireAdminSession();
  const state = await getAiDashboard();
  return (
    <main className={`section-shell ${styles.main}`}>
      <AiNavigation />
      <header className={styles.header}>
        <p className="kicker">管理后台 · AI</p>
        <h1>分阶段模型配置</h1>
        <p className={styles.muted}>
          分别管理信号提取、独立核验与专题分析的模型、提示词和参数版本。
        </p>
      </header>
      <AdminAiProfiles
        initialProfiles={state.profiles}
        initialProbes={state.probes}
        connections={state.connections}
        configured={state.configured}
        available={state.available}
      />
    </main>
  );
}
