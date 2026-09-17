import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { generationDetail } from '@/lib/server/signal-generation';
export const metadata: Metadata = {
  title: '私有候选生成记录',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminSession();
  const { id } = await params;
  let run;
  try {
    run = await generationDetail(session.user.id, id);
  } catch {
    /* Fixed, non-sensitive error. */
  }
  return (
    <main className="section-shell">
      <h1>私有候选生成记录</h1>
      <p>仅显示已保存结果，不调用 AI。候选未经独立事实核验，不代表已发表。</p>
      {run ? (
        <>
          <p>任务：{run.id}</p>
          <p>状态：{run.status}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(run, null, 2)}
          </pre>
        </>
      ) : (
        <p>记录不存在、无权访问或生成服务尚未配置。</p>
      )}
      <Link href="/admin/signal-generation">返回候选生成工作台</Link>
    </main>
  );
}
