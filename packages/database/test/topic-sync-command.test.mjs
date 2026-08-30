import console from 'node:console';
import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionApplyGuards,
  parseTopicSyncArguments,
  runTopicSyncCommand,
} from '../../../scripts/sync-topics.mjs';
import { topicProjectionFingerprint } from '../src/topic-sync.mjs';

const projectedTopics = [
  {
    id: 'topic-root',
    title: 'Root',
    parentId: null,
    status: 'watching',
    runtimeEnabled: false,
  },
];

function commandDependencies(results) {
  return {
    loadContent: vi.fn().mockResolvedValue([]),
    loadSeedCatalog: vi.fn().mockResolvedValue({ taxonomy: {}, topics: [] }),
    buildTopicDatabaseProjection: vi.fn().mockReturnValue(projectedTopics),
    inspectTopicSyncPreflight: vi.fn(),
    runTopicSync: vi.fn(async (options) => {
      results.push(options);
      return {
        mode: options.dryRun ? 'dry-run' : 'apply',
        committed: !options.dryRun,
        fingerprint: topicProjectionFingerprint(options.desiredTopics),
        planFingerprint: 'c'.repeat(64),
        desiredCount: options.desiredTopics.length,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        changedIds: ['topic-root'],
      };
    }),
  };
}

describe('Topic sync command safety contract', () => {
  it('requires an explicit profile and defaults to dry-run', () => {
    expect(parseTopicSyncArguments(['--profile=local-test'])).toEqual({
      profile: 'local-test',
      apply: false,
    });
    expect(parseTopicSyncArguments(['--profile=production', '--apply'])).toEqual({
      profile: 'production',
      apply: true,
    });

    expect(() => parseTopicSyncArguments([])).toThrow(/requires --profile/);
    expect(() => parseTopicSyncArguments(['--profile=staging'])).toThrow(/requires --profile/);
    expect(() => parseTopicSyncArguments(['--profile=production', '--force'])).toThrow(
      /Unknown Topic sync argument/,
    );
    expect(() => parseTopicSyncArguments(['--profile=production', '--profile=production'])).toThrow(
      /specified only once/,
    );
    expect(() => parseTopicSyncArguments(['--profile=production', '--apply', '--apply'])).toThrow(
      /specified only once/,
    );
  });

  it('wires local dry-run and apply modes to the same validated projection', async () => {
    const executions = [];
    const dependencies = commandDependencies(executions);
    const environment = {
      HZENSE_TOPIC_SYNC_DATABASE_URL: 'postgresql://hzense_sync:secret@127.0.0.1:5432/hzense',
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runTopicSyncCommand({
        arguments: ['--profile=local-test'],
        environment,
        dependencies,
      });
      await runTopicSyncCommand({
        arguments: ['--profile=local-test', '--apply'],
        environment,
        dependencies,
      });
    } finally {
      log.mockRestore();
    }

    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({ dryRun: true, desiredTopics: projectedTopics });
    expect(executions[1]).toMatchObject({ dryRun: false, desiredTopics: projectedTopics });
    expect(executions[0].expectedPlanFingerprint).toBeUndefined();
    expect(executions[1].expectedPlanFingerprint).toBeUndefined();
    expect(dependencies.loadContent).toHaveBeenCalledTimes(2);
  });

  it('passes both reviewed fingerprints into a guarded production apply', async () => {
    const executions = [];
    const dependencies = commandDependencies(executions);
    const projectionFingerprint = topicProjectionFingerprint(projectedTopics);
    const planFingerprint = 'd'.repeat(64);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runTopicSyncCommand({
        arguments: ['--profile=production', '--apply'],
        environment: {
          HZENSE_TOPIC_SYNC_DATABASE_URL:
            'postgresql://hzense_topic_sync:secret@ep-example.eu.neon.tech:5432/hzense?sslmode=verify-full',
          HZENSE_TOPIC_SYNC_EXPECTED_HOST: 'ep-example.eu.neon.tech',
          HZENSE_TOPIC_SYNC_EXPECTED_PORT: '5432',
          HZENSE_TOPIC_SYNC_EXPECTED_NAME: 'hzense',
          HZENSE_TOPIC_SYNC_EXPECTED_USER: 'hzense_topic_sync',
          HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: projectionFingerprint,
          HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT: planFingerprint,
          HZENSE_TOPIC_SYNC_BACKUP_ID: 'topic-sync-backup-20260830',
        },
        dependencies,
      });
    } finally {
      log.mockRestore();
    }

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      dryRun: false,
      expectedProjectionFingerprint: projectionFingerprint,
      expectedPlanFingerprint: planFingerprint,
      desiredTopics: projectedTopics,
    });
  });

  it('binds production apply to the reviewed fingerprint and a real backup identifier', () => {
    const fingerprint = 'a'.repeat(64);
    const planFingerprint = 'b'.repeat(64);
    expect(
      assertProductionApplyGuards(
        {
          HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: fingerprint,
          HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT: planFingerprint,
          HZENSE_TOPIC_SYNC_BACKUP_ID: 'topic-sync-2026-08-30T16:00:00Z',
        },
        fingerprint,
      ),
    ).toEqual({
      expectedProjectionFingerprint: fingerprint,
      expectedPlanFingerprint: planFingerprint,
      backupId: 'topic-sync-2026-08-30T16:00:00Z',
    });

    expect(() => assertProductionApplyGuards({}, fingerprint)).toThrow(
      /HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT is required/,
    );
    expect(() =>
      assertProductionApplyGuards(
        {
          HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: 'b'.repeat(64),
          HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT: planFingerprint,
          HZENSE_TOPIC_SYNC_BACKUP_ID: 'backup-id',
        },
        fingerprint,
      ),
    ).toThrow(/fingerprint mismatch/);
    expect(() =>
      assertProductionApplyGuards(
        {
          HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: fingerprint,
          HZENSE_TOPIC_SYNC_BACKUP_ID: 'backup-id',
        },
        fingerprint,
      ),
    ).toThrow(/HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT is required/);
    expect(() =>
      assertProductionApplyGuards(
        {
          HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT: fingerprint,
          HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT: planFingerprint,
          HZENSE_TOPIC_SYNC_BACKUP_ID: 'pending',
        },
        fingerprint,
      ),
    ).toThrow(/new recoverable pre-sync backup/);
  });
});
