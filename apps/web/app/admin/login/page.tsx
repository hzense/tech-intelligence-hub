import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GoogleSignInButton } from '@/components/admin-auth-buttons';
import styles from '@/components/admin-auth.module.css';
import { SiteShell } from '@/components/site-shell';
import { getAdminSession, isAdminAuthConfigured } from '@/lib/server/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '管理员登录',
  description: 'HZense 管理员身份认证入口。',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await getAdminSession();
  if (session) redirect('/admin');

  const configured = isAdminAuthConfigured();
  const { error } = await searchParams;

  return (
    <SiteShell>
      <main className={`section-shell ${styles.main}`}>
        <section className={styles.card} aria-labelledby="admin-login-title">
          <p className="kicker">HZENSE 管理后台</p>
          <h1 className={styles.title} id="admin-login-title">
            管理员登录
          </h1>
          <p className={styles.copy}>使用 Google 账号继续。此入口仅限已获授权的管理员访问。</p>
          {!configured ? (
            <p className={styles.notice} role="status">
              管理员登录尚未配置完成
            </p>
          ) : error ? (
            <p className={styles.notice} role="alert">
              登录未完成，请确认使用已获授权的 Google 账号后重试。
            </p>
          ) : null}
          <div className={styles.actions}>
            <GoogleSignInButton disabled={!configured} />
            <Link className={styles.backLink} href="/">
              返回网站
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
