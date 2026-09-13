import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminAuthOptions, adminRedirectUrl } from '../lib/admin-auth-options.ts';
import { ADMIN_SESSION_MAX_AGE_SECONDS } from '../lib/admin-auth-policy.ts';

const configuration = {
  clientId: '123456-admin.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-synthetic-callback-fixture',
  secret: 'SyntheticCallbackFixture-Only-0123456789abcdef',
  origin: 'http://localhost:3000',
  adminEmail: 'admin.fixture@gmail.com',
};
const profile = {
  sub: '100000000000000000001',
  email: configuration.adminEmail,
  email_verified: true,
};
const account = { provider: 'google', type: 'oauth', providerAccountId: profile.sub };

function harness() {
  let current = { ...configuration };
  let now = 10_000;
  const options = createAdminAuthOptions(
    configuration,
    () => current,
    () => now,
  );
  return {
    options,
    setConfiguration(value) {
      current = value;
    },
    setTime(value) {
      now = value;
    },
    signIn: (overrides = {}) => options.callbacks.signIn({ account, profile, ...overrides }),
    loginToken: (overrides = {}) =>
      options.callbacks.jwt({ token: {}, account, profile, ...overrides }),
    refresh: (token, overrides = {}) => options.callbacks.jwt({ token, ...overrides }),
    session: (token) =>
      options.callbacks.session({ token, session: { user: { name: 'untrusted' } } }),
  };
}

test('official Google provider requires PKCE, state, nonce and minimal scopes; no database adapter', () => {
  const { options } = harness();
  assert.equal(options.providers.length, 1);
  const provider = options.providers[0];
  assert.equal(provider.id, 'google');
  assert.deepEqual(provider.options.checks, ['pkce', 'state', 'nonce']);
  assert.equal(provider.options.authorization.params.scope, 'openid email');
  assert.equal(provider.options.authorization.params.prompt, 'select_account');
  assert.equal(options.adapter, undefined);
  assert.equal(options.session.strategy, 'jwt');
  assert.equal(options.session.maxAge, 3600);
  assert.equal(options.jwt.maxAge, 3600);
  assert.equal(options.debug, false);
  assert.equal(
    createAdminAuthOptions({ ...configuration, origin: 'https://hzense.com' }, () => null)
      .useSecureCookies,
    true,
  );
});

test('only the verified, matching Google account establishes a minimal server identity', async () => {
  const h = harness();
  assert.equal(await h.signIn(), true);
  const token = await h.loginToken({
    token: { access_token: 'never-copy', name: 'never-copy' },
    account: {
      ...account,
      access_token: 'never-copy',
      id_token: 'never-copy',
      refresh_token: 'never-copy',
    },
  });
  const session = await h.session(token);
  assert.deepEqual(session, {
    user: { id: `google:${profile.sub}`, email: configuration.adminEmail },
    expires: new Date((10_000 + ADMIN_SESSION_MAX_AGE_SECONDS) * 1000).toISOString(),
    authorizationExpiresAt: new Date((10_000 + ADMIN_SESSION_MAX_AGE_SECONDS) * 1000).toISOString(),
  });
  assert.equal(token.sub, profile.sub);
  for (const key of ['name', 'picture', 'access_token', 'refresh_token', 'id_token']) {
    assert.equal(Object.hasOwn(token, key), false);
    assert.equal(Object.hasOwn(session, key), false);
  }
});

for (const [name, overrides] of [
  ['other provider', { account: { ...account, provider: 'github' } }],
  ['credentials account', { account: { ...account, type: 'credentials' } }],
  ['missing account', { account: null }],
  ['mismatched subject', { account: { ...account, providerAccountId: 'wrong' } }],
  ['unverified email', { profile: { ...profile, email_verified: false } }],
  ['string verification', { profile: { ...profile, email_verified: 'true' } }],
  ['different email', { profile: { ...profile, email: 'outsider@gmail.com' } }],
  ['no profile', { profile: undefined }],
]) {
  test(`login denies ${name}`, async () => {
    const h = harness();
    assert.equal(await h.signIn(overrides), false);
    assert.deepEqual(await h.loginToken(overrides), {});
  });
}

test('client session updates cannot forge or extend administrator identity', async () => {
  const h = harness();
  const token = await h.loginToken();
  h.setTime(10_001);
  const maliciousUpdate = {
    trigger: 'update',
    session: { ...token, email: 'outsider@gmail.com', issuedAt: 10_001, googleSub: 'other' },
  };
  assert.deepEqual(await h.refresh(token, maliciousUpdate), token);
  assert.deepEqual(await h.refresh({}, { trigger: 'update', session: token }), {});
  assert.deepEqual(
    await h.refresh({ email: configuration.adminEmail }, { trigger: 'update', session: token }),
    {},
  );
  h.setTime(10_000 + ADMIN_SESSION_MAX_AGE_SECONDS);
  assert.deepEqual(await h.refresh(token, maliciousUpdate), {});
  assert.equal((await h.session(token)).user, undefined);
});

for (const [name, change] of [
  ['allowlist', { ...configuration, adminEmail: 'replacement@gmail.com' }],
  ['client', { ...configuration, clientId: '987654-other.apps.googleusercontent.com' }],
  ['origin', { ...configuration, origin: 'https://hzense.com' }],
  ['secret', { ...configuration, secret: 'DifferentSyntheticSecret-0123456789abcdef' }],
  ['client secret', { ...configuration, clientSecret: 'GOCSPX-different' }],
  ['missing configuration', null],
]) {
  test(`current ${name} change revokes an old session and callback`, async () => {
    const h = harness();
    const token = await h.loginToken();
    h.setConfiguration(change);
    assert.equal(await h.signIn(), false);
    assert.deepEqual(await h.refresh(token), {});
    assert.equal((await h.session(token)).user, undefined);
  });
}

test('sessions cannot fall back to an email-only JWT or caller-provided session user', async () => {
  const h = harness();
  for (const token of [
    {},
    { email: configuration.adminEmail },
    { sub: profile.sub, email: configuration.adminEmail },
  ]) {
    assert.deepEqual(await h.session(token), { expires: new Date(0).toISOString() });
  }
});

test('redirects permit only the two fixed administrative destinations', async () => {
  const { options } = harness();
  for (const path of ['/admin', '/admin/login']) {
    assert.equal(adminRedirectUrl(path, configuration.origin), `${configuration.origin}${path}`);
    assert.equal(
      adminRedirectUrl(`${configuration.origin}${path}`, configuration.origin),
      `${configuration.origin}${path}`,
    );
  }
  for (const url of [
    'https://attacker.example/admin',
    '//attacker.example',
    '/admin?next=https://attacker.example',
    '/%2f%2fattacker.example',
    'http://localhost:3000@attacker.example/admin',
    '/admin/../api/auth/callback/google',
    '/admin/login#attack',
  ]) {
    assert.equal(
      await options.callbacks.redirect({ url, baseUrl: 'https://attacker.example' }),
      `${configuration.origin}/admin`,
    );
  }
});
