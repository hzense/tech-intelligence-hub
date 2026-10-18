import 'server-only';

import process from 'node:process';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createAdminAuthOptions } from '../admin-auth-options';
import { parseAdminAuthEnvironment } from '../admin-auth-policy';
import { getLocalAdminSession } from '../local-admin-auth';
import { isLocalDevelopment, localDevelopmentOrigin } from '../local-development';

export interface AdminSession {
  user: { id: string; email: string };
  expires: string;
}

export function getAdminAuthOptions() {
  // Local development has no OAuth/credentials endpoint and never falls back
  // to production authentication when its strict environment is invalid.
  if (process.env.HZENSE_LOCAL_DEVELOPMENT === '1') return null;
  const config = parseAdminAuthEnvironment(process.env);
  return config
    ? createAdminAuthOptions(config, () => parseAdminAuthEnvironment(process.env))
    : null;
}

export function isAdminAuthConfigured(): boolean {
  return process.env.HZENSE_LOCAL_DEVELOPMENT === '1'
    ? isLocalDevelopment()
    : getAdminAuthOptions() !== null;
}

export function getAdminOrigin(): string | null {
  return process.env.HZENSE_LOCAL_DEVELOPMENT === '1'
    ? localDevelopmentOrigin(process.env)
    : (parseAdminAuthEnvironment(process.env)?.origin ?? null);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  if (process.env.HZENSE_LOCAL_DEVELOPMENT === '1') {
    // Actual Origin and Fetch Metadata are checked even for page reads. API
    // writes additionally require the existing operation-level Origin check.
    return getLocalAdminSession({ headers: await headers(), method: 'GET' });
  }
  const options = getAdminAuthOptions();
  if (!options) return null;
  // NextAuth decrypts/authenticates the cookie and runs both policy callbacks.
  // Do not replace this with unsigned JWT decoding or an email request header.
  const session = await getServerSession(options);
  const user = session?.user as Partial<AdminSession['user']> | undefined;
  const expires = (session as { authorizationExpiresAt?: unknown } | null)?.authorizationExpiresAt;
  if (
    !session ||
    typeof user?.id !== 'string' ||
    typeof user.email !== 'string' ||
    typeof expires !== 'string' ||
    !Number.isFinite(Date.parse(expires)) ||
    Date.parse(expires) <= Date.now()
  )
    return null;
  return { user: { id: user.id, email: user.email }, expires };
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return session;
}
