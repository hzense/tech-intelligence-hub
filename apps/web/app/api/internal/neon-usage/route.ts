import { createNeonUsageScheduledHandler } from '@/lib/neon-usage-handlers';
import { collectNeonUsage } from '@/lib/server/neon-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = createNeonUsageScheduledHandler({
  secret: () => process.env.HZENSE_NEON_USAGE_CRON_SECRET,
  sample: collectNeonUsage,
});
