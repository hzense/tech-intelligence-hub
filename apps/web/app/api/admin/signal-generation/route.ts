import { createGenerationHandler } from '@/lib/admin-signal-generation-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import {
  generationDashboard,
  generationDetail,
  executeGeneration,
  inspectGenerationInput,
} from '@/lib/server/signal-generation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fluid Compute: 285s provider deadline plus 15s for pre/postflight and persistence.
export const maxDuration = 300;
export const GET = createGenerationHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  dashboard: generationDashboard,
  detail: generationDetail,
  execute: executeGeneration,
  inspectSource: inspectGenerationInput,
});
export const POST = GET;
