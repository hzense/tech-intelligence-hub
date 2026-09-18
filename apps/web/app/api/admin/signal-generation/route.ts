import { createGenerationHandler } from '@/lib/admin-signal-generation-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import {
  generationDashboard,
  executeGeneration,
  inspectGenerationInput,
} from '@/lib/server/signal-generation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createGenerationHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  dashboard: generationDashboard,
  execute: executeGeneration,
  inspectSource: inspectGenerationInput,
});
export const POST = GET;
