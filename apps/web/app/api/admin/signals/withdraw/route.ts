import { createPublicationHandler } from '@/lib/admin-publication-core';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { getAdminSession } from '@/lib/server/admin-auth';
import { executeSignalPublication } from '@/lib/server/signal-publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = createPublicationHandler({
  authenticate: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin ?? null,
  execute: executeSignalPublication,
});
export async function POST(request: Request) {
  return handle(request, 'withdraw');
}
