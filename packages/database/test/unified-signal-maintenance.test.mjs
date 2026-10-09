import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { executeUnifiedSignalDryRun } from '../../../.github/scripts/unified-signal-maintenance.mjs';
import {
  publicMaintenanceFailure,
  publicMaintenanceResult,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';
import { loadMigrations } from '../src/migrate.mjs';

const currentMigrations = await loadMigrations();
// The completed cutover operation is deliberately frozen to its reviewed 0030
// artifact, not expanded whenever unrelated forward migrations are introduced.
const migrations = currentMigrations.filter(({ name }) => name < '0031_');
const policy = { host: 'fixture.invalid', port: '5432', database: 'fixture', user: 'owner' };
function fixture() {
  const clients = [];
  const queries = [];
  const summary = {
    status: 'preview_only',
    cutover_ready: false,
    source_counts: { legacy: 110, editorial_revisions: 7 },
    signals: 113,
    versions: 117,
    public_preview: 112,
    public_id_fingerprint: 'e'.repeat(64),
    lifecycle: { draft: 0, published: 112, withdrawn: 1 },
    existing_core: { signal_count: '0', version_count: '0' },
    source_fingerprint: 'a'.repeat(64),
    plan_hash: 'b'.repeat(64),
    blockers: ['unified_writer_not_implemented'],
  };
  const deps = {
    options: { connectionString: 'private-connection' },
    validateConnectionTarget: vi.fn(() => policy),
    loadMigrations: vi.fn(async () => migrations),
    verifyMigrationManifest: vi.fn(),
    inspectDatabasePreflight: vi.fn(async () => ({
      database: policy.database,
      user: policy.user,
      pendingMigrations: [],
    })),
    inspectUnifiedSignalMigration: vi.fn(async () => ({
      summary: globalThis.structuredClone(summary),
      plan: { private_source: 'never-log-owner-or-content' },
    })),
    createClient: vi.fn(() => {
      const client = Object.assign(new EventEmitter(), {
        connect: vi.fn(),
        end: vi.fn(async () => {}),
        query: vi.fn(async (sql) => {
          queries.push(sql);
          return { rows: [] };
        }),
      });
      clients.push(client);
      return client;
    }),
  };
  const context = { checkFreshness: vi.fn(async () => {}) };
  const execute = (operation = 'unified-signal-dry-run') =>
    executeUnifiedSignalDryRun({}, { operation }, context, deps);
  return { deps, clients, queries, summary, context, execute };
}

describe('hosted unified Signal read-only inventory', () => {
  it('requires hosted main dispatch, without reusing a write approval or backup', () => {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'd'.repeat(40),
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      MAINTENANCE_OPERATION: 'unified-signal-dry-run',
    };
    expect(validateMaintenanceRequest(env)).toEqual({ operation: 'unified-signal-dry-run' });
    expect(() =>
      validateMaintenanceRequest({ ...env, GITHUB_REF: 'refs/heads/feature' }),
    ).toThrow();
    expect(() => validateMaintenanceRequest({ ...env, GITHUB_ACTIONS: 'false' })).toThrow();
  });
  it('compares two closed independent sessions and emits only aggregates', async () => {
    const f = fixture();
    const result = await f.execute();
    expect(f.clients).toHaveLength(2);
    for (const client of f.clients) expect(client.end).toHaveBeenCalledOnce();
    expect(f.context.checkFreshness).toHaveBeenCalledTimes(4);
    expect(f.deps.inspectUnifiedSignalMigration).toHaveBeenCalledTimes(2);
    expect(f.queries.every((sql) => sql.startsWith('SET '))).toBe(true);
    expect(result).toMatchObject({
      previewOnly: true,
      cutoverReady: false,
      sourceLegacyCount: 110,
      sourceRevisionCount: 7,
      signalCount: 113,
      versionCount: 117,
      publicCount: 112,
      withdrawnCount: 1,
      existingSignalCount: 0,
      existingVersionCount: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|owner|fixture|never-log|blockers/);
    expect(result.targetFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('refuses an apply operation before opening a connection', async () => {
    const f = fixture();
    await expect(f.execute('unified-signal-apply')).rejects.toThrow('operation-required');
    expect(f.clients).toHaveLength(0);
  });
  it('refuses the post-retirement artifact rather than reusing an old cutover approval', async () => {
    const f = fixture();
    f.deps.loadMigrations.mockResolvedValue(currentMigrations);
    await expect(f.execute()).rejects.toThrow('reviewed-schema-required');
    expect(f.clients).toHaveLength(0);
  });
  it.each(['older', 'newer', 'tampered'])('refuses %s schema artifacts', async (mode) => {
    const f = fixture();
    const changed = globalThis.structuredClone(migrations);
    if (mode === 'older') changed.pop();
    if (mode === 'newer')
      changed.push({ name: '0030_future.sql', checksum: 'a'.repeat(64), sql: '' });
    if (mode === 'tampered') changed[0].sql += '\n';
    f.deps.loadMigrations.mockResolvedValue(changed);
    await expect(f.execute()).rejects.toThrow('reviewed-schema-required');
    expect(f.clients).toHaveLength(0);
  });
  it.each(['database', 'user', 'pending'])(
    'rejects wrong %s before reading business data',
    async (mode) => {
      const f = fixture();
      f.deps.inspectDatabasePreflight.mockResolvedValue({
        database: mode === 'database' ? 'other' : policy.database,
        user: mode === 'user' ? 'other' : policy.user,
        pendingMigrations: mode === 'pending' ? ['0029_unified_signal_storage.sql'] : [],
      });
      await expect(f.execute()).rejects.toThrow('applied-schema-required');
      expect(f.deps.inspectUnifiedSignalMigration).not.toHaveBeenCalled();
      expect(f.clients[0].end).toHaveBeenCalledOnce();
    },
  );
  it.each(['source_fingerprint', 'plan_hash', 'public_id_fingerprint', 'existing_core'])(
    'refuses changed %s between independent snapshots',
    async (key) => {
      const f = fixture();
      f.deps.inspectUnifiedSignalMigration
        .mockResolvedValueOnce({ summary: globalThis.structuredClone(f.summary) })
        .mockResolvedValueOnce({
          summary: {
            ...f.summary,
            [key]:
              key === 'existing_core' ? { signal_count: '1', version_count: '1' } : 'f'.repeat(64),
          },
        });
      await expect(f.execute()).rejects.toThrow('snapshot-changed');
      for (const client of f.clients) expect(client.end).toHaveBeenCalledOnce();
    },
  );
  it('fails if main freshness changes, closing the current session', async () => {
    const f = fixture();
    f.context.checkFreshness
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('main-changed'));
    await expect(f.execute()).rejects.toThrow('main-changed');
    expect(f.clients).toHaveLength(1);
    expect(f.clients[0].end).toHaveBeenCalledOnce();
  });
  it('fails on asynchronous connection errors and closes it', async () => {
    const f = fixture();
    f.deps.inspectUnifiedSignalMigration.mockImplementation(async () => {
      f.clients[0].emit('error', new Error('private-db-error'));
      return { summary: f.summary };
    });
    await expect(f.execute()).rejects.toThrow('connection-failed');
    expect(f.clients[0].end).toHaveBeenCalledOnce();
  });
  it('never prints private plans, names, errors or credentials through the shared reporter', async () => {
    const f = fixture();
    const result = publicMaintenanceResult('unified-signal-dry-run', {
      ...(await f.execute()),
      plan: { owner: 'secret' },
      sourceLegacyCount: 'secret',
      sourceFingerprint: 'private',
      previewOnly: false,
      cutoverReady: true,
    });
    expect(result).toMatchObject({ status: 'succeeded', previewOnly: true, cutoverReady: false });
    expect(JSON.stringify(result)).not.toMatch(/secret|private|owner/);
    const failure = publicMaintenanceFailure(new Error('private-server-and-source-content'));
    expect(failure).toEqual({ status: 'failed', category: 'database-or-contract-check-failed' });
  });
  it('keeps environment protection, no write approval/backup secret and no private plan artifact', async () => {
    const workflow = parse(
      await readFile(
        new URL('../../../.github/workflows/production-maintenance.yml', import.meta.url),
        'utf8',
      ),
    );
    const job = workflow.jobs.maintenance;
    expect(job.environment).toBe('production-maintenance');
    expect(workflow.on.workflow_dispatch.inputs.operation.options).toContain(
      'unified-signal-dry-run',
    );
    const step = job.steps.find((s) => s.id === 'maintenance');
    expect(step.env.MAINTENANCE_APPROVAL).not.toContain('unified-signal-dry-run');
    expect(step.env.MAINTENANCE_BACKUP_ID).not.toContain('unified-signal-dry-run');
    expect(job.steps.find((s) => s.id === 'archive').if).not.toContain('unified-signal');
  });
});
