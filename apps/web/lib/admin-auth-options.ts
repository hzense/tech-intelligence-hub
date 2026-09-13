import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import {
  ADMIN_AUTHORIZATION_VERSION,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  administratorFromToken,
  canSignInGoogleProfile,
  type AdminAuthEnvironment,
} from './admin-auth-policy.ts';

// Next's bundler and native Node test imports expose this CommonJS provider
// differently. Both paths still use the official provider and protocol checks.
const googleProvider =
  typeof GoogleProvider === 'function'
    ? GoogleProvider
    : (GoogleProvider as unknown as { default: typeof GoogleProvider }).default;

export function adminRedirectUrl(url: string, origin: string): string {
  for (const path of ['/admin', '/admin/login']) {
    if (url === path || url === `${origin}${path}`) return `${origin}${path}`;
  }
  return `${origin}/admin`;
}

/** No adapter or business database access: Google authenticates; policy authorizes. */
export function createAdminAuthOptions(
  config: AdminAuthEnvironment,
  readConfiguration: () => AdminAuthEnvironment | null,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): NextAuthOptions {
  function currentConfiguration() {
    const current = readConfiguration();
    // Never authorize a callback with credentials from another configuration.
    if (
      !current ||
      current.clientId !== config.clientId ||
      current.clientSecret !== config.clientSecret ||
      current.secret !== config.secret ||
      current.origin !== config.origin
    ) {
      return null;
    }
    return current;
  }

  return {
    secret: config.secret,
    useSecureCookies: config.origin.startsWith('https:'),
    providers: [
      googleProvider({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        checks: ['pkce', 'state', 'nonce'],
        authorization: { params: { scope: 'openid email', prompt: 'select_account' } },
      }),
    ],
    session: { strategy: 'jwt', maxAge: ADMIN_SESSION_MAX_AGE_SECONDS },
    jwt: { maxAge: ADMIN_SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/admin/login', error: '/admin/login' },
    debug: false,
    // Provider exceptions may carry request metadata. Never log those objects,
    // access/ID tokens, callback codes, session cookies or configured identities.
    logger: {
      error() {
        globalThis.console.error('Administrator authentication failed.');
      },
      warn() {
        globalThis.console.warn('Administrator authentication configuration warning.');
      },
      debug() {},
    },
    callbacks: {
      async signIn({ account, profile }) {
        const current = currentConfiguration();
        return Boolean(
          current &&
          account?.provider === 'google' &&
          account.type === 'oauth' &&
          canSignInGoogleProfile(profile, current.adminEmail) &&
          account.providerAccountId === profile?.sub,
        );
      },
      async jwt({ token, account, profile }) {
        const current = currentConfiguration();
        if (!current) return {};
        if (account) {
          if (
            account.provider !== 'google' ||
            account.type !== 'oauth' ||
            !canSignInGoogleProfile(profile, current.adminEmail) ||
            account.providerAccountId !== profile?.sub
          ) {
            return {};
          }
          // Establish identity exclusively from a library-verified Google login.
          // Do not retain Google credentials or copy the initial default JWT.
          return {
            sub: profile.sub,
            provider: 'google',
            googleSub: profile.sub,
            email: current.adminEmail,
            emailVerified: true,
            adminAuthorizationVersion: ADMIN_AUTHORIZATION_VERSION,
            issuedAt: nowSeconds(),
            adminClientId: current.clientId,
            adminOrigin: current.origin,
          };
        }
        // In particular, ignore client-controlled session/update payloads. The
        // original issuedAt is never refreshed by reading/updating the session.
        return administratorFromToken(token, current, nowSeconds()) ? token : {};
      },
      async session({ token }) {
        const administrator = administratorFromToken(token, currentConfiguration(), nowSeconds());
        if (!administrator) return { expires: new Date(0).toISOString() };
        const authorizationExpiresAt = new Date(
          ((token.issuedAt as number) + ADMIN_SESSION_MAX_AGE_SECONDS) * 1000,
        ).toISOString();
        return {
          user: { id: administrator.id, email: administrator.email },
          expires: authorizationExpiresAt,
          // getServerSession's RSC overload removes the standard expires field.
          authorizationExpiresAt,
        };
      },
      async redirect({ url }) {
        return adminRedirectUrl(url, config.origin);
      },
    },
  };
}
