import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminSignOutButton } from '@/components/admin-auth-buttons';
import styles from '@/components/admin-auth.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { isPublisherConfigured } from '@/lib/server/signal-publication';
import { AdminPublicationForm } from '@/components/admin-publication-form';

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
        <p className={styles.copy}>
          已接通管理员认证、AI
          连接与模型配置及受限信号发布入口。信号采集、文档与链接批量导入功能仍待实现；AI
          服务须另行配置后方可使用。
        </p>
        <dl className={styles.account}>
          <dt>当前登录账号</dt>
          <dd>{session.user.email}</dd>
        </dl>
        <div className={styles.actions}>
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
      <AdminPublicationForm
        configured={isPublisherConfigured()}
        databaseMode={process.env.HZENSE_SIGNAL_READ_MODE === 'database'}
      />
    </main>
  );
}
