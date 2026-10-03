import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editorialResourceGrantPlan,
  editorialResourceRoleUpgradeSql,
  editorialTargetBinding,
  validateMaintenanceRequest,
  runMaintenance,
  publicMaintenanceFailure,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  inspect: vi.fn(),
  preflight: vi.fn(),
  load: vi.fn(),
  verify: vi.fn(),
  inspectAcl: vi.fn(),
  createRequire: vi.fn(),
  readFile: vi.fn(),
  policy: undefined,
}));
vi.mock('node:module', async (original) => ({
  ...(await original()),
  createRequire: calls.createRequire,
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original()),
  readFile: calls.readFile,
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({ connectionString: 'synthetic', expectedPostgresMajor: '18' }),
  validateConnectionTarget: () => calls.policy,
}));
vi.mock('../src/preflight.mjs', () => ({
  runDatabasePreflight: calls.preflight,
  inspectDatabasePreflight: calls.inspect,
}));
vi.mock('../src/migrate.mjs', () => ({
  loadMigrations: calls.load,
  verifyMigrationManifest: vi.fn(),
  migrationLockKeys: [1215921955, 1298498925],
}));
vi.mock('../src/verify.mjs', () => ({ verifyDatabaseContract: calls.verify }));
vi.mock('../src/runtime-acl-baseline.mjs', () => ({
  inspectRuntimeAclBaseline: calls.inspectAcl,
  runtimeAclBackupReference: (backupId) => ({ backupId }),
}));

const root = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(
  JSON.parse(readFileSync(new URL('checksums.json', root), 'utf8')),
).map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
const identity = { database: 'fixture', user: 'fixture_owner', pendingMigrations: [] };
const policy = {
  host: 'fixture.invalid',
  port: '5432',
  database: identity.database,
  user: identity.user,
};
const backup = 'synthetic-editorial-resource-backup';
const binding = editorialTargetBinding(policy, identity, backup);
const plan = editorialResourceGrantPlan(identity, migrations, binding);
const roleSql = readFileSync(
  new URL('../../../db/roles/upgrade_editorial_resources.sql', import.meta.url),
  'utf8',
);
const now = Date.parse('2026-10-04T12:00:00Z');
const approval = {
  operation: 'editorial-resource-grant',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-10-04T13:00:00Z',
  backupExpiresAt: '2026-10-05T13:00:00Z',
  backupVerified: true,
  restoreRehearsed: true,
  aclRecoveryReviewed: true,
  ddlFreezeConfirmed: true,
  aclFingerprint: 'b'.repeat(64),
  restoreEvidenceFingerprint: 'c'.repeat(64),
  roleUpgradeApproved: true,
  ...plan,
};
const environment = (changes = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: approval.sha,
  GITHUB_RUN_ID: approval.runId,
  GITHUB_RUN_ATTEMPT: approval.runAttempt,
  GH_TOKEN: 'synthetic',
  MAINTENANCE_OPERATION: approval.operation,
  MAINTENANCE_BACKUP_ID: backup,
  MAINTENANCE_APPROVAL: JSON.stringify({ ...approval, ...changes }),
});

describe('editorial resource permission rollout', () => {
  let client, state, fetchImpl;
  const execute = (changes = {}) =>
    runMaintenance(environment(changes), undefined, { fetchImpl, now: () => state.now });
  const grants = () => client.query.mock.calls.filter(([sql]) => sql === roleSql);
  beforeEach(() => {
    vi.resetAllMocks();
    state = { now, sha: approval.sha };
    client = Object.assign(new EventEmitter(), {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (sql) =>
        sql.startsWith('SELECT pg_try_advisory_lock') ? { rows: [{ locked: true }] } : { rows: [] },
      ),
      end: vi.fn().mockResolvedValue(undefined),
    });
    calls.createRequire.mockReturnValue(() => ({
      Client: class {
        constructor() {
          return client;
        }
      },
    }));
    calls.policy = policy;
    calls.inspect.mockResolvedValue(identity);
    calls.preflight.mockResolvedValue(identity);
    calls.load.mockResolvedValue(migrations);
    calls.readFile.mockResolvedValue(roleSql);
    calls.inspectAcl.mockResolvedValue({ fingerprint: approval.aclFingerprint });
    calls.verify.mockResolvedValue({ migrationCount: 28, tableCount: 60 });
    fetchImpl = vi.fn(async (url) => ({
      status: 200,
      json: async () =>
        url.includes('/runs?')
          ? {
              workflow_runs: [
                {
                  id: 122,
                  path: '.github/workflows/ci.yml',
                  repository: { full_name: 'hzense/tech-intelligence-hub' },
                  head_sha: approval.sha,
                  head_branch: 'main',
                  event: 'push',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            }
          : { ref: 'refs/heads/main', object: { type: 'commit', sha: state.sha } },
    }));
  });
  it('freezes the whole applied migration artifact, SQL bytes and reviewed target', () => {
    expect(editorialResourceRoleUpgradeSql(roleSql)).toBe(roleSql);
    expect(createHash('sha256').update(roleSql).digest('hex')).toBe(plan.roleUpgradeSha256);
    expect(validateMaintenanceRequest(environment(), now).approval).toEqual(approval);
    for (const pendingMigrations of [
      ['0027_automation_config_deletion.sql'],
      ['0028_future.sql'],
      null,
    ])
      expect(() =>
        editorialResourceGrantPlan({ ...identity, pendingMigrations }, migrations, binding),
      ).toThrow('complete-migrations-required');
    expect(() => editorialResourceGrantPlan(identity, migrations.slice(1), binding)).toThrow(
      'manifest-required',
    );
    expect(() => editorialResourceRoleUpgradeSql(`${roleSql}\n`)).toThrow('script-mismatch');
  });
  it.each([
    { roleUpgradeApproved: false },
    { roleUpgradeSha256: 'f'.repeat(64) },
    { targetFingerprint: null },
    { operation: 'migrate' },
    { restoreRehearsed: false },
    { runId: '124' },
  ])('rejects stale or broadened approval %j', (patch) => {
    expect(() => validateMaintenanceRequest(environment(patch), now)).toThrow();
  });
  it('preflights the grant without mutating, then uses one locked connection and verifies before and after grant', async () => {
    const preflight = await runMaintenance(
      { ...environment(), MAINTENANCE_OPERATION: 'preflight' },
      undefined,
      { fetchImpl, now: () => now },
    );
    expect(preflight).toMatchObject(plan);
    expect(grants()).toHaveLength(0);
    const result = await execute();
    expect(result).toMatchObject({ ...plan, roleUpgradeCompleted: true, status: 'succeeded' });
    expect(grants()).toHaveLength(1);
    expect(calls.verify).toHaveBeenCalledTimes(2);
    expect(calls.inspectAcl).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ expectedDatabase: identity.database, expectedUser: identity.user }),
    );
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SET statement_timeout = '30s'",
      "SET idle_in_transaction_session_timeout = '45s'",
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SET LOCAL search_path=pg_catalog,pg_temp',
      'ROLLBACK',
      roleSql,
      'SELECT pg_advisory_unlock($1, $2)',
    ]);
  });
  it.each(['lock', 'target', 'acl', 'schema', 'freshness', 'expiry', 'script'])(
    'blocks %s drift before any grant',
    async (failure) => {
      if (failure === 'lock') client.query.mockResolvedValue({ rows: [{ locked: false }] });
      if (failure === 'target')
        calls.inspect.mockResolvedValue({ ...identity, database: 'changed' });
      if (failure === 'acl') calls.inspectAcl.mockResolvedValue({ fingerprint: 'd'.repeat(64) });
      if (failure === 'schema')
        calls.verify.mockResolvedValue({ migrationCount: 27, tableCount: 60 });
      if (failure === 'freshness')
        calls.inspectAcl.mockImplementation(async () => {
          state.sha = 'f'.repeat(40);
          return { fingerprint: approval.aclFingerprint };
        });
      if (failure === 'expiry')
        calls.inspectAcl.mockImplementation(async () => {
          state.now += 3600001;
          return { fingerprint: approval.aclFingerprint };
        });
      if (failure === 'script') calls.readFile.mockResolvedValue(`${roleSql}\n`);
      expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({ status: 'blocked' });
      expect(grants()).toHaveLength(0);
    },
  );
  it('reports a post-grant verification failure as possibly committed and never retries', async () => {
    calls.verify
      .mockResolvedValueOnce({ migrationCount: 28, tableCount: 60 })
      .mockRejectedValueOnce(new Error('unavailable'));
    expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({
      status: 'failed',
      roleUpgradeCompleted: false,
      roleUpgradeMayHaveCommitted: true,
    });
    expect(grants()).toHaveLength(1);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
