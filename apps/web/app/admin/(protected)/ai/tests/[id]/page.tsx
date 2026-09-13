import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { executeAiAdmin } from '@/lib/server/admin-ai';
import { AiNavigation, ProbeSummary } from '@/components/admin-ai-shared';
import type { AiProbe } from '../../../../../../../../packages/database/src/ai-config-store.mjs';
import styles from '@/components/admin-ai.module.css';

export const metadata: Metadata = { title: 'AI 测试记录', robots: { index: false, follow: false } };
export default async function AdminAiTestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) notFound();
  let probe: AiProbe | undefined;
  let missing = false;
  try {
    probe = ((await executeAiAdmin('get-probe', { id })) as { probe: AiProbe }).probe;
  } catch (error) {
    missing = Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'not_found',
    );
  }
  if (missing) notFound();
  return (
    <main className={`section-shell ${styles.main}`}>
      <AiNavigation />
      <header className={styles.header}>
        <h1>AI 测试记录</h1>
      </header>
      {probe ? (
        <ProbeSummary probe={probe} />
      ) : (
        <p className={styles.notice} role="status">
          测试记录暂不可用，请检查后台配置并稍后刷新。不要因读取失败重复发起新测试。
        </p>
      )}
    </main>
  );
}
