import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/site-shell';
import { requireAdminSession } from '@/lib/server/admin-auth';

// A build without OAuth configuration must not cache an anonymous redirect.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '管理后台',
  robots: { index: false, follow: false },
};

export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  await requireAdminSession();
  return <SiteShell>{children}</SiteShell>;
}
