import process from 'node:process';
import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { assertLocalDevelopmentRequest } from '@/lib/local-development';
import { getAdminAuthOptions, getAdminOrigin } from '@/lib/server/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AuthContext = { params: Promise<{ nextauth: string[] }> };

async function handler(request: NextRequest, context: AuthContext) {
  const origin = getAdminOrigin();
  const options = getAdminAuthOptions();
  if (!origin || !options) {
    return Response.json(
      { error: 'admin_auth_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // NextAuth verifies CSRF tokens on its POST endpoints. This origin check is
  // additional defense, not a replacement for that verification.
  try {
    if (process.env.HZENSE_LOCAL_DEVELOPMENT === '1') assertLocalDevelopmentRequest(request);
    if (request.method === 'POST' && request.headers.get('origin') !== origin)
      throw new Error('invalid_origin');
  } catch {
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
