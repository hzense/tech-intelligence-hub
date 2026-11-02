import { createNeonUsageAdminHandler } from '@/lib/neon-usage-handlers';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { collectNeonUsage } from '@/lib/server/neon-usage';
import { getAdminUsageDashboard } from '@/lib/server/admin-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handler = createNeonUsageAdminHandler({
  authenticate: getAdminSession,
  origin: getAdminOrigin,
  dashboard: (session) => getAdminUsageDashboard(session.user.id),
  sample: collectNeonUsage,
});
export const GET = handler;
export const POST = handler;
