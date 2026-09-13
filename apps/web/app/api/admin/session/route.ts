import { getAdminSession } from '@/lib/server/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAdminSession();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  return Response.json({ user: session.user, expires: session.expires }, { headers });
}
