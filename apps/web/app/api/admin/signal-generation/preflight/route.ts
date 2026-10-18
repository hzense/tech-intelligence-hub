import { createGenerationPreflightHandler } from '@/lib/admin-generation-preflight-handler';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { generationPreflight } from '@/lib/server/signal-generation-preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const POST = createGenerationPreflightHandler({
  session: getAdminSession,
  origin: () => getAdminOrigin() ?? undefined,
  preflight: generationPreflight,
});
