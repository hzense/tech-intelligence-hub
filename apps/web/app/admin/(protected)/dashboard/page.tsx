import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminNeonUsage } from '@/components/admin-neon-usage';
import controls from '@/components/admin-controls.module.css';
import styles from '@/components/admin-neon-usage.module.css';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getAdminUsageDashboard } from '@/lib/server/admin-usage';

export const metadata: Metadata = {
  title: '运营仪表盘',
  robots: { index: false, follow: false },
};

export default async function AdminDashboardPage() {
  const session = await requireAdminSession();
  const dashboard = await getAdminUsageDashboard(session.user.id);
  return (
    <main className={`section-shell ${styles.main}`}>
      <nav aria-label="运营仪表盘导航">
        <Link className={controls.button} href="/admin" prefetch={false}>
          返回管理后台
        </Link>
      </nav>
      <AdminNeonUsage initialDashboard={dashboard} />
    </main>
  );
}
