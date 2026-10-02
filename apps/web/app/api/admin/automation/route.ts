import { createAutomationHandler } from '@/lib/admin-automation-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import {
  automationDashboard,
  saveAutomation,
  deleteAutomation,
  triggerAutomation,
  publishAutomationInsight,
} from '@/lib/server/automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handler = createAutomationHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  dashboard: automationDashboard,
  save: (owner, request) => saveAutomation(owner, request as Parameters<typeof saveAutomation>[1]),
  remove: (owner, request) =>
    deleteAutomation(owner, request as Parameters<typeof deleteAutomation>[1]),
  trigger: (owner, request) =>
    triggerAutomation(owner, request as Parameters<typeof triggerAutomation>[1]),
  publish: publishAutomationInsight,
});
export const GET = handler;
export const POST = handler;
