import { createEditorialHandler } from '@/lib/admin-editorial-handler';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { editorialDashboard, writeEditorialReview } from '@/lib/server/editorial-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createEditorialHandler({
  session: getAdminSession,
  origin: () => getAdminOrigin() ?? undefined,
  read: editorialDashboard,
  write: writeEditorialReview,
});
export const POST = GET;
