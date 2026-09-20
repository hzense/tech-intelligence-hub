import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { candidateReviewDetail } from '@/lib/server/signal-generation';
import { CandidateReview } from '@/components/candidate-review';
import controls from '@/components/admin-controls.module.css';

export const metadata: Metadata = {
  title: '候选审核材料',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default async function CandidateReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string; index: string }>;
}) {
  const session = await requireAdminSession();
  const { id, index } = await params;
  let packet;
  try {
    if (/^[0-4]$/.test(index))
      packet = await candidateReviewDetail(session.user.id, id, Number(index));
  } catch {
    /* Missing, unowned, deleted and invalid records share a safe response. */
  }
  return (
    <main className="section-shell">
      <h1>候选审核材料</h1>
      {packet ? (
        <CandidateReview packet={packet} />
      ) : (
        <>
          <p role="alert">
            候选不存在、无权访问或未通过当前材料复检。请返回原任务核对；未执行任何修改。
          </p>
          <Link className={controls.button} href="/admin/signal-review">
            返回候选审核工作台
          </Link>
        </>
      )}
    </main>
  );
}
