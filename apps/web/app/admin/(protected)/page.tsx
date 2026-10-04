import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminSignOutButton } from '@/components/admin-auth-buttons';
import styles from '@/components/admin-auth.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';

export const metadata: Metadata = {
  title: '管理后台',
  robots: { index: false, follow: false },
};

export default async function AdminHomePage() {
  // Pages must authenticate independently; a layout is not an authorization boundary.
  const session = await requireAdminSession();

  return (
    <main className={`section-shell ${styles.main}`}>
      <section className={styles.card} aria-labelledby="admin-home-title">
        <p className="kicker">HZENSE 管理后台</p>
        <h1 className={styles.title} id="admin-home-title">
          管理员身份已验证
        </h1>
        <p className={styles.copy}>管理文档导入、信号候选审核、自动采集、专题洞察和 AI 配置。</p>
        <dl className={styles.account}>
          <dt>当前登录账号</dt>
          <dd>{session.user.email}</dd>
        </dl>
        <div className={styles.actions}>
          <Link className={styles.backLink} href="/admin/imports">
            文档与链接批量导入
          </Link>
          <Link className={styles.backLink} href="/admin/signals">
            信号只读工作台
          </Link>
          <Link className={styles.backLink} href="/admin/signal-generation">
            AI 信号候选生成
          </Link>
          <Link className={styles.backLink} href="/admin/sources">
            自动采集配置
          </Link>
          <Link className={styles.backLink} href="/admin/topics">
            专题洞察任务
          </Link>
          <Link className={styles.backLink} href="/admin/ai">
            AI 连接与模型测试
          </Link>
          <Link className={styles.backLink} href="/admin/ai/profiles">
            分阶段模型配置
          </Link>
          <AdminSignOutButton />
          <Link className={styles.backLink} href="/">
            返回网站
          </Link>
        </div>
      </section>
    </main>
  );
}
