import process from 'node:process';
import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { getAdminAuthOptions } from '@/lib/server/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AuthContext = { params: Promise<{ nextauth: string[] }> };

async function handler(request: NextRequest, context: AuthContext) {
  const config = parseAdminAuthEnvironment(process.env);
  const options = getAdminAuthOptions();
  if (!config || !options) {
    return Response.json(
      { error: 'admin_auth_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // NextAuth verifies CSRF tokens on its POST endpoints. This origin check is
  // additional defense, not a replacement for that verification.
  if (request.method === 'POST' && request.headers.get('origin') !== config.origin) {
    return Response.json(
      { error: 'invalid_origin' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const response: Response = await NextAuth(options)(request, context);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export { handler as GET, handler as POST };
