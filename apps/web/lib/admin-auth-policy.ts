import { Buffer } from 'node:buffer';
import { types } from 'node:util';

// Server-side policy only. Never put the configured mailbox or these environment
// values into a client bundle, public config endpoint, log, or source-controlled fixture.
export interface AdminAuthEnvironment {
  clientId: string;
  clientSecret: string;
  secret: string;
  origin: string;
  adminEmail: string;
}

export interface Administrator {
  id: string;
  email: string;
  provider: 'google';
}

export const ADMIN_AUTHORIZATION_VERSION = 'google-admin-v1';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 3600;

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !types.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === 'string' &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'),
    )
  );
}

function credential(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/\s/.test(value) &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
    ) &&
    !/(?:placeholder|change[-_]?me|replace[-_]?me|your[-_]|example[-_]|test[-_]?secret|dummy[-_]?secret|development[-_]?secret)/i.test(
      value,
    ) &&
    !/^(?:undefined|null|secret|password|<.*>|\$\{.*\})$/i.test(value)
  );
}

function clientId(value: unknown): value is string {
  return credential(value) && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
}

function signingSecret(value: unknown): value is string {
  return (
    credential(value) && Buffer.byteLength(value, 'utf8') >= 32 && !/^(.{1,16})\1+$/u.test(value)
  );
}

function normalizeMailbox(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  // Exactly one Gmail address. No lists, plus aliases, dots removal, Workspace
  // domain expansion or googlemail.com alias matching is permitted.
  return /^[a-z0-9]+(?:\.[a-z0-9]+)*@gmail\.com$/.test(email) && email.indexOf('@') <= 64
    ? email
    : null;
}

function googleSubject(value: unknown): value is string {
  // Google documents sub as a never-reused, case-sensitive ASCII identifier with
  // at most 255 characters. Identity comes from sub, not a mutable email field.
  return typeof value === 'string' && value.match(/^[\x21-\x7e]{1,255}$/)?.[0] === value;
}

/**
 * Missing/malformed configuration disables administrative authentication. This
 * never infers a deployed callback origin from headers or VERCEL_URL. An actual
 * process.env has a platform-owned prototype, so only required own data fields
 * are read; getters and Proxy traps are never evaluated.
 */
export function parseAdminAuthEnvironment(env: unknown): AdminAuthEnvironment | null {
  try {
    if (env === null || typeof env !== 'object' || Array.isArray(env) || types.isProxy(env)) {
      return null;
    }
    for (const field of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'NEXTAUTH_SECRET',
      'NEXTAUTH_URL',
      'HZENSE_ADMIN_EMAIL',
      'VERCEL_ENV',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(env, field);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
    }
    const googleClientId = ownValue(env, 'GOOGLE_CLIENT_ID');
    const googleClientSecret = ownValue(env, 'GOOGLE_CLIENT_SECRET');
    const secret = ownValue(env, 'NEXTAUTH_SECRET');
    const origin = ownValue(env, 'NEXTAUTH_URL');
    const adminEmail = normalizeMailbox(ownValue(env, 'HZENSE_ADMIN_EMAIL'));
    const deployment = ownValue(env, 'VERCEL_ENV');
    if (
      !clientId(googleClientId) ||
      !credential(googleClientSecret) ||
      !signingSecret(secret) ||
      !adminEmail
    ) {
      return null;
    }
    if (deployment === 'production') {
      if (origin !== 'https://hzense.com') return null;
    } else {
      if (deployment !== undefined && deployment !== 'development') return null;
      if (origin !== 'http://localhost:3000' && origin !== 'http://127.0.0.1:3000') return null;
    }
    return {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      secret,
      origin,
      adminEmail,
    };
  } catch {
    return null;
  }
}

/**
 * Called only after the OAuth library validates signature, issuer, audience,
 * state/nonce and account/provider binding. This pure predicate does not verify
 * an ID token itself. Optional profile issuer is an additional consistency check.
 * https://developers.google.com/identity/openid-connect/openid-connect
 */
export function canSignInGoogleProfile(profile: unknown, allowedEmail: unknown): boolean {
  try {
    if (!record(profile)) return false;
    const expected = normalizeMailbox(allowedEmail);
    if (!expected) return false;
    const issuer = ownValue(profile, 'iss');
    if (
      Object.hasOwn(profile, 'iss') &&
      issuer !== 'accounts.google.com' &&
      issuer !== 'https://accounts.google.com'
    ) {
      return false;
    }
    return (
      googleSubject(ownValue(profile, 'sub')) &&
      ownValue(profile, 'email_verified') === true &&
      normalizeMailbox(ownValue(profile, 'email')) === expected
    );
  } catch {
    return false;
  }
}

/**
 * Authorize only the library-decoded, authenticated server JWT. These provenance
 * fields must be written exclusively by its initial Google sign-in callback;
 * copying them from a session update or decoding an unsigned JWT is unsafe.
 * Re-read the current server configuration for each call. Standard rolling iat/
 * exp fields never extend the absolute one-hour issuedAt authorization lifetime.
 */
export function administratorFromToken(
  token: unknown,
  config: AdminAuthEnvironment | null,
  nowSeconds: number,
): Administrator | null {
  try {
    if (!record(token) || !record(config) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      return null;
    }
    const expectedEmail = normalizeMailbox(ownValue(config, 'adminEmail'));
    const configuredClient = ownValue(config, 'clientId');
    const configuredOrigin = ownValue(config, 'origin');
    const subject = ownValue(token, 'googleSub');
    const email = normalizeMailbox(ownValue(token, 'email'));
    const issuedAt = ownValue(token, 'issuedAt');
    if (
      !expectedEmail ||
      !clientId(configuredClient) ||
      !credential(ownValue(config, 'clientSecret')) ||
      !signingSecret(ownValue(config, 'secret')) ||
      !['https://hzense.com', 'http://localhost:3000', 'http://127.0.0.1:3000'].includes(
        typeof configuredOrigin === 'string' ? configuredOrigin : '',
      ) ||
      ownValue(token, 'provider') !== 'google' ||
      !googleSubject(subject) ||
      email !== expectedEmail ||
      ownValue(token, 'emailVerified') !== true ||
      ownValue(token, 'adminAuthorizationVersion') !== ADMIN_AUTHORIZATION_VERSION ||
      ownValue(token, 'adminClientId') !== configuredClient ||
      ownValue(token, 'adminOrigin') !== configuredOrigin ||
      typeof issuedAt !== 'number' ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      issuedAt > nowSeconds ||
      nowSeconds - issuedAt >= ADMIN_SESSION_MAX_AGE_SECONDS ||
      (Object.hasOwn(token, 'sub') && ownValue(token, 'sub') !== subject)
    ) {
      return null;
    }
    return { id: `google:${subject}`, email, provider: 'google' };
  } catch {
    return null;
  }
}
