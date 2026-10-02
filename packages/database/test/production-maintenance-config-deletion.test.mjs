import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  automationConfigDeletionTargetBinding,
  automationConfigDeletionMigrationPlan,
  requireAutomationConfigDeletionMigrationScope,
  automationConfigDeletionRoleUpgradeSql,
  automationTargetBinding,
  automationMigrationPlan,
  validateMaintenanceRequest,
  publicMaintenanceFailure,
  runMaintenance,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  preflight: vi.fn(),
  inspect: vi.fn(),
  load: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
  evidence: vi.fn(),
  inspectAcl: vi.fn(),
  createRequire: vi.fn(),
  readFile: vi.fn(),
  policy: undefined,
}));
vi.mock('node:module', async (importOriginal) => ({
  ...(await importOriginal()),
  createRequire: calls.createRequire,
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  readFile: calls.readFile,
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({ connectionString: 'synthetic-private-connection' }),
  validateConnectionTarget: () => calls.policy,
}));
vi.mock('../src/preflight.mjs', () => ({
  runDatabasePreflight: calls.preflight,
  inspectDatabasePreflight: calls.inspect,
}));
vi.mock('../src/migrate.mjs', () => ({
  loadMigrations: calls.load,
  verifyMigrationManifest: vi.fn(),
  runMigrations: calls.migrate,
  migrationLockKeys: [1215921955, 1298498925],
}));
vi.mock('../src/verify.mjs', () => ({ verifyDatabaseContract: calls.verify }));
vi.mock('../../../.github/scripts/public-acl-evidence.mjs', () => ({
  capturePublicAclEvidence: calls.capture,
  readPublicAclEvidence: calls.evidence,
}));
vi.mock('../src/runtime-acl-baseline.mjs', () => ({
  inspectRuntimeAclBaseline: calls.inspectAcl,
  runtimeAclBackupReference: (backupId) => ({ backupId }),
}));

const root = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(
  JSON.parse(readFileSync(new URL('checksums.json', root), 'utf8')),
).map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
const pending = ['0027_automation_config_deletion.sql'];
const identity = { database: 'fixture', user: 'fixture_owner' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const backup = 'synthetic-config-deletion-backup';
const binding = automationConfigDeletionTargetBinding(policy, identity, backup);
const plan = automationConfigDeletionMigrationPlan(pending, migrations, binding);
const roleUpgradeSha256 = '3372dcc11b59e8747589cf34f016a030c08f454a961b1d8a96a315e08d01bde2';
const roleSql = readFileSync(
  new URL('../../../db/roles/upgrade_automation_config_deletion.sql', import.meta.url),
  'utf8',
);
const now = Date.parse('2026-10-02T12:00:00Z');
const approval = {
  operation: 'migrate-and-verify',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-10-02T13:00:00Z',
  backupExpiresAt: '2026-10-03T13:00:00Z',
  backupVerified: false,
  backupPresenceReviewed: true,
  restoreRehearsed: false,
  aclRecoveryReviewed: false,
  ddlFreezeConfirmed: true,
  recoveryPolicy: 'accept-unverified-automation-config-deletion',
  riskAcceptance: {
    scope: 'automation-config-deletion-production-launch',
    accepted: true,
    historicalAclGapAccepted: true,
    acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
  },
  aclEvidenceMode: 'capture-in-run',
  publicArchiveApproved: true,
  archiveRepository: 'hzense/tech-intelligence-hub',
  roleUpgradeApproved: true,
  ...plan,
};
const environment = (changes = {}, envChanges = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: approval.sha,
  GITHUB_RUN_ID: approval.runId,
  GITHUB_RUN_ATTEMPT: approval.runAttempt,
  GH_TOKEN: 'synthetic',
  MAINTENANCE_OPERATION: approval.operation,
  MAINTENANCE_SEQUENCE_PHASE: 'prepare',
  MAINTENANCE_BACKUP_ID: backup,
  MAINTENANCE_APPROVAL: JSON.stringify({ ...approval, ...changes }),
  ...envChanges,
});

describe('independent 0027 migration and role-upgrade authority', () => {
  it('freezes all 28 migrations, only pending 0027, and the reviewed role-upgrade bytes', () => {
    expect(migrations).toHaveLength(28);
    expect(plan).toMatchObject({ ...binding, roleUpgradeSha256 });
    expect(Object.values(plan).every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(createHash('sha256').update(roleSql).digest('hex')).toBe(roleUpgradeSha256);
    expect(automationConfigDeletionRoleUpgradeSql(roleSql)).toBe(roleSql);
    expect(
      requireAutomationConfigDeletionMigrationScope(
        { pendingMigrations: pending },
        migrations,
        approval,
        binding,
      ),
    ).toEqual(plan);
    expect(validateMaintenanceRequest(environment(), now).approval).toEqual(approval);
  });

  it.each([
    [],
    Array(1),
    ['0026_automation_tasks.sql'],
    ['0026_automation_tasks.sql', ...pending],
    [...pending, ...pending],
    [...pending, '0028_future.sql'],
    ['0028_future.sql'],
    null,
    '0027_automation_config_deletion.sql',
  ])('rejects changed or additional pending migrations %j', (names) => {
    expect(() => automationConfigDeletionMigrationPlan(names, migrations, binding)).toThrow(
      'scope-required',
    );
  });

  it('checks every frozen file including historic migrations and the SQL bytes', () => {
    for (const artifact of [
      migrations.slice(0, -1),
      [...migrations, { name: '0028_future.sql', checksum: 'd'.repeat(64), sql: '' }],
      migrations.toReversed(),
      Array(28),
      ...[0, 26, 27].flatMap((changed) => [
        migrations.map((entry, index) =>
          index === changed ? { ...entry, sql: `${entry.sql} ` } : entry,
        ),
        migrations.map((entry, index) =>
          index === changed ? { ...entry, checksum: 'f'.repeat(64) } : entry,
        ),
        migrations.map((entry, index) =>
          index === changed ? { ...entry, name: `${entry.name}.changed` } : entry,
        ),
      ]),
    ]) {
      expect(() => automationConfigDeletionMigrationPlan(pending, artifact, binding)).toThrow(
        'manifest-required',
      );
    }
  });

  it('does not reuse the frozen 0026 manifest, plan, or target namespace', () => {
    const old = migrations.slice(0, -1);
    const oldBinding = automationTargetBinding(policy, identity, backup);
    const oldPlan = automationMigrationPlan(['0026_automation_tasks.sql'], old, oldBinding);
    expect(binding.targetFingerprint).not.toBe(oldBinding.targetFingerprint);
    expect(plan.planFingerprint).not.toBe(oldPlan.planFingerprint);
    expect(() => automationMigrationPlan(pending, migrations, binding)).toThrow(
      'manifest-required',
    );
    expect(() => automationConfigDeletionMigrationPlan(pending, old, binding)).toThrow(
      'manifest-required',
    );
    expect(() =>
      requireAutomationConfigDeletionMigrationScope(
        { pendingMigrations: pending },
        migrations,
        { ...approval, ...oldPlan },
        binding,
      ),
    ).toThrow('plan-mismatch');
  });

  it('binds every digest to the actual plan including the separately approved grant SQL', () => {
    for (const key of Object.keys(plan)) {
      for (const value of [undefined, 'bad', 'f'.repeat(64)]) {
        expect(() =>
          requireAutomationConfigDeletionMigrationScope(
            { pendingMigrations: pending },
            migrations,
            { ...approval, [key]: value },
            binding,
          ),
        ).toThrow('plan-mismatch');
      }
    }
  });

  it.each(['host', 'port', 'database', 'user'])(
    'binds target %s independently of a syntactically valid approval',
    (key) => {
      const different = `other-${policy[key]}`;
      const nextBinding = automationConfigDeletionTargetBinding(
        { ...policy, [key]: different },
        {
          ...identity,
          ...(key === 'database' || key === 'user' ? { [key]: different } : {}),
        },
        backup,
      );
      expect(nextBinding.targetFingerprint).not.toBe(binding.targetFingerprint);
      expect(() =>
        requireAutomationConfigDeletionMigrationScope(
          { pendingMigrations: pending },
          migrations,
          approval,
          nextBinding,
        ),
      ).toThrow('plan-mismatch');
      expect(() =>
        automationConfigDeletionTargetBinding({ ...policy, [key]: '' }, identity, backup),
      ).toThrow('target-required');
    },
  );

  it('requires the connected database and user to match and normalizes only host casing', () => {
    for (const key of ['database', 'user']) {
      expect(() =>
        automationConfigDeletionTargetBinding(policy, { ...identity, [key]: 'other' }, backup),
      ).toThrow('target-required');
    }
    expect(
      automationConfigDeletionTargetBinding(
        { ...policy, host: policy.host.toUpperCase() },
        identity,
        backup,
      ),
    ).toEqual(binding);
  });

  it.each(['', 'none', 'pending', 'example-backup', 'placeholder-branch', 'short', null])(
    'rejects an unreviewed backup %j',
    (value) => {
      expect(() => automationConfigDeletionTargetBinding(policy, identity, value)).toThrow(
        'reviewed-backup-required',
      );
    },
  );

  it('changes the approval plan when the backup changes', () => {
    const another = automationConfigDeletionTargetBinding(policy, identity, `${backup}-new`);
    expect(another.backupIdSha256).not.toBe(binding.backupIdSha256);
    expect(
      automationConfigDeletionMigrationPlan(pending, migrations, another).planFingerprint,
    ).not.toBe(plan.planFingerprint);
  });

  it.each([
    undefined,
    null,
    '',
    'BEGIN; GRANT ALL ON ALL TABLES IN SCHEMA public TO public; COMMIT;',
  ])('rejects missing or arbitrary role SQL %j', (sql) => {
    expect(() => automationConfigDeletionRoleUpgradeSql(sql)).toThrow();
  });

  it('rejects even whitespace-only or commented modification of the exact grant script', () => {
    for (const sql of [
      `${roleSql}\n`,
      `${roleSql}-- reviewed\n`,
      roleSql.replace('SELECT', 'UPDATE'),
    ]) {
      expect(() => automationConfigDeletionRoleUpgradeSql(sql)).toThrow();
    }
  });

  it.each(['migrate', 'search-apply', 'automation-config-deletion-grant'])(
    'does not expose a separate privileged %s operation under this policy',
    (operation) => {
      expect(() =>
        validateMaintenanceRequest(
          environment({ operation }, { MAINTENANCE_OPERATION: operation }),
          now,
        ),
      ).toThrow();
    },
  );

  it('permits separate evidence capture only with independent archive authority', () => {
    const changes = { operation: 'acl-capture' };
    const env = environment(changes, { MAINTENANCE_OPERATION: 'acl-capture' });
    expect(validateMaintenanceRequest(env, now).operation).toBe('acl-capture');
    expect(() =>
      validateMaintenanceRequest(
        environment(
          { ...changes, publicArchiveApproved: false },
          { MAINTENANCE_OPERATION: 'acl-capture' },
        ),
        now,
      ),
    ).toThrow();
  });
});

describe('real 0027 maintenance executor with isolated database mocks', () => {
  let migrationClient;
  let grantClient;
  let state;
  let ddl;
  let grantConstructed;
  let fetchImpl;
  const execute = () =>
    runMaintenance(
      environment(
        {},
        {
          MAINTENANCE_SEQUENCE_PHASE: 'apply',
          MAINTENANCE_ACL_ARCHIVE_CONFIRMED: 'success',
        },
      ),
      undefined,
      { fetchImpl, now: () => state.now },
    );
  const granted = () => grantClient.query.mock.calls.filter(([query]) => query === roleSql);

  beforeEach(() => {
    vi.resetAllMocks();
    state = { now, head: approval.sha, ci: 'success' };
    migrationClient = { query: vi.fn().mockResolvedValue({}) };
    grantClient = Object.assign(new EventEmitter(), {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (query) =>
        query.startsWith('SELECT pg_try_advisory_lock') ? { rows: [{ locked: true }] } : {},
      ),
      end: vi.fn().mockResolvedValue(undefined),
    });
    grantConstructed = vi.fn();
    calls.createRequire.mockReturnValue((module) => {
      expect(module).toBe('pg');
      return {
        Client: class {
          constructor(options) {
            grantConstructed(options);
            return grantClient;
          }
        },
      };
    });
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockImplementation(async (client) => ({
      ...identity,
      pendingMigrations: client === grantClient ? [] : pending,
    }));
    calls.load.mockResolvedValue(migrations);
    calls.readFile.mockImplementation(async (path, encoding) => {
      expect(path.href).toBe(
        new URL('../../../db/roles/upgrade_automation_config_deletion.sql', import.meta.url).href,
      );
      expect(encoding).toBe('utf8');
      return roleSql;
    });
    calls.capture.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
    calls.evidence.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
    calls.inspectAcl.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
    calls.verify.mockResolvedValue({ migrationCount: 28, tableCount: 60 });
    ddl = vi.fn();
    calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate(migrationClient);
      await beforeApply(pending, { migrations });
      ddl();
    });
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
                  conclusion: state.ci,
                },
              ],
            }
          : { ref: 'refs/heads/main', object: { type: 'commit', sha: state.head } },
    }));
  });

  it('runs the pinned grant after full verification using one locked authenticated connection', async () => {
    expect(await execute()).toMatchObject({
      migrationCount: 28,
      tableCount: 60,
      verificationCompleted: true,
      roleUpgradeCompleted: true,
      roleUpgradeSha256,
    });
    expect(ddl).toHaveBeenCalledOnce();
    expect(calls.verify).toHaveBeenCalledTimes(3);
    expect(grantConstructed).toHaveBeenCalledWith({
      connectionString: 'synthetic-private-connection',
      application_name: 'hzense-automation-config-deletion-grant',
      connectionTimeoutMillis: 10_000,
    });
    expect(grantClient.connect).toHaveBeenCalledOnce();
    expect(granted()).toHaveLength(1);
    const queries = grantClient.query.mock.calls.map(([query]) => query);
    expect(queries).toEqual([
      "SET statement_timeout = '30s'",
      "SET idle_in_transaction_session_timeout = '45s'",
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      roleSql,
      'SELECT pg_advisory_unlock($1, $2)',
    ]);
    expect(calls.inspect).toHaveBeenCalledWith(
      grantClient,
      expect.objectContaining({ expectedHost: policy.host }),
    );
    expect(grantClient.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [1215921955, 1298498925],
    );
    expect(grantClient.end).toHaveBeenCalledOnce();
  });

  it('rechecks the exact execution artifact under the migration lock before any DDL', async () => {
    calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate(migrationClient);
      await beforeApply(pending, { migrations: migrations.slice(0, -1) });
      ddl();
    });
    expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({
      phase: 'migrate',
      status: 'blocked',
    });
    expect(ddl).not.toHaveBeenCalled();
    expect(grantConstructed).not.toHaveBeenCalled();
  });

  it('refuses ACL drift on the original locked client before any DDL', async () => {
    calls.inspectAcl.mockResolvedValue({ fingerprint: 'f'.repeat(64) });
    expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({
      phase: 'migrate',
      gate: 'migration-sequence-acl-drift',
    });
    expect(ddl).not.toHaveBeenCalled();
    expect(migrationClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(grantConstructed).not.toHaveBeenCalled();
  });

  it('refuses wrong grant SQL before migration and before creating the grant client', async () => {
    calls.readFile.mockResolvedValue(`${roleSql}\n`);
    expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({
      phase: 'migrate',
      gate: 'automation-config-deletion-role-script-mismatch',
    });
    expect(ddl).not.toHaveBeenCalled();
    expect(grantConstructed).not.toHaveBeenCalled();
  });

  it('rechecks the role SQL after migration instead of trusting a prior filesystem read', async () => {
    calls.readFile.mockResolvedValueOnce(roleSql).mockResolvedValueOnce(`${roleSql}\n`);
    expect(await execute().catch(publicMaintenanceFailure)).toMatchObject({
      phase: 'automation-config-deletion-grant',
      gate: 'automation-config-deletion-role-script-mismatch',
      migrationMayHaveCommitted: true,
    });
    expect(ddl).toHaveBeenCalledOnce();
    expect(grantConstructed).not.toHaveBeenCalled();
  });

  it.each(['lock', 'pending', 'target', 'manifest', 'verify', 'expiry', 'main', 'CI'])(
    'refuses the grant on a repeated %s check and closes the same client without retry',
    async (failure) => {
      if (failure === 'lock')
        grantClient.query.mockImplementation(async (query) =>
          query.startsWith('SELECT pg_try_advisory_lock') ? { rows: [{ locked: false }] } : {},
        );
      const originalInspect = calls.inspect.getMockImplementation();
      calls.inspect.mockImplementation(async (client, options) => {
        const result = await originalInspect(client, options);
        if (client !== grantClient) return result;
        if (failure === 'pending') return { ...result, pendingMigrations: pending };
        if (failure === 'target') return { ...result, database: 'changed-target' };
        return result;
      });
      if (failure === 'manifest')
        calls.load.mockResolvedValueOnce(migrations).mockResolvedValueOnce(migrations.slice(0, -1));
      let checks = 0;
      calls.verify.mockImplementation(async () => {
        checks += 1;
        if (checks === 3) {
          if (failure === 'verify') return { migrationCount: 28, tableCount: 59 };
          if (failure === 'expiry') state.now = Date.parse(approval.expiresAt);
          if (failure === 'main') state.head = 'f'.repeat(40);
          if (failure === 'CI') state.ci = 'failure';
        }
        return { migrationCount: 28, tableCount: 60 };
      });
      const result = await execute().catch(publicMaintenanceFailure);
      expect(result).toMatchObject({
        phase: 'automation-config-deletion-grant',
        status: 'blocked',
        migrationMayHaveCommitted: true,
      });
      expect(ddl).toHaveBeenCalledOnce();
      expect(granted()).toHaveLength(0);
      expect(grantClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(grantClient.end).toHaveBeenCalledOnce();
    },
  );

  it('rolls back a failed grant exactly once and does not leak database errors or retry the write', async () => {
    const original = grantClient.query.getMockImplementation();
    grantClient.query.mockImplementation(async (query, params) => {
      if (query === roleSql)
        throw Object.assign(new Error('synthetic-private-connection'), { code: '42501' });
      return original(query, params);
    });
    const result = await execute().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      status: 'failed',
      phase: 'automation-config-deletion-grant',
      sqlstate: '42501',
      migrationMayHaveCommitted: true,
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-connection');
    expect(granted()).toHaveLength(1);
    expect(grantClient.query.mock.calls.filter(([query]) => query === 'ROLLBACK')).toHaveLength(1);
    expect(grantClient.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1, $2)',
      [1215921955, 1298498925],
    );
    expect(grantClient.end).toHaveBeenCalledOnce();
  });

  it.each(['connect', 'schema verification', 'GitHub freshness'])(
    'handles an idle database error during %s without an uncaught exception or grant retry',
    async (stage) => {
      const privateError = Object.assign(
        new Error('synthetic-private-idle-error postgresql://secret@fixture.invalid/private'),
        { code: '08006', detail: 'synthetic-private-provider-detail' },
      );
      let emitted = 0;
      const installedListenerCounts = [];
      let emissionError;
      const emitIdleError = () => {
        emitted += 1;
        installedListenerCounts.push(grantClient.listenerCount('error'));
        try {
          grantClient.emit('error', privateError);
        } catch (error) {
          emissionError = error;
          throw error;
        }
      };
      if (stage === 'connect') grantClient.connect.mockImplementation(async () => emitIdleError());
      if (stage === 'schema verification') {
        let checks = 0;
        calls.verify.mockImplementation(async () => {
          checks += 1;
          if (checks === 3) emitIdleError();
          return { migrationCount: 28, tableCount: 60 };
        });
      }
      if (stage === 'GitHub freshness') {
        const freshFetch = fetchImpl.getMockImplementation();
        fetchImpl.mockImplementation(async (url) => {
          const result = await freshFetch(url);
          if (calls.verify.mock.calls.length === 3 && emitted === 0) emitIdleError();
          return result;
        });
      }
      const result = await execute().catch(publicMaintenanceFailure);
      expect(emitted).toBe(1);
      expect(installedListenerCounts).toHaveLength(1);
      expect(installedListenerCounts[0]).toBeGreaterThan(0);
      expect(emissionError).toBeUndefined();
      expect(result).toMatchObject({
        phase: 'automation-config-deletion-grant',
        migrationMayHaveCommitted: true,
      });
      expect(['blocked', 'failed']).toContain(result.status);
      expect(result.roleUpgradeCompleted).not.toBe(true);
      expect(ddl).toHaveBeenCalledOnce();
      expect(granted()).toHaveLength(0);
      expect(grantConstructed).toHaveBeenCalledOnce();
      expect(grantClient.connect).toHaveBeenCalledOnce();
      expect(grantClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(grantClient.end).toHaveBeenCalledOnce();
      const receipt = JSON.stringify(result);
      for (const secret of [
        'synthetic-private-idle-error',
        'secret@fixture.invalid',
        'synthetic-private-provider-detail',
      ]) {
        expect(receipt).not.toContain(secret);
      }
    },
  );
});
