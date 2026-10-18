import { createPublicationHandler } from '@/lib/admin-publication-core';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { executeSignalPublication } from '@/lib/server/signal-publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createPublicationHandler({
  authenticate: getAdminSession,
  origin: getAdminOrigin,
  execute: executeSignalPublication,
});
export async function POST(request: Request) {
  return handle(request, 'publish');
}
