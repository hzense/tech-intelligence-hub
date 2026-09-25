import { createEditorialHandler } from '@/lib/admin-editorial-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { editorialDashboard, writeEditorialReview } from '@/lib/server/editorial-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createEditorialHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  read: editorialDashboard,
  write: writeEditorialReview,
});
export const POST = GET;
