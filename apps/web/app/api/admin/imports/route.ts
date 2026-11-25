import { createImportAdminHandler } from '@/lib/admin-import-core';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { executeImportAdmin } from '@/lib/server/import-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;
export const GET = createImportAdminHandler({
  session: getAdminSession,
  origin: () => getAdminOrigin() ?? undefined,
  execute: (owner, method, body) => executeImportAdmin(owner, method, body, true),
});
export const POST = GET;
