import { createGenerationPreflightHandler } from '@/lib/admin-generation-preflight-handler';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { getAdminSession } from '@/lib/server/admin-auth';
import { generationPreflight } from '@/lib/server/signal-generation-preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const POST = createGenerationPreflightHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  preflight: generationPreflight,
});
