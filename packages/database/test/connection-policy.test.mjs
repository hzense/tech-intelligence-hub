import { describe, expect, it } from 'vitest';
import { productionDatabaseOptions, validateConnectionTarget } from '../src/connection-policy.mjs';

const productionPolicy = {
  connectionString:
    'postgresql://hzense_migrator:secret@db.example.com:5432/hzense?sslmode=verify-full',
  profile: 'production',
  expectedHost: 'db.example.com',
  expectedPort: '5432',
  expectedDatabase: 'hzense',
  expectedUser: 'hzense_migrator',
};

describe('database connection policy', () => {
  it('allows local tests only on literal loopback hosts', () => {
    expect(
      validateConnectionTarget({
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
        profile: 'local-test',
      }),
    ).toMatchObject({ database: 'postgres', host: '127.0.0.1', user: 'postgres' });

    expect(() =>
      validateConnectionTarget({
        connectionString: 'postgresql://postgres:postgres@database.internal:5432/postgres',
        profile: 'local-test',
      }),
    ).toThrow(/literal loopback/);
  });

  it('requires an independently reviewed production endpoint and identity', () => {
    expect(validateConnectionTarget(productionPolicy)).toMatchObject({
      database: 'hzense',
      host: 'db.example.com',
      port: '5432',
      user: 'hzense_migrator',
    });

    expect(() =>
      validateConnectionTarget({ ...productionPolicy, expectedHost: 'pooler.example.com' }),
    ).toThrow(/reviewed direct endpoint/);
    expect(() =>
      validateConnectionTarget({ ...productionPolicy, expectedUser: 'postgres' }),
    ).toThrow(/identity/);
  });

  it('requires verify-full TLS and rejects loopback production targets', () => {
    expect(() =>
      validateConnectionTarget({
        ...productionPolicy,
        connectionString:
          'postgresql://hzense_migrator:secret@db.example.com:5432/hzense?sslmode=require',
      }),
    ).toThrow(/sslmode=verify-full/);
    expect(() =>
      validateConnectionTarget({
        ...productionPolicy,
        connectionString:
          'postgresql://hzense_migrator:secret@db.example.com:5432/hzense?sslmode=verify-full&sslmode=verify-full',
      }),
    ).toThrow(/appear once|exactly once/);
    expect(() =>
      validateConnectionTarget({
        ...productionPolicy,
        connectionString:
          'postgresql://hzense_migrator:secret@127.0.0.1:5432/hzense?sslmode=verify-full',
        expectedHost: '127.0.0.1',
      }),
    ).toThrow(/cannot use a loopback/);

    for (const host of [
      'localhost.',
      '127.1',
      '127.0.1',
      '127.255.2.3',
      '2130706433',
      '0x7f000001',
      '017700000001',
      '0',
      '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]',
    ]) {
      expect(() =>
        validateConnectionTarget({
          ...productionPolicy,
          connectionString: `postgresql://hzense_migrator:secret@${host}:5432/hzense?sslmode=verify-full`,
          expectedHost: host,
        }),
      ).toThrow(/cannot use a loopback/);
    }
  });

  it('rejects the Node process-wide TLS certificate-validation bypass in production', () => {
    expect(() =>
      validateConnectionTarget({
        ...productionPolicy,
        nodeTlsRejectUnauthorized: '0',
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED=0/);

    expect(
      validateConnectionTarget({
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
        profile: 'local-test',
        nodeTlsRejectUnauthorized: '0',
      }),
    ).toMatchObject({ host: '127.0.0.1' });
  });

  it('rejects query parameters that could override the reviewed endpoint', () => {
    for (const override of [
      'host=pooler.example.com',
      'hostaddr=203.0.113.10',
      'port=6543',
      'user=postgres',
      'database=other',
      'ssl=false',
      'service=production',
      'options=-c%20search_path%3Dother',
    ]) {
      expect(() =>
        validateConnectionTarget({
          ...productionPolicy,
          connectionString: `${productionPolicy.connectionString}&${override}`,
        }),
      ).toThrow(/query parameter is not allowed/);
    }

    expect(() =>
      validateConnectionTarget({
        connectionString:
          'postgresql://postgres:postgres@127.0.0.1:5432/postgres?host=database.internal',
        profile: 'local-test',
      }),
    ).toThrow(/query parameter is not allowed/);
  });

  it('rejects encoded hosts before the database driver can decode a different target', () => {
    for (const encodedHost of ['127%2E0%2E0%2E1', '%2Fvar%2Frun%2Fpostgresql']) {
      expect(() =>
        validateConnectionTarget({
          ...productionPolicy,
          connectionString: `postgresql://hzense_migrator:secret@${encodedHost}:5432/hzense?sslmode=verify-full`,
          expectedHost: encodedHost,
        }),
      ).toThrow(/host must not use percent encoding/);
    }

    expect(() =>
      validateConnectionTarget({
        connectionString: 'postgresql://postgres:postgres@127%2E0%2E0%2E1:5432/postgres',
        profile: 'local-test',
      }),
    ).toThrow(/host must not use percent encoding/);
  });

  it('rejects connection-string whitespace that the database driver parses differently', () => {
    for (const connectionString of [
      ` ${productionPolicy.connectionString}`,
      `${productionPolicy.connectionString} `,
      `\n${productionPolicy.connectionString}`,
    ]) {
      expect(() =>
        validateConnectionTarget({
          ...productionPolicy,
          connectionString,
        }),
      ).toThrow(/leading or trailing whitespace/);
    }

    for (const connectionString of [
      `\u0001 ${productionPolicy.connectionString}`,
      `${productionPolicy.connectionString}\u007f`,
      productionPolicy.connectionString.replace('secret@', 'sec\tret@'),
    ]) {
      expect(() =>
        validateConnectionTarget({
          ...productionPolicy,
          connectionString,
        }),
      ).toThrow(/control characters/);
    }

    expect(() =>
      validateConnectionTarget({
        ...productionPolicy,
        connectionString: productionPolicy.connectionString.replace(
          'postgresql://',
          'POSTGRESQL://',
        ),
      }),
    ).toThrow(/absolute lowercase PostgreSQL URL/);
  });

  it('builds production options without falling back to DATABASE_URL', () => {
    expect(
      productionDatabaseOptions({
        DATABASE_URL: 'postgresql://ignored',
        DATABASE_DIRECT_URL: productionPolicy.connectionString,
        HZENSE_DATABASE_EXPECTED_HOST: 'db.example.com',
        HZENSE_DATABASE_EXPECTED_PORT: '5432',
        HZENSE_DATABASE_EXPECTED_NAME: 'hzense',
        HZENSE_DATABASE_EXPECTED_USER: 'hzense_migrator',
        HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION: '0.8.6',
      }),
    ).toMatchObject({
      connectionString: productionPolicy.connectionString,
      profile: 'production',
      expectedPostgresMajor: 16,
    });
  });
});
