import process from 'node:process';
import {
  assertLocalDevelopmentRequest,
  type LocalDevelopmentEnvironment,
} from './local-development.ts';

/**
 * Local development intentionally has no login or persistent session. Every
 * request must still satisfy the isolated development environment and the
 * loopback Host/Origin policy. This identity is never a Google administrator.
 */
export function getLocalAdminSession(
  request: Pick<Request, 'headers' | 'method'> & { url?: string },
  environment: LocalDevelopmentEnvironment = process.env,
  now = Date.now(),
): { user: { id: string; email: string }; expires: string } | null {
  try {
    assertLocalDevelopmentRequest(request, environment);
    return {
      user: { id: 'local:developer', email: 'developer@localhost' },
      // Compatibility with the common session shape, not a cookie lifetime:
      // the environment and request boundary are revalidated on every call.
      expires: new Date(now + 3600000).toISOString(),
    };
  } catch {
    return null;
  }
}
