import { permanentRedirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/server/admin-auth';

export default async function LegacyNeonUsagePage() {
  await requireAdminSession();
  permanentRedirect('/admin/dashboard');
}
