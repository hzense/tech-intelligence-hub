import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminSourceDirectory } from '@/components/admin-source-directory';
import controls from '@/components/admin-controls.module.css';
import styles from '@/components/admin-source-directory.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getAdminSourceDirectory } from '@/lib/server/source-directory';

export const metadata: Metadata = { title: '信源', robots: { index: false, follow: false } };

export default async function AdminSourceRegistryPage() {
  await requireAdminSession();
  const directory = await getAdminSourceDirectory().catch(() => null);

  return (
    <main className={`section-shell ${styles.main}`}>
      <nav aria-label="信源导航">
        <Link className={controls.button} href="/admin" prefetch={false}>
          返回管理后台
        </Link>
      </nav>
      <h1 className={styles.title}>信源</h1>
      {directory ? (
        <AdminSourceDirectory directory={directory} />
      ) : (
        <p role="alert">暂时无法读取信源名录或公开信号，请刷新重试。</p>
      )}
    </main>
  );
}
