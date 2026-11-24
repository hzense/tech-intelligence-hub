import type { Metadata } from 'next';
import Link from 'next/link';
import controls from '@/components/admin-controls.module.css';
import table from '@/components/admin-task-table.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { editorialPool } from '@/lib/server/editorial-database';
import { generationHistoryPool } from '@/lib/server/generation-database';
import { readUnpublishedCandidates } from '@/lib/signal-generation-stats';

export const metadata: Metadata = {
  title: '未发布候选信号',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const path = '/admin/signal-generation/unpublished';

export default async function UnpublishedCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await requireAdminSession();
  const { page: rawPage } = await searchParams;
  const page = typeof rawPage === 'string' && /^[1-9]\d{0,7}$/.test(rawPage) ? Number(rawPage) : 1;
  const result = await readUnpublishedCandidates(
    session.user.id,
    generationHistoryPool,
    editorialPool,
    page,
  ).catch(() => null);
  return (
    <main className="section-shell">
      <Link className={controls.button} href="/admin/signal-generation" prefetch={false}>
        返回生成任务
      </Link>
      <h1>未发布候选信号</h1>
      {!result ? (
        <p role="alert">暂时无法核对发布状态，请刷新重试。</p>
      ) : result.candidates.length > 0 ? (
        <div className={table.scroll} role="region" aria-label="未发布候选表格" tabIndex={0}>
          <table className={table.table}>
            <caption>当前管理员的未发布候选，按生成完成时间从新到旧排列。</caption>
            <thead>
              <tr>
                <th scope="col">信号标题</th>
                <th scope="col">发布状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {result.candidates.map((candidate) => {
                const title = candidate.title || `候选 ${candidate.index + 1}`;
                return (
                  <tr key={`${candidate.runId}/${candidate.index}`}>
                    <th scope="row">{title}</th>
                    <td>{candidate.status === 'draft' ? '草稿 · 未发布' : '未发布'}</td>
                    <td>
                      <Link
                        className={controls.button}
                        prefetch={false}
                        href={`/admin/signal-review/${candidate.runId}/${candidate.index}`}
                        aria-label={`处理未发布信号：${title}`}
                      >
                        处理未发布信号
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{page === 1 ? '当前没有待发布的候选信号。' : '本页已无待发布候选。'}</p>
      )}
      {result && (page > 1 || result.hasNext) && (
        <nav className={controls.group} aria-label="未发布候选分页">
          {page > 1 && (
            <Link className={controls.button} prefetch={false} href={`${path}?page=${page - 1}`}>
              上一页
            </Link>
          )}
          <span>第 {page} 页</span>
          {result.hasNext && (
            <Link className={controls.button} prefetch={false} href={`${path}?page=${page + 1}`}>
              下一页
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
