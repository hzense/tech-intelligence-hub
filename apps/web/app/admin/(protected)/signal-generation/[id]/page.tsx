import type { Metadata } from 'next';
import Link from 'next/link';
import controls from '@/components/admin-controls.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { generationDetail } from '@/lib/server/signal-generation';
import { GenerationLiveDetail } from '@/components/generation-live-detail';
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
      <p>
        查看和刷新不会调用
        AI。生成结果保留原始候选，是否公开以最新发布状态为准。未开始的排队任务可手动标记失败。
      </p>
      {run ? (
        <GenerationLiveDetail key={run.id} initialRun={run} />
      ) : (
        <p>记录不存在、无权访问或生成服务尚未配置。</p>
      )}
      <Link className={controls.button} href="/admin/signal-generation">
        返回候选生成工作台
      </Link>
    </main>
  );
}
