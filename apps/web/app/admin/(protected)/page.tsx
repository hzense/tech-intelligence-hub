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
        <p className={styles.copy}>
          当前仅接通管理员认证入口。信号采集配置、文档与链接批量导入功能仍待实现，暂不提供执行入口。
        </p>
        <dl className={styles.account}>
          <dt>当前登录账号</dt>
          <dd>{session.user.email}</dd>
        </dl>
        <div className={styles.actions}>
          <AdminSignOutButton />
          <Link className={styles.backLink} href="/">
            返回网站
          </Link>
        </div>
      </section>
    </main>
  );
}
