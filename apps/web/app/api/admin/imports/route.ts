import { createImportAdminHandler } from '@/lib/admin-import-core';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { executeImportAdmin } from '@/lib/server/import-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;
export const GET = createImportAdminHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  execute: executeImportAdmin,
});
export const POST = GET;
