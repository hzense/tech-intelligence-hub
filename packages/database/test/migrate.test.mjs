import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  loadMigrations,
  migrationChecksum,
  planPendingMigrations,
  shouldAdoptFoundation,
  verifyMigrationManifest,
} from '../src/migrate.mjs';

describe('database migration runner', () => {
  it('discovers the reviewed SQL migrations in deterministic order', async () => {
    const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));

    expect(migrations.map((migration) => migration.name)).toEqual([
      '0000_foundation.sql',
      '0001_radar_evidence.sql',
    ]);
    expect(migrations.every((migration) => migration.checksum.length === 64)).toBe(true);
    await expect(verifyMigrationManifest(migrations)).resolves.toBeUndefined();
  });

  it('rejects checksum drift and non-prefix migration history', () => {
    const migrations = [
      { name: '0000_foundation.sql', checksum: 'a', sql: 'first' },
      { name: '0001_radar_evidence.sql', checksum: 'b', sql: 'second' },
    ];

    expect(
      planPendingMigrations(migrations, [{ name: '0000_foundation.sql', checksum: 'a' }]).map(
        (migration) => migration.name,
      ),
    ).toEqual(['0001_radar_evidence.sql']);
    expect(() =>
      planPendingMigrations(migrations, [{ name: '0000_foundation.sql', checksum: 'changed' }]),
    ).toThrow(/Checksum mismatch/);
    expect(() =>
      planPendingMigrations(migrations, [{ name: '0001_radar_evidence.sql', checksum: 'b' }]),
    ).toThrow(/appears after an unapplied migration/);
  });

  it('rejects duplicate numeric migration prefixes', async () => {
    const duplicateDirectory = await mkdtemp(join(tmpdir(), 'hzense-migration-prefix-'));
    try {
      await Promise.all([
        writeFile(join(duplicateDirectory, '0002_first.sql'), 'select 1'),
        writeFile(join(duplicateDirectory, '0002_second.sql'), 'select 2'),
      ]);
      await expect(loadMigrations(duplicateDirectory)).rejects.toThrow(
        /Duplicate migration prefix 0002/,
      );
    } finally {
      await rm(duplicateDirectory, { recursive: true, force: true });
    }
  });

  it('requires the exact foundation checksum before adopting an untracked schema', () => {
    const foundation = {
      name: '0000_foundation.sql',
      checksum: 'known-checksum',
    };

    expect(shouldAdoptFoundation({ state: 'absent', problems: [] }, undefined, foundation)).toBe(
      false,
    );
    expect(() =>
      shouldAdoptFoundation({ state: 'complete', problems: [] }, undefined, foundation),
    ).toThrow(/untracked foundation schema/);
    expect(() =>
      shouldAdoptFoundation({ state: 'complete', problems: [] }, 'wrong-checksum', foundation),
    ).toThrow(/exact 0000_foundation.sql/);
    expect(
      shouldAdoptFoundation({ state: 'complete', problems: [] }, 'known-checksum', foundation),
    ).toBe(true);
  });

  it('uses the auditable SQL runner for pnpm db:migrate', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts['db:migrate']).toBe('node src/production-migrate.mjs');
    expect(packageJson.scripts['db:migrate:local']).toBe('node src/local-migrate.mjs');
    expect(packageJson.scripts['db:preflight:production']).toBe('node src/preflight.mjs');
    expect(packageJson.scripts['db:verify:production']).toContain('node src/verify.mjs');
    expect(packageJson.scripts['db:generate']).toBeUndefined();
    expect(packageJson.scripts['test:migrations']).toContain('require-integration-env.mjs');
    expect(migrationChecksum('select 1')).toBe(
      '822ae07d4783158bc1912bb623e5107cc9002d519e1143a9c200ed6ee18b6d0f',
    );
  });
});
