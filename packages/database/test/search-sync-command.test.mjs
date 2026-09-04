import console from 'node:console';
import { describe, expect, it, vi } from 'vitest';
import {
  parseSearchSyncArguments,
  runSearchSyncCommand,
} from '../../../scripts/sync-search-documents.mjs';
import { toDatabaseSearchDocuments } from '../../search/src/projection.ts';

const projectedDocuments = [
  {
    id: 'searchdoc-insight-example',
    sourceId: 'example',
    sourceType: 'insight',
    title: 'AI 安全',
    summary: '摘要',
    href: '/insights/example',
    keywords: 'ai 安全',
    body: '正文',
    importance: 4,
    documentDate: '2026-09-04',
    topics: ['topic-ai'],
    entities: ['entity-openai'],
  },
];

function commandDependencies(executions, inspection) {
  return {
    getSearchDocumentProjections: vi.fn().mockResolvedValue(projectedDocuments),
    toDatabaseSearchDocuments,
    inspectDatabasePreflight: vi.fn().mockResolvedValue(inspection),
    runSearchDocumentSync: vi.fn(async (options) => {
      executions.push(options);
      return {
        mode: options.dryRun ? 'dry-run' : 'apply',
        committed: !options.dryRun,
        fingerprint: 'a'.repeat(64),
        planFingerprint: 'b'.repeat(64),
        desiredCount: options.desiredDocuments.length,
        inserted: 1,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        changedIds: ['searchdoc-insight-example'],
      };
    }),
  };
}

describe('Search sync command safety contract', () => {
  it('requires an explicit profile and defaults to dry-run', () => {
    expect(parseSearchSyncArguments(['--profile=local-test'])).toEqual({
      profile: 'local-test',
      apply: false,
    });
    expect(parseSearchSyncArguments(['--profile=production', '--apply'])).toEqual({
      profile: 'production',
      apply: true,
    });
    expect(() => parseSearchSyncArguments([])).toThrow(/requires --profile/);
    expect(() => parseSearchSyncArguments(['--profile=staging'])).toThrow(/requires --profile/);
    expect(() => parseSearchSyncArguments(['--profile=production', '--force'])).toThrow(
      /Unknown Search sync argument/,
    );
  });

  it('passes a fully migrated local target through the preflight gate', async () => {
    const executions = [];
    const dependencies = commandDependencies(executions, { pendingMigrations: [] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runSearchSyncCommand({
        arguments: ['--profile=local-test'],
        environment: {
          HZENSE_SEARCH_SYNC_DATABASE_URL:
            'postgresql://hzense_migrator:secret@127.0.0.1:5432/hzense',
        },
        dependencies,
      });
    } finally {
      log.mockRestore();
    }

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ dryRun: true });
    expect(executions[0].desiredDocuments[0]).toMatchObject({
      id: 'searchdoc-insight-example',
      normalizedTitle: 'ai 安全',
    });
    await expect(executions[0].beforeSync({})).resolves.toEqual({ pendingMigrations: [] });
    expect(dependencies.inspectDatabasePreflight).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        expectedDatabase: 'hzense',
        expectedUser: 'hzense_migrator',
        profile: 'local-test',
      }),
    );
  });

  it('fails closed when database migrations are pending or cannot be determined', async () => {
    for (const inspection of [{ pendingMigrations: ['0003_search_documents_fts.sql'] }, {}]) {
      const executions = [];
      const dependencies = commandDependencies(executions, inspection);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await runSearchSyncCommand({
          arguments: ['--profile=local-test'],
          environment: {
            HZENSE_SEARCH_SYNC_DATABASE_URL:
              'postgresql://hzense_migrator:secret@127.0.0.1:5432/hzense',
          },
          dependencies,
        });
      } finally {
        log.mockRestore();
      }

      await expect(executions[0].beforeSync({})).rejects.toThrow(
        'Search sync requires a fully migrated and verified database',
      );
    }
  });
});
