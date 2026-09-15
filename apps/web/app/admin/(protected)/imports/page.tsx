import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { importsConfigured } from '@/lib/server/import-service';
import { AdminImports } from '@/components/admin-imports';
export const metadata: Metadata = { title: '批量导入', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function ImportsPage() {
  await requireAdminSession();
  return <AdminImports configured={importsConfigured()} />;
}
