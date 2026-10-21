import { createAutomaticPublicationHandler } from '@/lib/admin-automatic-publication-handler';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { publishGeneratedSignals } from '@/lib/server/editorial-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const POST = createAutomaticPublicationHandler({
  session: getAdminSession,
  origin: () => getAdminOrigin() ?? undefined,
  publish: publishGeneratedSignals,
});
