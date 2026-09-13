import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_AUTHORIZATION_VERSION,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  administratorFromToken,
  canSignInGoogleProfile,
  parseAdminAuthEnvironment,
} from '../lib/admin-auth-policy.ts';

// Synthetic test-only values; no real administrator address or cloud credentials.
const allowedEmail = 'admin.fixture@gmail.com';
const now = 1_789_300_000;
const env = (overrides = {}) => ({
  GOOGLE_CLIENT_ID: '1234567890-fixture.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'oauth-fixture-credential-value',
  NEXTAUTH_SECRET: 'fixture-signing-key-longer-than-thirty-two-bytes',
  NEXTAUTH_URL: 'https://hzense.com',
  HZENSE_ADMIN_EMAIL: allowedEmail,
  VERCEL_ENV: 'production',
  ...overrides,
});
const profile = (overrides = {}) => ({
  sub: '109876543210987654321',
  email: allowedEmail,
  email_verified: true,
  iss: 'https://accounts.google.com',
  name: 'Synthetic fixture',
  ...overrides,
});
const token = (overrides = {}) => ({
  provider: 'google',
  googleSub: profile().sub,
  sub: profile().sub,
  email: allowedEmail,
  emailVerified: true,
  adminAuthorizationVersion: ADMIN_AUTHORIZATION_VERSION,
  adminClientId: env().GOOGLE_CLIENT_ID,
  adminOrigin: env().NEXTAUTH_URL,
  issuedAt: now - 10,
  iat: now,
  exp: now + 86400,
  ...overrides,
});

test('configured production auth is a detached server-only value with one normalized Gmail mailbox', () => {
  const input = env({ HZENSE_ADMIN_EMAIL: '  ADMIN.FIXTURE@GMAIL.COM  ' });
  const before = { ...input };
  assert.deepEqual(parseAdminAuthEnvironment(input), {
    clientId: input.GOOGLE_CLIENT_ID,
    clientSecret: input.GOOGLE_CLIENT_SECRET,
    secret: input.NEXTAUTH_SECRET,
    origin: 'https://hzense.com',
    adminEmail: allowedEmail,
  });
  assert.deepEqual(input, before);
  assert.deepEqual(
    parseAdminAuthEnvironment(Object.assign(Object.create(null), input)),
    parseAdminAuthEnvironment(input),
  );
});

for (const field of [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'HZENSE_ADMIN_EMAIL',
]) {
  test(`missing, blank or wrongly typed ${field} disables authentication`, () => {
    for (const invalid of [undefined, '', ' ', null, false, 1, ['value']]) {
      assert.equal(parseAdminAuthEnvironment(env({ [field]: invalid })), null);
    }
    const missing = env();
    delete missing[field];
    assert.equal(parseAdminAuthEnvironment(missing), null);
  });
}

for (const origin of [
  'http://hzense.com',
  'https://www.hzense.com',
  'https://hzense.com/',
  'https://hzense.com/admin',
  'https://hzense.com?next=/admin',
  'https://hzense.com#admin',
  'https://user:pass@hzense.com',
  'https://hzense.com:443',
  'https://hzense.com.evil.test',
  ' https://hzense.com',
  'https://HZENSE.COM',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://preview.vercel.app',
]) {
  test(`production refuses noncanonical auth origin ${origin}`, () => {
    assert.equal(parseAdminAuthEnvironment(env({ NEXTAUTH_URL: origin })), null);
  });
}

test('preview and unknown deployment environments cannot enable admin login, including loopback', () => {
  for (const deployment of ['preview', 'staging', '', null, true]) {
    for (const origin of ['https://hzense.com', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
      assert.equal(
        parseAdminAuthEnvironment(env({ VERCEL_ENV: deployment, NEXTAUTH_URL: origin })),
        null,
      );
    }
  }
});

test('local testing only permits the two port-3000 loopback origins regardless of NODE_ENV', () => {
  for (const deployment of [undefined, 'development']) {
    for (const nodeEnvironment of ['development', 'test', 'production', undefined]) {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
        const actual = parseAdminAuthEnvironment(
          env({ VERCEL_ENV: deployment, NODE_ENV: nodeEnvironment, NEXTAUTH_URL: origin }),
        );
        assert.equal(actual?.origin, origin);
      }
    }
  }
  for (const origin of [
    'https://hzense.com',
    'http://localhost:3001',
    'http://localhost:3000/',
    'http://127.0.0.2:3000',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
    'https://localhost:3000',
  ]) {
    assert.equal(
      parseAdminAuthEnvironment(env({ VERCEL_ENV: undefined, NEXTAUTH_URL: origin })),
      null,
    );
  }
});

test('client IDs require the exact Google suffix and usable credentials', () => {
  for (const value of [
    '.apps.googleusercontent.com',
    '123.apps.googleusercontent.com.evil.test',
    '123.apps.googleusercontent.com/path',
    'your-client-id.apps.googleusercontent.com',
    '123.example.com',
    '123.apps.googleusercontent.com\n',
  ]) {
    assert.equal(parseAdminAuthEnvironment(env({ GOOGLE_CLIENT_ID: value })), null);
  }
  for (const field of ['GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET']) {
    for (const value of [
      'placeholder',
      'change-me',
      'replace_me',
      'your-secret-value-that-is-long-enough-for-this-test',
      'a secret with whitespace that is long enough',
      '<insert-a-random-secret-at-least-32-bytes>',
      '${SIGNING_SECRET}',
      'undefined',
    ]) {
      assert.equal(parseAdminAuthEnvironment(env({ [field]: value })), null);
    }
  }
});

test('signing secret uses UTF-8 byte length and rejects obvious repeating placeholders', () => {
  assert.equal(
    parseAdminAuthEnvironment(
      env({ NEXTAUTH_SECRET: 'this-is-only-thirty-one-byte-key'.slice(0, 31) }),
    ),
    null,
  );
  for (const value of ['a'.repeat(64), '0123456789'.repeat(4), 'abcd'.repeat(16)]) {
    assert.equal(parseAdminAuthEnvironment(env({ NEXTAUTH_SECRET: value })), null);
  }
  const unicodeBoundary = '甲乙丙丁戊己庚辛壬癸子';
  assert.ok(unicodeBoundary.length < 32);
  assert.equal(
    parseAdminAuthEnvironment(env({ NEXTAUTH_SECRET: unicodeBoundary }))?.secret,
    unicodeBoundary,
  );
});

for (const mailbox of [
  'admin@gmail.com,other@gmail.com',
  'admin@gmail.com;other@gmail.com',
  'admin.fixture+extra@gmail.com',
  'admin.fixture@googlemail.com',
  'admin.fixture@example.com',
  'admin..fixture@gmail.com',
  '.admin@gmail.com',
  'admin.@gmail.com',
  'admin_fixture@gmail.com',
  'Admin <admin@gmail.com>',
  'admin@gmail.com\nother@gmail.com',
  `${'a'.repeat(65)}@gmail.com`,
  '*@gmail.com',
]) {
  test(`administrator configuration refuses non-single exact Gmail mailbox ${mailbox}`, () => {
    assert.equal(parseAdminAuthEnvironment(env({ HZENSE_ADMIN_EMAIL: mailbox })), null);
    assert.equal(canSignInGoogleProfile(profile(), mailbox), false);
  });
}

test('environment descriptors are read safely without invoking getters or Proxy traps', () => {
  let called = 0;
  for (const field of ['GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET', 'VERCEL_ENV']) {
    const input = env();
    Object.defineProperty(input, field, {
      get() {
        called += 1;
        return 'secret';
      },
    });
    assert.equal(parseAdminAuthEnvironment(input), null);
  }
  const proxy = new Proxy(env(), {
    getPrototypeOf() {
      called += 1;
      throw new Error('sensitive');
    },
  });
  const revoked = Proxy.revocable(env(), {});
  revoked.revoke();
  assert.equal(parseAdminAuthEnvironment(proxy), null);
  assert.equal(parseAdminAuthEnvironment(revoked.proxy), null);
  const inherited = Object.create(env());
  assert.equal(parseAdminAuthEnvironment(inherited), null);
  assert.equal(called, 0);
});

test('Google profile requires a stable subject, boolean verification and the configured exact email', () => {
  assert.equal(canSignInGoogleProfile(profile(), allowedEmail), true);
  assert.equal(
    canSignInGoogleProfile(profile({ email: ' ADMIN.FIXTURE@GMAIL.COM ' }), allowedEmail),
    true,
  );
  assert.equal(canSignInGoogleProfile(profile({ iss: 'accounts.google.com' }), allowedEmail), true);
  const withoutIssuer = profile();
  delete withoutIssuer.iss;
  assert.equal(canSignInGoogleProfile(withoutIssuer, allowedEmail), true);
  assert.equal(
    canSignInGoogleProfile(profile({ email: 'adminfixture@gmail.com' }), allowedEmail),
    false,
  );
  assert.equal(
    canSignInGoogleProfile(profile({ email: 'admin.fixture+extra@gmail.com' }), allowedEmail),
    false,
  );
  assert.equal(canSignInGoogleProfile(profile({ email: 'other@gmail.com' }), allowedEmail), false);
});

for (const [field, invalid] of [
  ['sub', ''],
  ['sub', ' '],
  ['sub', '123\n'],
  ['sub', 'a'.repeat(256)],
  ['sub', 123],
  ['sub', '用户'],
  ['email_verified', 'true'],
  ['email_verified', 1],
  ['email_verified', false],
  ['email_verified', undefined],
  ['email', null],
  ['iss', 'https://accounts.google.com.evil.test'],
  ['iss', 'https://accounts.google.com/'],
  ['iss', null],
  ['iss', undefined],
]) {
  test(`Google profile refuses invalid ${field} ${String(invalid)}`, () => {
    assert.equal(canSignInGoogleProfile(profile({ [field]: invalid }), allowedEmail), false);
  });
}

test('profile predicates reject hostile objects without evaluating caller code', () => {
  let called = 0;
  const accessors = profile();
  Object.defineProperty(accessors, 'email_verified', {
    get() {
      called += 1;
      return true;
    },
  });
  const inputs = [
    null,
    [],
    {},
    'profile',
    accessors,
    Object.create(profile()),
    new Proxy(profile(), {}),
    { ...profile(), [Symbol('extra')]: true },
  ];
  for (const input of inputs) assert.equal(canSignInGoogleProfile(input, allowedEmail), false);
  assert.equal(called, 0);
});

test('administrator is derived from signed server provenance, not session.user.email', () => {
  const config = parseAdminAuthEnvironment(env());
  assert.deepEqual(administratorFromToken(token(), config, now), {
    id: `google:${profile().sub}`,
    email: allowedEmail,
    provider: 'google',
  });
  assert.equal(administratorFromToken({ user: { email: allowedEmail } }, config, now), null);
  assert.equal(
    administratorFromToken(
      { email: allowedEmail, email_verified: true, sub: profile().sub },
      config,
      now,
    ),
    null,
  );
  assert.equal(administratorFromToken(token(), null, now), null);
  assert.equal(ADMIN_SESSION_MAX_AGE_SECONDS, 3600);
});

for (const field of [
  'provider',
  'googleSub',
  'email',
  'emailVerified',
  'adminAuthorizationVersion',
  'adminClientId',
  'adminOrigin',
  'issuedAt',
]) {
  test(`administrator authorization requires server provenance field ${field}`, () => {
    const value = token();
    delete value[field];
    assert.equal(administratorFromToken(value, parseAdminAuthEnvironment(env()), now), null);
  });
}

for (const [field, invalid] of [
  ['provider', 'github'],
  ['googleSub', ''],
  ['googleSub', 123],
  ['sub', 'different-sub'],
  ['email', 'other@gmail.com'],
  ['email', 'adminfixture@gmail.com'],
  ['emailVerified', 'true'],
  ['emailVerified', false],
  ['adminAuthorizationVersion', 'google-admin-v0'],
  ['adminClientId', 'another.apps.googleusercontent.com'],
  ['adminOrigin', 'http://localhost:3000'],
  ['issuedAt', String(now)],
  ['issuedAt', now + 1],
  ['issuedAt', Number.NaN],
  ['issuedAt', -1],
  ['issuedAt', now - 0.5],
]) {
  test(`administrator authorization rejects changed ${field} ${String(invalid)}`, () => {
    assert.equal(
      administratorFromToken(token({ [field]: invalid }), parseAdminAuthEnvironment(env()), now),
      null,
    );
  });
}

test('absolute expiry cannot be renewed by standard JWT rolling iat or exp fields', () => {
  const config = parseAdminAuthEnvironment(env());
  assert.ok(administratorFromToken(token({ issuedAt: now - 3599 }), config, now));
  assert.equal(administratorFromToken(token({ issuedAt: now - 3600 }), config, now), null);
  assert.equal(
    administratorFromToken(
      token({ issuedAt: now - 3601, iat: now, exp: now + 86400 }),
      config,
      now,
    ),
    null,
  );
  for (const clock of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, now + 0.1]) {
    assert.equal(administratorFromToken(token(), config, clock), null);
  }
});

test('current allowlist, client and origin configuration revoke previously eligible token claims', () => {
  for (const overrides of [
    { HZENSE_ADMIN_EMAIL: 'other@gmail.com' },
    { GOOGLE_CLIENT_ID: '9876543210-new.apps.googleusercontent.com' },
    { VERCEL_ENV: undefined, NEXTAUTH_URL: 'http://localhost:3000' },
    { VERCEL_ENV: 'preview' },
  ]) {
    assert.equal(
      administratorFromToken(token(), parseAdminAuthEnvironment(env(overrides)), now),
      null,
    );
  }
  const config = parseAdminAuthEnvironment(env());
  for (const field of ['clientSecret', 'secret', 'adminEmail', 'origin', 'clientId']) {
    const incomplete = { ...config };
    delete incomplete[field];
    assert.equal(administratorFromToken(token(), incomplete, now), null);
  }
});

test('token and configuration accessors/proxies fail closed without leaking exceptions', () => {
  let called = 0;
  const malicious = token();
  Object.defineProperty(malicious, 'emailVerified', {
    get() {
      called += 1;
      throw new Error('secret');
    },
  });
  assert.equal(administratorFromToken(malicious, parseAdminAuthEnvironment(env()), now), null);
  assert.equal(
    administratorFromToken(new Proxy(token(), {}), parseAdminAuthEnvironment(env()), now),
    null,
  );
  const config = parseAdminAuthEnvironment(env());
  Object.defineProperty(config, 'adminEmail', {
    get() {
      called += 1;
      return allowedEmail;
    },
  });
  assert.equal(administratorFromToken(token(), config, now), null);
  assert.equal(called, 0);
});
