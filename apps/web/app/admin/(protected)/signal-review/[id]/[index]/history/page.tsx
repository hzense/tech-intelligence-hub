import Link from 'next/link';
import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { candidateReviewDetail } from '@/lib/server/signal-generation';
import { CandidatePublicationActions } from '@/components/candidate-publication-actions';
import controls from '@/components/admin-controls.module.css';

export const metadata: Metadata = {
  title: '历史核验发布记录',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default async function HistoricalCandidatePage({
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
    /* Owner-scoped, safe missing state. */
  }
  return (
    <main className="section-shell">
      <h1>历史核验发布记录</h1>
      <p>
        仅用于核对与管理原签名核验通道的历史记录。新候选使用四项信息确认发布，不需要完成这些历史步骤。
      </p>
      {packet ? (
        <>
          <Link className={controls.button} href={`/admin/signal-review/${id}/${index}`}>
            返回四项确认发布
          </Link>
          <CandidatePublicationActions
            runId={packet.runId}
            candidateIndex={packet.candidateIndex}
            materialHash={packet.materialHash}
          />
        </>
      ) : (
        <p role="alert">记录不存在或不可访问。</p>
      )}
    </main>
  );
}
