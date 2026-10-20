import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminSignOutButton } from '@/components/admin-auth-buttons';
import styles from '@/components/admin-auth.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { isLocalDevelopment, isLocalRealAi } from '@/lib/local-development';

export const metadata: Metadata = {
  title: '管理后台',
  robots: { index: false, follow: false },
};

export default async function AdminHomePage() {
  // Pages must authenticate independently; a layout is not an authorization boundary.
  const session = await requireAdminSession();
  const local = isLocalDevelopment();

  return (
    <main className={`section-shell ${styles.main}`}>
      <section className={styles.card} aria-labelledby="admin-home-title">
        <p className="kicker">HZENSE 管理后台</p>
        <h1 className={styles.title} id="admin-home-title">
          {local ? '本地开发后台' : '管理员身份已验证'}
        </h1>
        <p className={styles.copy}>管理文档导入、信号候选审核、自动采集、专题洞察和 AI 配置。</p>
        {local && isLocalRealAi() ? (
          <p className={styles.copy}>
            当前为本地真实 AI 模式：AI
            测试和生成会请求供应商，可能产生费用；生成资料会发送给所选供应商，候选与发布保存在本地。
          </p>
        ) : null}
        <dl className={styles.account}>
          <dt>{local ? '当前访问方式' : '当前登录账号'}</dt>
          <dd>{local ? '本机直接访问，无需登录；业务数据写入本地数据库。' : session.user.email}</dd>
        </dl>
        <div className={styles.actions}>
          <Link className={styles.backLink} href="/admin/imports">
            文档与链接批量导入
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
          {!local ? <AdminSignOutButton /> : null}
          <Link className={styles.backLink} href="/">
            {local ? '返回首页' : '返回网站'}
          </Link>
        </div>
      </section>
    </main>
  );
}
