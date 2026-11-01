import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  executeTopicMaintenance,
  TopicMaintenanceError,
} from '../../../.github/scripts/topic-maintenance.mjs';
import { normalizeDesiredTopics, planTopicSync, syncTopics } from '../src/topic-sync.mjs';
import { verifyTopicProjectionReadOnly } from '../src/topic-projection-verify.mjs';

const copy = (value) => globalThis.structuredClone(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const desired = Array.from({ length: 62 }, (_, index) => ({
  id: `topic-${index < 10 ? 'root' : 'child'}-${index}`,
  title: `Public catalog ${index}`,
  parentId: index < 10 ? null : `topic-root-${index % 10}`,
  status: index < 47 ? 'active' : 'watching',
  runtimeEnabled: index < 47,
}));
const policy = { host: 'fixture.invalid', port: '5432', database: 'fixture', user: 'owner' };

function fixture() {
  const state = {
    rows: desired.map((row, index) => ({
      ...row,
      status: index >= 10 && index < 15 ? 'active' : 'watching',
      runtimeEnabled: index >= 10 && index < 15,
    })),
    active: 0,
    total: 3,
    roleExists: true,
  };
  const clients = [];
  const env = {
    HZENSE_TOPIC_SYNC_DATABASE_URL: 'private-scoped-connection',
    MAINTENANCE_BACKUP_ID: 'reviewed-backup-fixture',
  };
  const context = { checkFreshness: vi.fn(async () => {}), checkApproval: vi.fn(() => {}) };
  const deps = {
    options: {
      connectionString: 'private-owner-connection',
      ...Object.fromEntries(
        Object.entries(policy).map(([key, value]) => [
          `expected${key[0].toUpperCase()}${key.slice(1)}`,
          value,
        ]),
      ),
    },
    desiredTopics: copy(desired),
    normalizeDesiredTopics,
    planTopicSync,
    syncTopics: vi.fn(syncTopics),
    verifyTopicProjectionReadOnly: vi.fn(verifyTopicProjectionReadOnly),
    validateConnectionTarget: vi.fn((options) => ({
      ...policy,
      user: options.expectedUser ?? policy.user,
    })),
    assertDirectTopicSyncEndpoint: vi.fn(),
    loadMigrations: vi.fn(async () => [{ name: '0000_fixture.sql', checksum: 'a'.repeat(64) }]),
    verifyMigrationManifest: vi.fn(),
    verifyDatabaseContract: vi.fn(async () => ({ migrationCount: 33, tableCount: 58 })),
    inspectDatabasePreflight: vi.fn(async () => ({
      database: policy.database,
      user: policy.user,
      pendingMigrations: [],
    })),
    inspectTopicSyncPreflight: vi.fn(async () => ({
      database: policy.database,
      user: 'hzense_topic_sync',
    })),
    createClient: vi.fn((options) => {
      let transaction;
      const client = Object.assign(new EventEmitter(), {
        connectionString: options.connectionString,
        connect: vi.fn(async () => {}),
        end: vi.fn(async () => {}),
        query: vi.fn(async (sql, values) => {
          if (sql.startsWith('SET ') || sql.startsWith('LOCK TABLE ')) return { rows: [] };
          if (sql.startsWith('BEGIN')) {
            transaction = copy(state.rows);
            return { rows: [] };
          }
          if (sql === 'ROLLBACK') {
            transaction = undefined;
            return { rows: [] };
          }
          if (sql === 'COMMIT') {
            if (options.connectionString === env.HZENSE_TOPIC_SYNC_DATABASE_URL && transaction)
              state.rows = copy(transaction);
            transaction = undefined;
            return { rows: [] };
          }
          if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
          if (sql.includes('FROM public.topics')) return { rows: copy(transaction ?? state.rows) };
          if (sql.includes('FROM public.signal_verification_dependency_seals'))
            return { rows: [{ active: String(state.active), total: String(state.total) }] };
          if (sql.includes('FROM pg_roles')) return { rows: [{ present: state.roleExists }] };
          if (sql.startsWith('INSERT INTO public.topics')) {
            expect(options.connectionString).toBe(env.HZENSE_TOPIC_SYNC_DATABASE_URL);
            expect(transaction).toBeDefined();
            for (let i = 0; i < values[0].length; i++) {
              const row = {
                id: values[0][i],
                title: values[1][i],
                parentId: values[2][i],
                status: values[3][i],
                runtimeEnabled: values[4][i],
              };
              const index = transaction.findIndex((entry) => entry.id === row.id);
              if (index < 0) transaction.push(row);
              else transaction[index] = row;
            }
            return { rows: [], rowCount: values[0].length };
          }
          throw new Error(`Unexpected fixture SQL ${sql}`);
        }),
      });
      clients.push(client);
      return client;
    }),
  };
  const execute = (operation, approval) =>
    executeTopicMaintenance(env, { operation, approval }, context, deps);
  const approve = async () => {
    const result = await execute('topic-plan');
    return {
      projectionFingerprint: result.fingerprint,
      planFingerprint: result.planFingerprint,
      manifestFingerprint: result.manifestFingerprint,
      targetFingerprint: result.targetFingerprint,
      backupIdSha256: hash(env.MAINTENANCE_BACKUP_ID),
      publicationFreezeConfirmed: true,
    };
  };
  const queries = () => clients.flatMap((client) => client.query.mock.calls.map(([sql]) => sql));
  return { state, env, context, deps, clients, execute, approve, queries };
}

describe('protected production Topic projection maintenance', () => {
  it('plans through an owner READ ONLY transaction without a dedicated secret or DML', async () => {
    const f = fixture();
    delete f.env.HZENSE_TOPIC_SYNC_DATABASE_URL;
    f.state.roleExists = false;
    const before = copy(f.state.rows);
    const result = await f.execute('topic-plan');
    expect(result).toMatchObject({
      desiredCount: 62,
      enabledCount: 47,
      rootTopicCount: 10,
      currentEnabledCount: 5,
      missingRootCount: 10,
      activeSealCount: 0,
      sealTotalCount: 3,
      roleExists: false,
      inserted: 0,
      updated: 42,
      unchanged: 20,
      previewOnly: true,
      committed: false,
    });
    expect(f.queries()).toContain('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.queries().some((sql) => /^(INSERT|UPDATE|DELETE|TRUNCATE|LOCK)/.test(sql))).toBe(
      false,
    );
    expect(f.state.rows).toEqual(before);
    expect(f.deps.inspectTopicSyncPreflight).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/fixture|private|owner|connection|Public catalog/);
    expect(f.clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
  });

  it('applies the exact plan only through the restricted role and independently verifies no-op', async () => {
    const f = fixture();
    const approval = await f.approve();
    const result = await f.execute('topic-apply', approval);
    expect(result).toMatchObject({
      committed: true,
      verificationCompleted: true,
      updated: 42,
      currentEnabledCount: 47,
      missingRootCount: 0,
      migrationCount: 33,
      tableCount: 58,
      planFingerprint: approval.planFingerprint,
    });
    expect(f.state.rows).toEqual(expect.arrayContaining(desired));
    expect(f.deps.syncTopics).toHaveBeenCalledOnce();
    expect(f.deps.verifyTopicProjectionReadOnly).toHaveBeenCalledOnce();
    const applied = f.clients.find((client) =>
      client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT')),
    );
    const verified = f.clients.find((client) =>
      client.query.mock.calls.some(([sql]) => sql === 'BEGIN READ ONLY'),
    );
    expect(applied).not.toBe(verified);
    expect(applied.connectionString).toBe('private-scoped-connection');
    expect(verified.connectionString).toBe('private-scoped-connection');
    expect(f.deps.inspectTopicSyncPreflight.mock.calls.at(-1)[1].expectedTransactionReadOnly).toBe(
      true,
    );
    expect(f.context.checkApproval).toHaveBeenCalled();
    expect(f.clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
  });

  it.each(['topic-apply', 'topic-verify'])(
    'rejects %s without scoped credentials before opening any session',
    async (operation) => {
      const f = fixture();
      delete f.env.HZENSE_TOPIC_SYNC_DATABASE_URL;
      await expect(f.execute(operation)).rejects.toMatchObject({
        gate: 'dedicated-credential-required',
        mayHaveCommitted: false,
      });
      expect(f.clients).toHaveLength(0);
    },
  );

  it.each(['projectionFingerprint', 'planFingerprint', 'manifestFingerprint', 'targetFingerprint'])(
    'rejects changed %s before mutation',
    async (field) => {
      const f = fixture();
      const approval = await f.approve();
      approval[field] = 'f'.repeat(64);
      await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
        gate: 'reviewed-plan-mismatch',
        mayHaveCommitted: false,
      });
      expect(f.deps.syncTopics).not.toHaveBeenCalled();
    },
  );

  it('requires the separate publication freeze declaration and matching backup', async () => {
    const f = fixture();
    const approval = await f.approve();
    await expect(
      f.execute('topic-apply', { ...approval, publicationFreezeConfirmed: false }),
    ).rejects.toMatchObject({ gate: 'publication-freeze-required' });
    await expect(
      f.execute('topic-apply', { ...approval, backupIdSha256: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ gate: 'reviewed-backup-required' });
    expect(f.deps.syncTopics).not.toHaveBeenCalled();
  });

  it('rejects cross-target or owner credentials for the Topic writer', async () => {
    const f = fixture();
    const approval = await f.approve();
    f.deps.validateConnectionTarget.mockImplementation((options) => ({
      ...policy,
      user: options.expectedUser === 'hzense_topic_sync' ? policy.user : options.expectedUser,
    }));
    await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
      gate: 'dedicated-target-required',
    });
    expect(f.deps.syncTopics).not.toHaveBeenCalled();
  });

  it('refuses active historical verification seals before any DML', async () => {
    const f = fixture();
    const approval = await f.approve();
    f.state.active = 1;
    await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
      gate: 'active-seals-present',
      mayHaveCommitted: false,
    });
    expect(f.deps.syncTopics).not.toHaveBeenCalled();
  });

  it('rolls back Topic changes if a new seal appears before commit', async () => {
    const f = fixture();
    const approval = await f.approve();
    const before = copy(f.state.rows);
    f.deps.syncTopics.mockImplementation((client, rows, options) =>
      syncTopics(client, rows, {
        ...options,
        beforeVerification: async (...args) => {
          f.state.total++;
          await options.beforeVerification(...args);
        },
      }),
    );
    await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
      gate: 'seals-changed',
      mayHaveCommitted: false,
    });
    expect(f.state.rows).toEqual(before);
    const writer = f.clients.find((client) =>
      client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT')),
    );
    expect(writer.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(writer.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
  });

  it('rechecks plan drift inside the locked write transaction and preserves the original state', async () => {
    const f = fixture();
    const approval = await f.approve();
    f.deps.syncTopics.mockImplementation((client, rows, options) => {
      f.state.rows[0].title = 'changed concurrently';
      return syncTopics(client, rows, options);
    });
    await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
      gate: 'unavailable',
      mayHaveCommitted: false,
    });
    expect(f.queries().some((sql) => sql.startsWith('INSERT'))).toBe(false);
    expect(f.state.rows[0].runtimeEnabled).toBe(false);
  });

  it('rechecks approval before commit and rolls back when it expires', async () => {
    const f = fixture();
    const approval = await f.approve();
    const before = copy(f.state.rows);
    f.context.checkApproval
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('private approval detail');
      });
    await expect(f.execute('topic-apply', approval)).rejects.toMatchObject({
      gate: 'unavailable',
      mayHaveCommitted: false,
    });
    expect(f.state.rows).toEqual(before);
  });

  it('reports possible committed state if the independent verification fails', async () => {
    const f = fixture();
    const approval = await f.approve();
    f.deps.verifyTopicProjectionReadOnly.mockRejectedValue(new Error('private database detail'));
    const error = await f.execute('topic-apply', approval).catch((error) => error);
    expect(error).toBeInstanceOf(TopicMaintenanceError);
    expect(error).toMatchObject({
      operation: 'topic-apply',
      gate: 'unavailable',
      mayHaveCommitted: true,
    });
    expect(error.message).not.toContain('private');
    expect(error.cause).toBeUndefined();
    expect(f.state.rows.filter((row) => row.runtimeEnabled)).toHaveLength(47);
  });

  it('verifies an existing projection without writing or claiming a commit', async () => {
    const f = fixture();
    f.state.rows = copy(desired);
    const result = await f.execute('topic-verify');
    expect(result).toMatchObject({
      committed: false,
      verificationCompleted: true,
      inserted: 0,
      updated: 0,
      unchanged: 62,
      currentEnabledCount: 47,
      missingRootCount: 0,
    });
    expect(f.deps.syncTopics).not.toHaveBeenCalled();
    expect(f.queries().some((sql) => /^(INSERT|UPDATE|DELETE|TRUNCATE|LOCK)/.test(sql))).toBe(
      false,
    );
  });

  it('rejects pending schema or unknown Topic IDs rather than adopting them', async () => {
    const pending = fixture();
    pending.deps.inspectDatabasePreflight.mockResolvedValue({
      database: policy.database,
      user: policy.user,
      pendingMigrations: ['0034_future.sql'],
    });
    await expect(pending.execute('topic-plan')).rejects.toMatchObject({
      gate: 'applied-schema-required',
    });
    const unknown = fixture();
    unknown.state.rows.push({ ...desired[0], id: 'topic-unknown' });
    await expect(unknown.execute('topic-plan')).rejects.toMatchObject({ gate: 'unavailable' });
  });
});
