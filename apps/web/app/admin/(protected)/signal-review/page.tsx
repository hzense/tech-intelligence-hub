import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { candidateReviewQueue } from '@/lib/server/signal-generation';
import controls from '@/components/admin-controls.module.css';
import styles from '@/components/candidate-review.module.css';

export const metadata: Metadata = {
  title: '候选审核工作台',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default async function CandidateReviewPage() {
  const session = await requireAdminSession();
  let rows: Awaited<ReturnType<typeof candidateReviewQueue>> | null = null;
  try {
    rows = await candidateReviewQueue(session.user.id);
  } catch {
    /* No private errors. */
  }
  return (
    <main className="section-shell">
      <h1>候选审核工作台</h1>
      <p>审核准备阶段：阅读候选、对照原文、查看发布缺项。目前不保存审核决定，也不公开发布。</p>
      <p>
        仅列出当前管理员最近 50
        个可见任务中，已完成且通过当前结构与引用复检的候选；不是全部历史记录。
      </p>
      {rows === null ? (
        <p role="alert">审核资料暂不可读，请检查配置后刷新；不表示没有候选。</p>
      ) : rows.length === 0 ? (
        <p>当前范围内没有可审核候选。旧格式或不符合当前校验规则的记录请到原任务查看。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>候选审核准备列表（{rows.length} 条）</caption>
            <thead>
              <tr>
                <th scope="col">候选信号</th>
                <th scope="col">资料</th>
                <th scope="col">事件时间</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.runId}/${row.index}`}>
                  <td>{row.title}</td>
                  <td>{row.sourceName}</td>
                  <td>{row.eventDate ?? '待补证'}</td>
                  <td>待核对 · {row.missingItems} 项发布待办</td>
                  <td>
                    <Link
                      className={controls.button}
                      href={`/admin/signal-review/${row.runId}/${row.index}`}
                    >
                      查看审核材料
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={controls.group}>
        <Link className={controls.button} href="/admin/signal-generation">
          AI 生成任务
        </Link>
        <Link className={controls.button} href="/admin">
          返回管理后台
        </Link>
      </div>
    </main>
  );
}
