import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clients: [],
  tls: vi.fn(),
  baseline: vi.fn(),
  runtime: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function () {
      const client = mocks.clients.shift();
      if (!client) throw new Error('Unexpected third connection');
      return client;
    }),
  },
}));
vi.mock('../src/preflight.mjs', async (original) => ({
  ...(await original()),
  inspectProductionTls: mocks.tls,
}));
vi.mock('../src/runtime-acl-baseline.mjs', async (original) => ({
  ...(await original()),
  inspectRuntimeAclBaseline: mocks.baseline,
}));
vi.mock('../src/runtime-reader-preflight.mjs', async (original) => ({
  ...(await original()),
  runRestoredRuntimeReaderPreflight: mocks.runtime,
}));

import pg from 'pg';
import {
  collectRecoveryVerification,
  recoveryIdentityQuery,
  recoveryStateQuery,
} from '../src/recovery-verification.mjs';
import { runRecoveryVerification } from '../../../.github/scripts/recovery-verification.mjs';
import { withRecoveryReadClient } from '../src/recovery-read-client.mjs';

const now = Date.parse('2026-09-10T10:00:00Z');
const approval = {
  operation: 'capture-r1',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-09-10T10:30:00Z',
  targetExpiresAt: '2026-09-11T10:00:00Z',
  sourceNeverExpires: true,
  topologyReviewed: true,
  ddlFreezeConfirmed: true,
  publicArchiveApproved: true,
  archiveRepository: 'hzense/tech-intelligence-hub',
  projectId: 'collector-test-project',
  targetBranchId: 'br-test-target',
  sourceBranchId: 'br-test-source',
  productionBranchId: 'br-test-main',
  targetFingerprint: '12'.repeat(32),
  sourceFingerprint: '34'.repeat(32),
  productionFingerprint: '56'.repeat(32),
  directHost: 'ep-unit.eu-central-1.aws.neon.tech',
  runtimeHost: 'ep-unit-pooler.eu-central-1.aws.neon.tech',
  r1Fingerprint: '78'.repeat(32),
};
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: approval.archiveRepository,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_SHA: approval.sha,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF:
    'hzense/tech-intelligence-hub/.github/workflows/recovery-verification.yml@refs/heads/main',
  GH_TOKEN: 'collector-test-token',
  RUNNER_TEMP: '/tmp',
  RECOVERY_OPERATION: approval.operation,
  RECOVERY_APPROVAL: JSON.stringify(approval),
  RECOVERY_OWNER_URL: `postgresql://hzense_migrator:test-only-secret@${approval.directHost}:5432/hzense?sslmode=verify-full`,
};
function fakeClient({
  state = approval.r1Fingerprint,
  baseline = 'ab'.repeat(32),
  identity = {},
} = {}) {
  const client = {
    baseline: { fingerprint: baseline },
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(async (sql) => {
      if (sql === recoveryIdentityQuery)
        return {
          rowCount: 1,
          rows: [
            {
              database_name: 'hzense',
              authenticated_role: 'hzense_migrator',
              effective_role: 'hzense_migrator',
              read_only: 'on',
              version: 180006,
              event_triggers: 0,
              search_columns: 18,
              identity: {
                'neon.project_id': approval.projectId,
                'neon.branch_id': approval.targetBranchId,
              },
              fingerprint: approval.targetFingerprint,
              ...identity,
            },
          ],
        };
      if (sql === recoveryStateQuery)
        return { rows: [{ fingerprint: state, summary: { format: 'hzense-fts-acl-state/v1' } }] };
      if (/^(BEGIN TRANSACTION|SET LOCAL|ROLLBACK$)/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    }),
  };
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.length = 0;
  mocks.tls.mockReset().mockResolvedValue({});
  mocks.baseline.mockReset().mockImplementation(async (client) => client.baseline);
  mocks.runtime.mockReset();
});

// Exercise the REAL collector; only the DB transport/catalog adapters are
// mocked. No live connections, no bypass flag is added to the shipped entry.
describe('collectRecoveryVerification direct orchestration', () => {
  it('uses and closes two independent clients and checks both fingerprint channels', async () => {
    const first = fakeClient();
    const second = fakeClient();
    mocks.clients.push(first, second);
    const guard = vi.fn();
    const result = await collectRecoveryVerification(env, approval, guard);
    expect(result.independentCapturesMatch).toBe(true);
    expect(result.captures).toHaveLength(2);
    expect(pg.Client).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledTimes(4);
    for (const client of [first, second]) {
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
      expect(client.end).toHaveBeenCalledTimes(1);
    }
    expect(first.end.mock.invocationCallOrder[0]).toBeLessThan(
      second.connect.mock.invocationCallOrder[0],
    );
  });
  it.each([{ state: 'cd'.repeat(32) }, { baseline: 'ef'.repeat(32) }])(
    'rejects divergent independent captures %j',
    async (changes) => {
      const first = fakeClient();
      const second = fakeClient(changes);
      mocks.clients.push(first, second);
      await expect(collectRecoveryVerification(env, approval, vi.fn())).rejects.toThrow(
        'independent captures differ',
      );
      expect(first.end).toHaveBeenCalledOnce();
      expect(second.end).toHaveBeenCalledOnce();
    },
  );
  it('rejects R3 different from R1 even if a second matching capture could be made', async () => {
    const first = fakeClient({ state: 'cd'.repeat(32) });
    const second = fakeClient({ state: 'cd'.repeat(32) });
    mocks.clients.push(first, second);
    await expect(
      collectRecoveryVerification(env, { ...approval, operation: 'capture-r3' }, vi.fn()),
    ).rejects.toThrow('R3 differs from reviewed R1');
    expect(pg.Client).toHaveBeenCalledOnce();
    expect(first.end).toHaveBeenCalledOnce();
    expect(second.connect).not.toHaveBeenCalled();
  });
  it('accepts matching R3 only after two independent captures and cleanup', async () => {
    mocks.clients.push(fakeClient(), fakeClient());
    const result = await collectRecoveryVerification(
      env,
      { ...approval, operation: 'capture-r3' },
      vi.fn(),
    );
    expect(result.captures.map((capture) => capture.state.fingerprint)).toEqual([
      approval.r1Fingerprint,
      approval.r1Fingerprint,
    ]);
  });
  it('closes the first connection if approval expires during its capture', async () => {
    const first = fakeClient();
    mocks.clients.push(first);
    const expired = new Error('expired');
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(expired);
    await expect(collectRecoveryVerification(env, approval, guard)).rejects.toBe(expired);
    expect(first.end).toHaveBeenCalledOnce();
    expect(pg.Client).toHaveBeenCalledOnce();
  });
  it('preserves inspection failure when rollback also fails, and always closes', async () => {
    const first = fakeClient();
    mocks.clients.push(first);
    const original = Object.assign(new Error('inspection failed'), { code: '42501' });
    mocks.baseline.mockRejectedValueOnce(original);
    const query = first.query.getMockImplementation();
    first.query.mockImplementation((sql) =>
      sql === 'ROLLBACK' ? Promise.reject(new Error('rollback failed')) : query(sql),
    );
    await expect(collectRecoveryVerification(env, approval, vi.fn())).rejects.toBe(original);
    expect(first.end).toHaveBeenCalledOnce();
  });
  it('connect failure closes without attempting rollback or masking the original error', async () => {
    const first = fakeClient();
    mocks.clients.push(first);
    const original = new Error('connection failed');
    first.connect.mockRejectedValue(original);
    first.end.mockRejectedValue(new Error('close failed'));
    await expect(collectRecoveryVerification(env, approval, vi.fn())).rejects.toBe(original);
    expect(first.query).not.toHaveBeenCalled();
    expect(first.end).toHaveBeenCalledOnce();
  });
  it.each(['rollback', 'close'])(
    'fails on %s failure even if capture would otherwise succeed',
    async (failure) => {
      const first = fakeClient();
      mocks.clients.push(first);
      const error = new Error('cleanup failed');
      if (failure === 'close') first.end.mockRejectedValue(error);
      else {
        const query = first.query.getMockImplementation();
        first.query.mockImplementation((sql) =>
          sql === 'ROLLBACK' ? Promise.reject(error) : query(sql),
        );
      }
      await expect(collectRecoveryVerification(env, approval, vi.fn())).rejects.toBe(error);
      expect(first.end).toHaveBeenCalledOnce();
      expect(pg.Client).toHaveBeenCalledOnce();
    },
  );
  it('does not archive when the REAL collector finds divergence', async () => {
    mocks.clients.push(fakeClient(), fakeClient({ state: 'cd'.repeat(32) }));
    const save = vi.fn();
    const fetchImpl = vi.fn(async (url) => ({
      status: 200,
      json: async () =>
        url.includes('/git/ref/')
          ? {
              ref: 'refs/heads/main',
              object: { type: 'commit', sha: env.GITHUB_SHA },
            }
          : {
              workflow_runs: [
                {
                  id: 77,
                  path: '.github/workflows/ci.yml',
                  repository: { full_name: env.GITHUB_REPOSITORY },
                  head_sha: env.GITHUB_SHA,
                  head_branch: 'main',
                  event: 'push',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
    }));
    await expect(
      runRecoveryVerification(env, {
        now: () => now,
        fetchImpl,
        save,
        collect: collectRecoveryVerification,
      }),
    ).rejects.toThrow('independent captures differ');
    expect(save).not.toHaveBeenCalled();
  });
  it('emits Runtime conclusion flags only when the full preflight resolves', async () => {
    const runtimeEnv = {
      RECOVERY_RUNTIME_URL: `postgresql://hzense_runtime:test-only-secret@${approval.runtimeHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`,
    };
    mocks.runtime.mockRejectedValueOnce(new Error('runtime contract failed'));
    await expect(
      collectRecoveryVerification(
        runtimeEnv,
        { ...approval, operation: 'verify-restored' },
        vi.fn(),
      ),
    ).rejects.toThrow('runtime contract failed');
    mocks.runtime.mockResolvedValueOnce({
      topicColumns: [1, 2, 3, 4, 5],
      searchColumns: [],
      verifiedNeonReservedDatabases: [],
    });
    expect(
      await collectRecoveryVerification(
        runtimeEnv,
        { ...approval, operation: 'verify-restored' },
        vi.fn(),
      ),
    ).toMatchObject({
      verificationBasis: 'completed-runtime-preflight-assertions',
      runtimeAuthenticated: true,
      negativeReadsDenied: true,
    });
  });
});

describe('shared recovery read cleanup', () => {
  it('preserves primary error and attempts rollback and close once', async () => {
    const client = fakeClient();
    const error = new Error('primary');
    client.query.mockRejectedValue(new Error('rollback'));
    client.end.mockRejectedValue(new Error('close'));
    await expect(
      withRecoveryReadClient(client, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.end).toHaveBeenCalledOnce();
  });
  it('rejects even a non-Error cleanup rejection rather than returning success', async () => {
    const client = fakeClient();
    client.end.mockRejectedValue(undefined);
    await expect(
      withRecoveryReadClient(client, async () => 'must-not-return'),
    ).rejects.toBeUndefined();
  });
});
