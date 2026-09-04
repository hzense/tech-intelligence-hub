import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  assertRuntimeAclBaselineCliArguments,
  buildRuntimeAclBaseline,
  inspectRuntimeAclBaseline,
  runRuntimeAclBaselineCapture,
  runtimeAclBaselineCategoryNames,
  runtimeAclBaselineFailureMessage,
  runtimeAclBaselineFormat,
  runtimeAclBaselineProductionOptions,
  runtimeAclBackupReference,
  runtimeAclBackupReferenceDomain,
} from '../src/runtime-acl-baseline.mjs';

const capturedAt = '2026-09-04T12:00:00.000Z';
const backupId = 'runtime-acl-backup-2026-09-04T12:00:00Z';
const backupReference = runtimeAclBackupReference(backupId);
const commandPath = fileURLToPath(new URL('../src/runtime-acl-baseline.mjs', import.meta.url));
const sourcePath = fileURLToPath(new URL('../src/runtime-acl-baseline.mjs', import.meta.url));

function identity(overrides = {}) {
  return {
    database: 'hzense_test',
    databaseOwner: 'hzense_owner',
    sessionUser: 'hzense_owner',
    currentUser: 'hzense_owner',
    serverVersionNumber: 180_002,
    transactionReadOnly: true,
    transactionIsolation: 'repeatable read',
    ...overrides,
  };
}

function runtimeRole(overrides = {}) {
  return {
    roleName: 'hzense_runtime',
    canLogin: true,
    inheritsPrivileges: false,
    connectionLimit: 20,
    isSuperuser: false,
    canCreateDatabase: false,
    canCreateRole: false,
    canReplicate: false,
    canBypassRls: false,
    roleDefaultReadOnly: true,
    databaseDefaultReadOnly: null,
    ...overrides,
  };
}

function categories(overrides = {}) {
  return {
    runtimeRole: [runtimeRole()],
    memberships: [],
    roleMemberships: [],
    databases: [
      {
        database: 'hzense_test',
        owner: 'hzense_owner',
        isTemplate: false,
        allowsConnections: true,
        connectionLimit: -1,
        aclState: 'explicit',
        grantee: 'PUBLIC',
        grantor: 'hzense_owner',
        privilege: 'CONNECT',
        grantable: false,
      },
    ],
    databaseAccess: [
      {
        role: 'hzense_owner',
        inheritsPrivileges: true,
        isSuperuser: false,
        database: 'hzense_test',
        databaseOwner: 'hzense_owner',
        connect: true,
        connectGrantable: true,
        create: true,
        createGrantable: true,
        temporary: true,
        temporaryGrantable: true,
      },
    ],
    schemas: [
      {
        schema: 'public',
        owner: 'hzense_owner',
        aclState: 'explicit',
        grantee: 'PUBLIC',
        grantor: 'hzense_owner',
        privilege: 'USAGE',
        grantable: false,
      },
    ],
    relations: [
      {
        schema: 'public',
        relation: 'topics',
        relationKind: 'r',
        persistence: 'p',
        owner: 'hzense_owner',
        aclState: 'default',
        grantee: 'hzense_owner',
        grantor: 'hzense_owner',
        privilege: 'SELECT',
        grantable: true,
      },
    ],
    columns: [
      {
        schema: 'public',
        relation: 'topics',
        column: 'id',
        position: 1,
        aclState: 'default',
        grantee: null,
        grantor: null,
        privilege: null,
        grantable: null,
      },
    ],
    enumTypes: [
      {
        schema: 'public',
        type: 'topic_status',
        owner: 'hzense_owner',
        aclState: 'default',
        grantee: 'PUBLIC',
        grantor: 'hzense_owner',
        privilege: 'USAGE',
        grantable: false,
      },
    ],
    routines: [],
    defaultPrivileges: [],
    ...overrides,
  };
}

function catalogClient({ identityRow = identity(), categoryRows = categories(), failAt } = {}) {
  const query = vi.fn(async (sql) => {
    if (failAt && sql.includes(failAt)) {
      throw Object.assign(new Error('postgresql://owner:leaked@example.test/hzense'), {
        code: '53300',
      });
    }
    if (sql.includes('runtime-acl-baseline:identity')) {
      return { rowCount: 1, rows: [identityRow] };
    }
    for (const category of runtimeAclBaselineCategoryNames) {
      const marker = category.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      if (sql.includes(`runtime-acl-baseline:${marker}`)) {
        return { rowCount: categoryRows[category].length, rows: categoryRows[category] };
      }
    }
    throw new Error(`Unexpected catalog query: ${sql}`);
  });
  return { query };
}

describe('Runtime ACL recovery baseline contract', () => {
  it('canonicalizes category order and keeps capture time outside the state fingerprint', () => {
    const forward = categories({
      memberships: [
        {
          member: 'neondb_owner',
          grantedRole: 'hzense_runtime',
          grantor: 'cloud_admin',
          adminOption: true,
          inheritOption: false,
          setOption: false,
        },
        {
          member: 'auditor',
          grantedRole: 'hzense_runtime',
          grantor: 'hzense_owner',
          adminOption: false,
          inheritOption: false,
          setOption: false,
        },
      ],
    });
    const reversed = Object.fromEntries(
      Object.entries(forward)
        .reverse()
        .map(([category, rows]) => [category, [...rows].reverse()]),
    );

    const first = buildRuntimeAclBaseline({
      identity: identity(),
      categories: forward,
      capturedAt,
      backupReference,
    });
    const second = buildRuntimeAclBaseline({
      identity: identity(),
      categories: reversed,
      capturedAt: '2026-09-05T12:00:00.000Z',
      backupReference,
    });

    expect(first).toMatchObject({
      format: runtimeAclBaselineFormat,
      mode: 'catalog-only-read-only',
      restoration: 'manual-review-required',
      executableSqlIncluded: false,
      backup: {
        referenceAlgorithm: 'sha256',
        referenceDomain: runtimeAclBackupReferenceDomain,
        reference: backupReference,
        provenance: 'operator-declared-provider-backup',
        providerApiVerified: false,
      },
      capturedAt,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.categories).toEqual(first.categories);
    expect(first.categories.memberships.rowCount).toBe(2);
  });

  it('changes both the category and envelope fingerprints when an ACL entry changes', () => {
    const before = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories(),
      capturedAt,
      backupReference,
    });
    const changed = categories();
    changed.databases[0] = { ...changed.databases[0], privilege: 'CREATE' };
    const after = buildRuntimeAclBaseline({
      identity: identity(),
      categories: changed,
      capturedAt,
      backupReference,
    });

    expect(after.categories.databases.fingerprint).not.toBe(
      before.categories.databases.fingerprint,
    );
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('distinguishes a synthetic explicit-empty column ACL from its NULL/default state', () => {
    const defaultState = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories(),
      capturedAt,
      backupReference,
    });
    const explicitEmptyCategories = categories();
    explicitEmptyCategories.columns[0] = {
      ...explicitEmptyCategories.columns[0],
      aclState: 'explicit',
    };
    const explicitEmptyState = buildRuntimeAclBaseline({
      identity: identity(),
      categories: explicitEmptyCategories,
      capturedAt,
      backupReference,
    });

    expect(defaultState.categories.columns.records[0]).toMatchObject({
      aclState: 'default',
      grantee: null,
      privilege: null,
    });
    expect(explicitEmptyState.categories.columns.records[0]).toMatchObject({
      aclState: 'explicit',
      grantee: null,
      privilege: null,
    });
    expect(explicitEmptyState.categories.columns.fingerprint).not.toBe(
      defaultState.categories.columns.fingerprint,
    );
    expect(explicitEmptyState.fingerprint).not.toBe(defaultState.fingerprint);
  });

  it('rejects credential-shaped fields, database URLs and incomplete category sets', () => {
    expect(() =>
      buildRuntimeAclBaseline({
        identity: { ...identity(), password: 'never-store-this' },
        categories: categories(),
        capturedAt,
        backupReference,
      }),
    ).toThrow(/rejects sensitive field/);
    expect(() =>
      buildRuntimeAclBaseline({
        identity: identity(),
        categories: categories({ routines: [{ routine: 'postgresql://user:pass@host/db' }] }),
        capturedAt,
        backupReference,
      }),
    ).toThrow(/rejects database URLs/);
    const incomplete = categories();
    delete incomplete.columns;
    expect(() =>
      buildRuntimeAclBaseline({
        identity: identity(),
        categories: incomplete,
        capturedAt,
        backupReference,
      }),
    ).toThrow(/categories are incomplete/);
  });

  it('binds the envelope fingerprint to a domain-separated backup reference without retaining the ID', () => {
    const first = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories(),
      capturedAt,
      backupReference,
    });
    const otherReference = runtimeAclBackupReference('runtime-acl-backup-2026-09-05T12:00:00Z');
    const second = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories(),
      capturedAt,
      backupReference: otherReference,
    });

    expect(first.backup.reference).toBe(backupReference);
    expect(backupReference).toBe(
      createHash('sha256')
        .update(runtimeAclBackupReferenceDomain)
        .update('\0')
        .update(backupId)
        .digest('hex'),
    );
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.categories).toEqual(second.categories);
    expect(JSON.stringify(first)).not.toContain(backupId);
    expect(() => runtimeAclBackupReference('placeholder')).toThrow(/pre-normalization backup/);
    expect(() => runtimeAclBackupReference('placeholder-backup-id')).toThrow(
      /pre-normalization backup/,
    );
  });

  it('distinguishes absent default privileges from an explicit empty ACL', () => {
    const absent = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories(),
      capturedAt,
      backupReference,
    });
    const explicitEmpty = buildRuntimeAclBaseline({
      identity: identity(),
      categories: categories({
        defaultPrivileges: [
          {
            owner: 'hzense_owner',
            schema: 'public',
            objectType: 'relation',
            aclState: 'explicit',
            grantee: null,
            grantor: null,
            privilege: null,
            grantable: null,
          },
        ],
      }),
      capturedAt,
      backupReference,
    });

    expect(absent.categories.defaultPrivileges.rowCount).toBe(0);
    expect(explicitEmpty.categories.defaultPrivileges.rowCount).toBe(1);
    expect(explicitEmpty.categories.defaultPrivileges.records[0]?.aclState).toBe('explicit');
    expect(explicitEmpty.categories.defaultPrivileges.fingerprint).not.toBe(
      absent.categories.defaultPrivileges.fingerprint,
    );
    expect(explicitEmpty.fingerprint).not.toBe(absent.fingerprint);
  });

  it('uses a preserving lateral join and emits ACL state for default privileges', async () => {
    const source = await readFile(sourcePath, 'utf8');
    const query = source.match(
      /defaultPrivileges: `\/\* runtime-acl-baseline:default-privileges \*\/[\s\S]*?`,\n\}\);/,
    )?.[0];

    expect(query).toBeDefined();
    expect(query).toContain('AS "aclState"');
    expect(query).toContain(
      'LEFT JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info ON true',
    );
    expect(query).not.toContain('CROSS JOIN LATERAL aclexplode(default_acl.defaclacl)');
  });

  it('passes nullable column ACLs directly to a preserving one-dimensional lateral explode', async () => {
    const source = await readFile(sourcePath, 'utf8');
    const query = source.match(
      /columns: `\/\* runtime-acl-baseline:columns \*\/[\s\S]*?`,\n {2}enumTypes:/,
    )?.[0];

    expect(query).toBeDefined();
    expect(query).toContain('AS "aclState"');
    expect(query).toContain('LEFT JOIN LATERAL aclexplode(column_info.attacl) AS acl_info ON true');
    expect(query).not.toContain('COALESCE(column_info.attacl, ARRAY[]::aclitem[])');
  });

  it('requires owner identity inside a repeatable-read, read-only transaction', async () => {
    for (const identityRow of [
      identity({ databaseOwner: 'different_owner' }),
      identity({ currentUser: 'hzense_runtime', sessionUser: 'hzense_runtime' }),
      identity({ sessionUser: 'bootstrap_owner' }),
      identity({ transactionReadOnly: false }),
      identity({ transactionIsolation: 'read committed' }),
      identity({ serverVersionNumber: 170_012 }),
    ]) {
      const client = catalogClient({ identityRow });
      await expect(
        inspectRuntimeAclBaseline(client, {
          expectedDatabase: 'hzense_test',
          expectedUser: identityRow.currentUser,
          expectedPostgresMajor: 18,
          capturedAt,
          backupReference,
        }),
      ).rejects.toThrow();
      expect(client.query).toHaveBeenCalledTimes(1);
    }
  });

  it('captures through a bounded read-only transaction and never exposes the URL in output', async () => {
    const catalog = catalogClient();
    const query = vi.fn(async (sql, parameters) => {
      if (
        sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' ||
        sql.startsWith('SET LOCAL') ||
        sql === 'ROLLBACK'
      ) {
        return { rowCount: null, rows: [] };
      }
      return catalog.query(sql, parameters);
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    };
    const createClient = vi.fn(() => client);
    const connectionString = 'postgresql://hzense_owner:super-secret@127.0.0.1:5432/hzense_test';

    const baseline = await runRuntimeAclBaselineCapture({
      connectionString,
      profile: 'local-test',
      expectedDatabase: 'hzense_test',
      expectedUser: 'hzense_owner',
      expectedPostgresMajor: 18,
      capturedAt,
      backupId,
      createClient,
    });

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    expect(query.mock.calls.map(([sql]) => sql).slice(0, 5)).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SET LOCAL search_path = pg_catalog, pg_temp',
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL idle_in_transaction_session_timeout = '45s'",
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    for (const [sql] of query.mock.calls.slice(5, -1)) {
      expect(sql).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i);
    }
    expect(baseline.transport).toEqual({
      profile: 'local-test',
      tlsEvidence: 'local-test',
      tlsVersion: null,
      tlsCipher: null,
    });
    const rendered = JSON.stringify(baseline);
    expect(rendered).not.toContain(connectionString);
    expect(rendered).not.toContain('super-secret');
    expect(rendered).not.toContain('connectionString');
    expect(rendered).not.toContain(backupId);
  });

  it('rolls back on catalog failure and provides a redacted CLI failure message', async () => {
    const catalog = catalogClient({ failAt: 'runtime-acl-baseline:schemas' });
    const query = vi.fn(async (sql, parameters) => {
      if (
        sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' ||
        sql.startsWith('SET LOCAL') ||
        sql === 'ROLLBACK'
      ) {
        return { rowCount: null, rows: [] };
      }
      return catalog.query(sql, parameters);
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    };
    let failure;
    try {
      await runRuntimeAclBaselineCapture({
        connectionString: 'postgresql://hzense_owner:hidden@127.0.0.1:5432/hzense_test',
        profile: 'local-test',
        expectedDatabase: 'hzense_test',
        expectedUser: 'hzense_owner',
        capturedAt,
        backupId,
        createClient: () => client,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(runtimeAclBaselineFailureMessage(failure)).toBe('unavailable; sqlstate=53300');
    expect(runtimeAclBaselineFailureMessage(failure)).not.toContain('hidden');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('maps the existing protected owner environment and rejects command-line values', () => {
    expect(
      runtimeAclBaselineProductionOptions({
        DATABASE_DIRECT_URL: 'postgresql://owner:hidden@db.example.test:5432/hzense',
        HZENSE_DATABASE_EXPECTED_HOST: 'db.example.test',
        HZENSE_DATABASE_EXPECTED_PORT: '5432',
        HZENSE_DATABASE_EXPECTED_NAME: 'hzense',
        HZENSE_DATABASE_EXPECTED_USER: 'owner',
        HZENSE_DATABASE_EXPECTED_POSTGRES_MAJOR: '18',
        HZENSE_RUNTIME_ACL_BACKUP_ID: backupId,
      }),
    ).toMatchObject({
      connectionString: 'postgresql://owner:hidden@db.example.test:5432/hzense',
      profile: 'production',
      expectedDatabase: 'hzense',
      expectedUser: 'owner',
      expectedPostgresMajor: 18,
      backupId,
    });
    expect(() =>
      runtimeAclBaselineProductionOptions({
        DATABASE_DIRECT_URL: 'postgresql://owner:hidden@db.example.test:5432/hzense',
      }),
    ).toThrow(/HZENSE_RUNTIME_ACL_BACKUP_ID is required/);
    expect(() =>
      runtimeAclBaselineProductionOptions({ HZENSE_RUNTIME_ACL_BACKUP_ID: 'pending-backup' }),
    ).toThrow(/new recoverable pre-normalization backup/);
    expect(() => assertRuntimeAclBaselineCliArguments([])).not.toThrow();
    expect(() => assertRuntimeAclBaselineCliArguments(['--url=postgresql://bad'])).toThrow(
      /only through protected environment values/,
    );
  });

  it('rejects a production pooler before constructing a client', async () => {
    const createClient = vi.fn();
    await expect(
      runRuntimeAclBaselineCapture({
        profile: 'production',
        createClient,
      }),
    ).rejects.toThrow(/HZENSE_RUNTIME_ACL_BACKUP_ID is required/);
    expect(createClient).not.toHaveBeenCalled();

    await expect(
      runRuntimeAclBaselineCapture({
        connectionString:
          'postgresql://owner:hidden@ep-example-pooler.eu-central-1.aws.neon.tech:5432/hzense?sslmode=verify-full',
        profile: 'production',
        expectedHost: 'ep-example-pooler.eu-central-1.aws.neon.tech',
        expectedPort: '5432',
        expectedDatabase: 'hzense',
        expectedUser: 'owner',
        backupId,
        createClient,
      }),
    ).rejects.toThrow(/requires an approved Neon direct endpoint/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('redacts command-line secrets from the real CLI failure path', () => {
    const secretArgument = 'postgresql://owner:must-not-leak@example.test/hzense';
    const result = spawnSync(process.execPath, [commandPath, secretArgument], {
      encoding: 'utf8',
      env: {},
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('[db:runtime-acl-baseline] unavailable');
    expect(result.stderr).not.toContain(secretArgument);
    expect(result.stderr).not.toContain('must-not-leak');
  });
});
