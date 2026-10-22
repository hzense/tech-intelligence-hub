import { createLocalAutomationSchedulerHandler } from '@/lib/local-automation-scheduler-handler';
import { dispatchDueAutomations } from '@/lib/server/automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = createLocalAutomationSchedulerHandler({
  environment: () => process.env,
  dispatch: dispatchDueAutomations,
});
