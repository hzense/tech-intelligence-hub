import { createAdminMaterialHandler } from '@/lib/admin-material-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import {
  readMaterialDashboard,
  createMaterialRequest,
  confirmMaterialRegistration,
} from '@/lib/server/material-registration';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createAdminMaterialHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  read: readMaterialDashboard,
  create: createMaterialRequest,
  confirm: confirmMaterialRegistration,
});
export const POST = GET;
