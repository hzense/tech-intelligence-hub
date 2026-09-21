import { redirect } from 'next/navigation';
import { requireAdminSession } from '@/lib/server/admin-auth';

export const dynamic = 'force-dynamic';

// Preserve old bookmarks without retaining a second candidate dashboard.
export default async function LegacyCandidateReviewPage() {
  await requireAdminSession();
  redirect('/admin/signal-generation');
}
