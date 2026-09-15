import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  loadMigrations,
  migrationChecksum,
  migrationLockKeys,
  runMigrations,
} from '../src/migrate.mjs';
import {
  aiConfigMigrationPlan,
  requireAiConfigMigrationScope,
} from '../../../.github/scripts/production-maintenance.mjs';
import { inspectDatabasePreflight, runDatabasePreflight } from '../src/preflight.mjs';
import { expectedTableNames, verifyDatabaseContract } from '../src/verify.mjs';
import { syncSearchDocuments } from '../src/search-sync.mjs';
import {
  databaseSearchQuery,
  databaseSearchValues,
  mapDatabaseSearchRows,
  prepareDatabaseSearchInput,
} from '../../search/src/database.js';
import { normalizeSearchText, rankSearchDocuments } from '../../search/src/ranking.js';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integrationSuite = adminUrl ? describe.sequential : describe.skip;
const runSuffix = `${process.pid}_${Date.now()}`;
const migrationRole = `hzense_migrator_${runSuffix}`;
const inheritedRole = `hzense_parent_${runSuffix}`;
const migrationPassword = 'hzense-migration-test-only';
const databaseNames = {
  fresh: `hzense_migration_fresh_${runSuffix}`,
  legacy: `hzense_migration_legacy_${runSuffix}`,
  missingEdge: `hzense_migration_missing_${runSuffix}`,
  rollback: `hzense_migration_rollback_${runSuffix}`,
  artifact: `hzense_migration_artifact_${runSuffix}`,
};

function quotedDatabaseName(name) {
  if (!/^hzense_migration_[a-z]+_[0-9_]+$/.test(name)) {
    throw new Error(`Unsafe migration-test database name: ${name}`);
  }
  return `"${name}"`;
}

function quotedRoleName(name) {
  if (!/^hzense_(?:migrator|parent)_[0-9_]+$/.test(name)) {
    throw new Error(`Unsafe migration-test role name: ${name}`);
  }
  return `"${name}"`;
}

function adminDatabaseUrl(databaseName) {
  if (!adminUrl) throw new Error('MIGRATION_TEST_ADMIN_URL is required');
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function connectionUrl(databaseName) {
  const url = new URL(adminDatabaseUrl(databaseName));
  url.username = migrationRole;
  url.password = migrationPassword;
  return url.toString();
}

function productionLikeOptions(databaseName) {
  return {
    connectionString: connectionUrl(databaseName),
    profile: 'local-test',
    expectedDatabase: databaseName,
    expectedUser: migrationRole,
    expectedPgvectorVersion: '0.8.6',
    expectedPostgresMajor: 18,
  };
}

async function runGuardedMigrations(databaseName) {
  const options = productionLikeOptions(databaseName);
  return runMigrations({
    connectionString: options.connectionString,
    beforeMigrate: (client) => inspectDatabasePreflight(client, options),
  });
}

async function withClient(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function applyFoundation(connectionString) {
  const foundationSql = await readFile(
    resolve(process.cwd(), '../../db/migrations/0000_foundation.sql'),
    'utf8',
  );
  await withClient(connectionString, (client) => client.query(foundationSql));
}

async function foundationChecksum() {
  const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
  const foundation = migrations.find((migration) => migration.name === '0000_foundation.sql');
  if (!foundation) throw new Error('0000_foundation.sql is missing');
  return foundation.checksum;
}

async function seedEventIdentityFixture(client) {
  await client.query(`
    INSERT INTO sources(id,name,type,trust_score,allowed_hosts)
      VALUES ('event-identity-source','Fixture source','website',80,ARRAY['example.com']);
    INSERT INTO signals(id,title,type,occurred_at,captured_at,source_id,source_url,
      summary,importance,strength,confidence,novelty)
      SELECT id,'Fixture event','research','2026-01-01T00:00:00Z','2026-09-13T00:00:00Z',
        'event-identity-source','https://example.com/event','Fixture summary',3,3,0.8,0.6
      FROM unnest(ARRAY['event-identity-one','event-identity-two']) AS id;
    INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,
      date_basis,captured_at,summary,importance,strength,confidence,novelty,
      revision_reason,origin,content_hash)
      SELECT signal_id,version,'Fixture event','research','2026-01-01T00:00:00Z','day',
        'Fixture date','2026-09-13T00:00:00Z','Fixture summary',3,3,0.8,0.6,
        'Fixture revision','manual',repeat('d',64)
      FROM (VALUES ('event-identity-one',1),('event-identity-one',2),('event-identity-two',1)) AS input(signal_id,version);
    INSERT INTO public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at)
      SELECT id,'event-identity-source','https://example.com/event','paragraph 1',
        'Fixture original excerpt',repeat('e',64),'2026-09-13T00:00:00Z'
      FROM unnest(ARRAY['event-identity-evidence-one','event-identity-evidence-two']) AS id;
    INSERT INTO signal_version_evidence(signal_id,version,evidence_id,claim,relation) VALUES
      ('event-identity-one',1,'event-identity-evidence-one','Fixture claim','supports'),
      ('event-identity-one',2,'event-identity-evidence-two','Updated claim','supports'),
      ('event-identity-two',1,'event-identity-evidence-two','Other event claim','supports');
  `);
}

integrationSuite('PostgreSQL migration integration', () => {
  let adminClient;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(
      `CREATE ROLE ${quotedRoleName(migrationRole)}
       LOGIN PASSWORD '${migrationPassword}'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await adminClient.query(
      `CREATE ROLE ${quotedRoleName(inheritedRole)}
       NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    for (const name of Object.values(databaseNames)) {
      await adminClient.query(
        `CREATE DATABASE ${quotedDatabaseName(name)} OWNER ${quotedRoleName(migrationRole)}`,
      );
      await withClient(adminDatabaseUrl(name), (client) =>
        client.query(`
          CREATE EXTENSION vector;
          REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        `),
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (!adminClient) return;
    for (const name of Object.values(databaseNames)) {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName(name)}`);
    }
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedRoleName(migrationRole)}`);
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedRoleName(inheritedRole)}`);
    await adminClient.end();
  }, 30_000);

  it('binds AI risk approval to the immutable SQL snapshot actually executed, not restored files', async () => {
    const databaseUrl = connectionUrl(databaseNames.artifact);
    const currentMigrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
    const migrations = currentMigrations.filter(({ name }) => name < '0014_');
    const pending = migrations.slice(4).map(({ name }) => name);
    const approval = aiConfigMigrationPlan(pending, migrations);
    await withClient(databaseUrl, async (client) => {
      await client.query(`CREATE TABLE hzense_schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL CHECK (length(checksum)=64),
        applied_at timestamptz NOT NULL DEFAULT now())`);
      for (const migration of migrations.slice(0, 4)) {
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO hzense_schema_migrations(name,checksum) VALUES ($1,$2)', [
            migration.name,
            migration.checksum,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    });
    const directory = await mkdtemp(join(tmpdir(), 'hzense-ai-approved-artifact-'));
    const manifestPath = join(directory, 'checksums.json');
    const last = migrations.at(-1);
    const unapprovedSql = `${last.sql}\n-- synthetic unapproved artifact, never run\n`;
    const manifest = Object.fromEntries(migrations.map(({ name, checksum }) => [name, checksum]));
    try {
      await Promise.all(
        migrations.map(({ name, sql }) =>
          writeFile(join(directory, name), name === last.name ? unapprovedSql : sql),
        ),
      );
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, [last.name]: migrationChecksum(unapprovedSql) }),
      );
      let checkedActualArtifact = false;
      await expect(
        runMigrations({
          connectionString: databaseUrl,
          directory,
          manifestPath,
          beforeMigrate: async (client) => {
            // Simulate files being restored AFTER the runner has loaded its SQL.
            await writeFile(join(directory, last.name), last.sql);
            await writeFile(manifestPath, JSON.stringify(manifest));
            const preflight = await inspectDatabasePreflight(
              client,
              productionLikeOptions(databaseNames.artifact),
            );
            // Today's full artifact must not reuse the old AI-only approval.
            expect(() =>
              requireAiConfigMigrationScope(preflight, currentMigrations, approval),
            ).toThrow('ai-config-migration-manifest-required');
            expect(
              requireAiConfigMigrationScope(
                { ...preflight, pendingMigrations: pending },
                await loadMigrations(directory),
                approval,
              ),
            ).toEqual(approval);
          },
          beforeApply: (actualPending, artifact) => {
            checkedActualArtifact = true;
            expect(Object.isFrozen(artifact)).toBe(true);
            expect(Object.isFrozen(artifact.migrations)).toBe(true);
            expect(artifact.migrations.every(Object.isFrozen)).toBe(true);
            expect(artifact.migrations.at(-1).sql).toBe(unapprovedSql);
            expect(() => {
              artifact.migrations.at(-1).sql = last.sql;
            }).toThrow(TypeError);
            requireAiConfigMigrationScope(
              { pendingMigrations: actualPending },
              artifact.migrations,
              approval,
            );
          },
        }),
      ).rejects.toThrow('ai-config-migration-manifest-required');
      expect(checkedActualArtifact).toBe(true);
      await withClient(databaseUrl, async (client) => {
        expect(
          (await client.query('SELECT count(*)::int AS count FROM hzense_schema_migrations'))
            .rows[0].count,
        ).toBe(4);
        expect(
          (await client.query("SELECT to_regclass('public.signal_versions') AS relation")).rows[0]
            .relation,
        ).toBeNull();
      });
      await runMigrations({
        connectionString: databaseUrl,
        directory,
        manifestPath,
        beforeMigrate: (client) =>
          inspectDatabasePreflight(client, productionLikeOptions(databaseNames.artifact)),
        beforeApply: (actualPending, artifact) => {
          expect(artifact.migrations).toEqual(migrations);
          requireAiConfigMigrationScope(
            { pendingMigrations: actualPending },
            artifact.migrations,
            approval,
          );
          // Legacy first hook argument remains an isolated copy, not the plan.
          actualPending.length = 0;
        },
      });
      // Complete the separately scoped local fixture before the moving full-schema verifier.
      await runGuardedMigrations(databaseNames.artifact);
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.artifact)),
      ).resolves.toMatchObject({ migrationCount: currentMigrations.length });
      await withClient(databaseUrl, async (client) => {
        expect(
          (await client.query('SELECT publication_enabled FROM signal_publication_control')).rows,
        ).toEqual([{ publication_enabled: false }]);
        expect(
          (await client.query('SELECT count(*)::int AS count FROM ai_connections')).rows[0].count,
        ).toBe(0);
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('migrates a fresh pgvector database and reruns idempotently', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
    await expect(
      runDatabasePreflight(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toMatchObject({
      pendingMigrations: migrations.map(({ name }) => name),
      pgvectorVersion: '0.8.6',
    });

    // The final plan guard runs under the migration lock, before migration SQL.
    // A rejected plan must leave the ledger empty and release the lock for retry.
    await expect(
      runMigrations({
        connectionString: databaseUrl,
        beforeApply: (pending) => {
          expect(pending).toContain('0000_foundation.sql');
          throw new Error('test-only-unapproved-plan');
        },
      }),
    ).rejects.toThrow('test-only-unapproved-plan');
    await withClient(databaseUrl, async (client) => {
      expect((await client.query('SELECT name FROM hzense_schema_migrations')).rows).toEqual([]);
      expect(
        (await client.query("SELECT to_regclass('public.search_documents') AS relation")).rows[0]
          .relation,
      ).toBeNull();
    });
    await runGuardedMigrations(databaseNames.fresh);
    const firstHistory = await withClient(databaseUrl, (client) =>
      client.query('SELECT name, checksum, applied_at FROM hzense_schema_migrations ORDER BY name'),
    );
    await runGuardedMigrations(databaseNames.fresh);

    await withClient(databaseUrl, async (client) => {
      const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
      const history = await client.query(
        'SELECT name, checksum, applied_at FROM hzense_schema_migrations ORDER BY name',
      );
      expect(history.rows).toEqual(firstHistory.rows);
      expect(history.rows.map(({ name, checksum }) => ({ name, checksum }))).toEqual(
        migrations.map(({ name, checksum }) => ({ name, checksum })),
      );
      await expect(client.query('SELECT source_url FROM signals LIMIT 0')).resolves.toBeDefined();
      await expect(
        client.query('SELECT runtime_enabled FROM topics LIMIT 0'),
      ).resolves.toBeDefined();
      await expect(
        client.query('SELECT position FROM radar_snapshot_signals LIMIT 0'),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          'SELECT summary, href, keywords, normalized_title, search_vector FROM search_documents LIMIT 0',
        ),
      ).resolves.toBeDefined();

      const ownership = await client.query(
        `SELECT DISTINCT tableowner
         FROM pg_tables
         WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
        [[...expectedTableNames]],
      );
      expect(ownership.rows).toEqual([{ tableowner: migrationRole }]);
      const vectorOwner = await client.query(
        "SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname = 'vector'",
      );
      expect(vectorOwner.rows[0].owner).not.toBe(migrationRole);
    });
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toMatchObject({
      migrationCount: migrations.length,
      tableCount: expectedTableNames.size,
    });
  }, 30_000);

  it('stores private v3 snapshots with typed people and same-version evidence', async () => {
    await withClient(connectionUrl(databaseNames.fresh), async (client) => {
      await client.query('BEGIN');
      const rejected = async (sql, code) => {
        await client.query('SAVEPOINT invalid_v3_input');
        try {
          await expect(client.query(sql)).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT invalid_v3_input');
          await client.query('RELEASE SAVEPOINT invalid_v3_input');
        }
      };
      try {
        await client.query(`
          INSERT INTO entities(id, type, name) VALUES
            ('person-v3-fixture', 'person', 'Fixture Person'),
            ('company-v3-fixture', 'company', 'Fixture Organization');
          INSERT INTO person_profiles(entity_id) VALUES ('person-v3-fixture');
          INSERT INTO organization_profiles(entity_id, entity_type)
            VALUES ('company-v3-fixture', 'company');
          INSERT INTO sources(id, name, type, trust_score, allowed_hosts)
            VALUES ('source-v3-fixture', 'Test only', 'website', 80, ARRAY['example.com']);
          INSERT INTO signals(id, title, type, occurred_at, captured_at, source_id,
                              source_url, summary, importance, strength, confidence, novelty)
            SELECT id, 'Fixture event', 'research', '2026-01-01T00:00:00Z',
                   '2026-09-13T00:00:00Z', 'source-v3-fixture', 'https://example.com/event',
                   'Fixture summary', 3, 3, 0.8, 0.6
            FROM unnest(ARRAY['signal-v3-one','signal-v3-two']) AS id;
          INSERT INTO signal_versions(signal_id, version, title, type, occurred_at,
            date_precision, date_basis, captured_at, summary, importance, strength,
            confidence, novelty, revision_reason, origin, legacy_status, content_hash)
            SELECT signal_id, version, 'Fixture event', 'research', '2026-01-01T00:00:00Z',
              'day', 'Fixture event date', '2026-09-13T00:00:00Z', 'Fixture summary',
              3, 3, 0.8, 0.6, 'Fixture import', 'legacy_seed', 'accepted', repeat('a',64)
            FROM (VALUES ('signal-v3-one',1),('signal-v3-one',2),('signal-v3-two',1))
              AS input(signal_id,version);
          INSERT INTO public_source_evidence(id, source_id, source_url, locator,
              excerpt, content_hash, captured_at)
            SELECT id, 'source-v3-fixture', 'https://example.com/event', 'paragraph 1',
              'Fixture original excerpt', repeat('b',64), '2026-09-13T00:00:00Z'
            FROM unnest(ARRAY['evidence-v3-one','evidence-v3-two']) AS id;
          INSERT INTO signal_version_evidence(signal_id, version, evidence_id, claim, relation)
            SELECT 'signal-v3-one', 1, id, 'Fixture claim', 'supports'
            FROM unnest(ARRAY['evidence-v3-one','evidence-v3-two']) AS id;
          INSERT INTO signal_version_people(signal_id, version, person_id, evidence_id, event_role)
            SELECT 'signal-v3-one', 1, id, evidence_id, 'research_author'
            FROM (VALUES ('person-v3-fixture','evidence-v3-one'),
                         ('person-v3-fixture','evidence-v3-two')) AS input(id,evidence_id);
          INSERT INTO signal_version_organizations(signal_id, version, organization_id,
              evidence_id, event_role)
            VALUES ('signal-v3-one',1,'company-v3-fixture','evidence-v3-one','participant');
        `);
        expect(
          (await client.query('SELECT count(*)::integer AS count FROM signal_version_people'))
            .rows[0].count,
        ).toBe(2);
        expect(
          (
            await client.query(
              "SELECT verification_status FROM public_source_evidence WHERE id='evidence-v3-one'",
            )
          ).rows[0].verification_status,
        ).toBe('pending');
        await rejected(
          "INSERT INTO person_profiles(entity_id) VALUES ('company-v3-fixture')",
          '23503',
        );
        await rejected(
          "INSERT INTO organization_profiles(entity_id,entity_type) VALUES ('person-v3-fixture','person')",
          '23514',
        );
        await rejected("UPDATE entities SET type='company' WHERE id='person-v3-fixture'", '23503');
        for (const [signalId, version] of [
          ['signal-v3-two', 1],
          ['signal-v3-one', 2],
        ]) {
          await rejected(
            `INSERT INTO signal_version_people(signal_id,version,person_id,evidence_id,event_role)
            VALUES ('${signalId}',${version},'person-v3-fixture','evidence-v3-one','research_author')`,
            '23503',
          );
        }
        await rejected("DELETE FROM public_source_evidence WHERE id='evidence-v3-one'", '23503');
        await rejected(
          "UPDATE signal_versions SET version=0 WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE signal_versions SET content_hash='not-a-hash' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE signal_versions SET title='   ' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        for (const field of ['title', 'summary', 'analysis', 'date_basis', 'revision_reason']) {
          await rejected(
            `UPDATE signal_versions SET ${field}=chr(9)||chr(10) WHERE signal_id='signal-v3-two'`,
            '23514',
          );
        }
        await rejected(
          "UPDATE public_source_evidence SET excerpt=chr(9)||chr(10) WHERE id='evidence-v3-one'",
          '23514',
        );
        await rejected('UPDATE signal_version_evidence SET claim=chr(9)||chr(10)', '23514');
        await rejected('UPDATE signal_version_people SET event_role=chr(9)||chr(10)', '23514');
        await rejected(
          "UPDATE signal_versions SET origin='pipeline' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE signal_versions SET occurred_at='infinity' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE signal_versions SET occurred_at='2026-01-01T12:00:00Z' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE signal_versions SET confidence='NaN' WHERE signal_id='signal-v3-two'",
          '23514',
        );
        await rejected(
          "UPDATE public_source_evidence SET source_url='http://example.com' WHERE id='evidence-v3-one'",
          '23514',
        );
        await rejected(
          "UPDATE signal_version_organizations SET event_role='guessed_employer'",
          '23514',
        );
        // A new unrelated login must inherit no access from PUBLIC/default privileges.
        const access = await client.query(
          `SELECT bool_or(has_table_privilege($1, oid, 'SELECT,INSERT,UPDATE,DELETE')) AS allowed
          FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($2::text[])`,
          [
            inheritedRole,
            [
              'person_profiles',
              'organization_profiles',
              'public_source_evidence',
              'signal_versions',
              'signal_version_evidence',
              'signal_version_people',
              'signal_version_organizations',
              'signal_version_topics',
            ],
          ],
        );
        expect(access.rows[0].allowed).toBe(false);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }, 30_000);

  it('reserves unique canonical event keys with same-version evidence and no public access', async () => {
    await withClient(connectionUrl(databaseNames.fresh), async (client) => {
      await client.query('BEGIN');
      const rejected = async (sql, values, code) => {
        await client.query('SAVEPOINT invalid_event_identity');
        try {
          await expect(client.query(sql, values)).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT invalid_event_identity');
          await client.query('RELEASE SAVEPOINT invalid_event_identity');
        }
      };
      try {
        await seedEventIdentityFixture(client);
        await client.query(`INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
          VALUES ('event-identity-one','fixture-event-2026',1,'event-identity-evidence-one','Original evidence identifies this event')`);
        await rejected(
          `INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
          VALUES ('event-identity-two','fixture-event-2026',1,'event-identity-evidence-two','Same event candidate')`,
          [],
          '23505',
        );
        await rejected(
          `INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
          VALUES ('event-identity-one','another-event-key',1,'event-identity-evidence-one','Different key for same Signal')`,
          [],
          '23505',
        );
        for (const key of [
          '',
          ' ',
          'Fixture',
          'fixture_event',
          '-fixture',
          'fixture-',
          'fixture--event',
          '事件',
          'évent',
          'a'.repeat(201),
          'fixture\n',
          '\nfixture',
          'fixture\revent',
          'fixture\tevent',
        ]) {
          await rejected('UPDATE signal_event_identities SET event_key=$1', [key], '23514');
        }
        for (const key of ['a', '9', 'fixture-event-2026', 'a'.repeat(200)]) {
          await client.query('UPDATE signal_event_identities SET event_key=$1', [key]);
        }
        for (const version of [0, -1]) {
          await rejected('UPDATE signal_event_identities SET basis_version=$1', [version], '23514');
        }
        await rejected('UPDATE signal_event_identities SET basis_version=2', [], '23503');
        await rejected(
          "UPDATE signal_event_identities SET basis_evidence_id='event-identity-evidence-two'",
          [],
          '23503',
        );
        await rejected(
          "UPDATE signal_event_identities SET signal_id='event-identity-two'",
          [],
          '23503',
        );
        await rejected(
          "UPDATE signal_event_identities SET basis_evidence_id='missing-evidence'",
          [],
          '23503',
        );
        for (const field of ['signal_id', 'basis_evidence_id', 'identity_basis']) {
          for (const value of ['', ' ', '\t\n']) {
            await rejected(`UPDATE signal_event_identities SET ${field}=$1`, [value], '23514');
          }
        }
        for (const field of [
          'signal_id',
          'event_key',
          'basis_version',
          'basis_evidence_id',
          'identity_basis',
        ]) {
          await rejected(`UPDATE signal_event_identities SET ${field}=NULL`, [], '23502');
        }
        await rejected(
          "DELETE FROM signal_version_evidence WHERE signal_id='event-identity-one' AND version=1",
          [],
          '23503',
        );
        await rejected(
          "UPDATE signal_version_evidence SET evidence_id='event-identity-evidence-two' WHERE signal_id='event-identity-one' AND version=1",
          [],
          '23503',
        );
        await rejected(
          "DELETE FROM signal_versions WHERE signal_id='event-identity-one' AND version=1",
          [],
          '23503',
        );
        await rejected("DELETE FROM signals WHERE id='event-identity-one'", [], '23503');
        await rejected(
          "DELETE FROM public_source_evidence WHERE id='event-identity-evidence-one'",
          [],
          '23503',
        );
        const access = await client.query(
          "SELECT has_table_privilege($1, 'signal_event_identities', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS allowed",
          [inheritedRole],
        );
        expect(access.rows[0].allowed).toBe(false);
        await withClient(adminDatabaseUrl(databaseNames.fresh), async (reader) => {
          await reader.query(`SET ROLE ${quotedRoleName(inheritedRole)}`);
          try {
            await expect(
              reader.query('SELECT * FROM signal_event_identities'),
            ).rejects.toMatchObject({ code: '42501' });
          } finally {
            await reader.query('RESET ROLE');
          }
        });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }, 30_000);

  it('detects event-key regex grouping drift even when removing SQL parentheses would hide it', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    await withClient(databaseUrl, async (client) => {
      try {
        await client.query(`ALTER TABLE signal_event_identities
          DROP CONSTRAINT signal_event_identities_event_key_ck;
          ALTER TABLE signal_event_identities ADD CONSTRAINT signal_event_identities_event_key_ck
            CHECK(event_key COLLATE "C" ~ '^([a-z0-9]+-)([a-z0-9]+)*$');`);
        expect(
          (
            await client.query(
              `SELECT 'event-' COLLATE "C" ~ '^([a-z0-9]+-)([a-z0-9]+)*$' AS accepted`,
            )
          ).rows[0].accepted,
        ).toBe(true);
        await expect(
          verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
        ).rejects.toThrow('check constraint expression mismatch: signal_event_identities');
      } finally {
        await client.query(`ALTER TABLE signal_event_identities
          DROP CONSTRAINT signal_event_identities_event_key_ck;
          ALTER TABLE signal_event_identities ADD CONSTRAINT signal_event_identities_event_key_ck
            CHECK(event_key COLLATE "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');`);
      }
    });
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toMatchObject({ tableCount: expectedTableNames.size });
  }, 30_000);

  it('serializes concurrent event-key claims so only one Signal can reserve the key', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    let competing;
    try {
      await first.connect();
      await second.connect();
      await seedEventIdentityFixture(first);
      await first.query('BEGIN');
      await second.query('BEGIN');
      await second.query("SET LOCAL lock_timeout='10s'");
      const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await first.query(`INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
        VALUES ('event-identity-one','concurrent-fixture-event',1,'event-identity-evidence-one','First claimant')`);
      competing = second
        .query(
          `INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
        VALUES ('event-identity-two','concurrent-fixture-event',1,'event-identity-evidence-two','Competing claimant')`,
        )
        .then(
          () => ({ error: null }),
          (error) => ({ error }),
        );
      const blocked = await withClient(databaseUrl, async (observer) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const result = await observer.query(
            'SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked',
            [firstPid, secondPid],
          );
          if (result.rows[0].blocked) return true;
          await delay(25);
        }
        return false;
      });
      expect(blocked).toBe(true);
      await first.query('COMMIT');
      expect((await competing).error).toMatchObject({
        code: '23505',
        constraint: 'signal_event_identities_event_key_uq',
      });
      await second.query('ROLLBACK');
      expect(
        (
          await first.query(
            "SELECT signal_id FROM signal_event_identities WHERE event_key='concurrent-fixture-event'",
          )
        ).rows,
      ).toEqual([{ signal_id: 'event-identity-one' }]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await competing;
      await second.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
      // The committed winner and fixture snapshots are now sealed. Keep them
      // until afterAll drops this test-only database; never bypass the guards.
    }
  }, 30_000);

  it('stores directed affiliations, conservative date bounds and multiple evidence without public access', async () => {
    await withClient(connectionUrl(databaseNames.fresh), async (client) => {
      await client.query('BEGIN');
      const rejected = async (sql, code) => {
        await client.query('SAVEPOINT invalid_affiliation_input');
        try {
          await expect(client.query(sql)).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT invalid_affiliation_input');
          await client.query('RELEASE SAVEPOINT invalid_affiliation_input');
        }
      };
      try {
        await client.query(`
          INSERT INTO entities(id, type, name) VALUES
            ('aff-person', 'person', 'Fixture person'),
            ('aff-person-two', 'person', 'Another fixture person'),
            ('aff-org', 'company', 'Fixture organization'),
            ('aff-org-two', 'institution', 'Another fixture organization');
          INSERT INTO person_profiles(entity_id) VALUES ('aff-person'), ('aff-person-two');
          INSERT INTO organization_profiles(entity_id, entity_type)
            VALUES ('aff-org', 'company'), ('aff-org-two', 'institution');
          INSERT INTO relations(id, source_id, target_id, relation_type, valid_from, valid_to)
            VALUES ('aff-relation', 'aff-person', 'aff-org', 'works_at', '2026-01-01', '2026-01-01'),
              ('aff-repeat', 'aff-person', 'aff-org', 'works_at', NULL, NULL),
              ('aff-advice', 'aff-person', 'aff-org-two', 'advises', NULL, '2026-01-01'),
              ('aff-lead', 'aff-person', 'aff-org-two', 'leads', '2026-01-01', NULL);
          INSERT INTO person_organization_affiliations(relation_id, person_id, organization_id,
            relation_type, role_title, date_basis)
            SELECT id, source_id, target_id, relation_type, 'Fixture role', 'Dates stated by source'
            FROM relations WHERE id IN ('aff-relation', 'aff-repeat', 'aff-advice', 'aff-lead');
          INSERT INTO sources(id, name, type, trust_score, allowed_hosts)
            VALUES ('aff-source', 'Fixture source', 'website', 80, ARRAY['example.com']);
          INSERT INTO public_source_evidence(id, source_id, source_url, locator,
            excerpt, content_hash, captured_at)
            SELECT id, 'aff-source', 'https://example.com/affiliation', 'paragraph 1',
              'Fixture appointment excerpt', repeat('c', 64), '2026-09-13T00:00:00Z'
            FROM unnest(ARRAY['aff-evidence-one', 'aff-evidence-two']) AS id;
          INSERT INTO affiliation_evidence(relation_id, evidence_id, claim, relation)
            VALUES ('aff-relation', 'aff-evidence-one', 'Fixture appointment claim', 'supports'),
              ('aff-relation', 'aff-evidence-two', 'Fixture contrary claim', 'contradicts'),
              ('aff-repeat', 'aff-evidence-one', 'Fixture context', 'context');
        `);
        expect(
          (
            await client.query(
              'SELECT count(*)::integer AS count FROM person_organization_affiliations',
            )
          ).rows[0].count,
        ).toBe(4);
        expect(
          (await client.query('SELECT count(*)::integer AS count FROM affiliation_evidence'))
            .rows[0].count,
        ).toBe(3);
        for (const table of ['person_organization_affiliations', 'affiliation_evidence']) {
          expect(
            (await client.query(`SELECT DISTINCT verification_status FROM ${table}`)).rows,
          ).toEqual([{ verification_status: 'pending' }]);
          await rejected(`UPDATE ${table} SET verification_status='published'`, '23514');
        }
        for (const [from, to] of [
          ['0001-01-01', '9999-12-31'],
          ['2026-01-01', '2026-01-01'],
        ]) {
          await client.query('UPDATE relations SET valid_from=$1, valid_to=$2 WHERE id=$3', [
            from,
            to,
            'aff-relation',
          ]);
        }
        for (const field of ['valid_from', 'valid_to']) {
          for (const value of ['infinity', '-infinity', '0001-01-01 BC', '10000-01-01']) {
            await rejected(
              `UPDATE relations SET ${field}='${value}' WHERE id='aff-relation'`,
              '23514',
            );
          }
          await rejected(`UPDATE relations SET ${field}='NaN' WHERE id='aff-relation'`, '22007');
        }
        await rejected(
          "UPDATE relations SET valid_from='2026-01-02',valid_to='2026-01-01' WHERE id='aff-relation'",
          '23514',
        );
        for (const mutation of [
          "person_id='aff-person-two'",
          "organization_id='aff-org-two'",
          "person_id='aff-org',organization_id='aff-person'",
          "relation_id='missing-relation'",
          "relation_type='advises'",
        ]) {
          await rejected(
            `UPDATE person_organization_affiliations SET ${mutation} WHERE relation_id='aff-relation'`,
            '23503',
          );
        }
        for (const relationType of ['founded', 'invests_in']) {
          await rejected(
            `UPDATE person_organization_affiliations SET relation_type='${relationType}' WHERE relation_id='aff-relation'`,
            '23514',
          );
        }
        // Even a matching reversed legacy edge cannot bypass typed profile FKs.
        await client.query(
          "INSERT INTO relations(id,source_id,target_id,relation_type) VALUES ('aff-reversed','aff-org','aff-person','works_at')",
        );
        await rejected(
          "INSERT INTO person_organization_affiliations(relation_id,person_id,organization_id,relation_type,role_title,date_basis) VALUES ('aff-reversed','aff-org','aff-person','works_at','Fixture','Fixture')",
          '23503',
        );
        for (const mutation of [
          "id='changed'",
          "source_id='aff-person-two'",
          "target_id='aff-org-two'",
          "relation_type='advises'",
        ]) {
          await rejected(`UPDATE relations SET ${mutation} WHERE id='aff-relation'`, '23503');
        }
        await rejected(
          "UPDATE affiliation_evidence SET evidence_id='missing-evidence' WHERE evidence_id='aff-evidence-two'",
          '23503',
        );
        await rejected(
          "UPDATE affiliation_evidence SET relation_id='missing-affiliation' WHERE evidence_id='aff-evidence-two'",
          '23503',
        );
        for (const [table, predicate] of [
          ['relations', "id='aff-relation'"],
          ['person_profiles', "entity_id='aff-person'"],
          ['organization_profiles', "entity_id='aff-org'"],
          ['person_organization_affiliations', "relation_id='aff-relation'"],
          ['public_source_evidence', "id='aff-evidence-one'"],
        ]) {
          await rejected(`DELETE FROM ${table} WHERE ${predicate}`, '23503');
        }
        for (const [table, field] of [
          ['person_organization_affiliations', 'role_title'],
          ['person_organization_affiliations', 'date_basis'],
          ['affiliation_evidence', 'claim'],
        ]) {
          for (const blank of ["''", "'   '", 'chr(9)||chr(10)']) {
            await rejected(`UPDATE ${table} SET ${field}=${blank}`, '23514');
          }
        }
        await rejected("UPDATE affiliation_evidence SET relation='unverified'", '23514');
        await rejected(
          "INSERT INTO person_organization_affiliations SELECT * FROM person_organization_affiliations WHERE relation_id='aff-relation'",
          '23505',
        );
        await rejected(
          "INSERT INTO affiliation_evidence SELECT * FROM affiliation_evidence WHERE relation_id='aff-relation'",
          '23505',
        );
        const access = await client.query(
          `SELECT bool_or(has_table_privilege($1, oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) AS allowed
          FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($2::text[])`,
          [inheritedRole, ['person_organization_affiliations', 'affiliation_evidence']],
        );
        expect(access.rows[0].allowed).toBe(false);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }, 30_000);

  it('rejects invalid legacy relation dates before adding affiliations without repairing data', async () => {
    const migrationSql = await readFile(
      resolve(process.cwd(), '../../db/migrations/0005_person_organization_affiliations.sql'),
      'utf8',
    );
    await withClient(connectionUrl(databaseNames.fresh), async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`
          DROP TABLE affiliation_evidence;
          DROP TABLE person_organization_affiliations;
          DROP INDEX relations_identity_uq;
          ALTER TABLE relations DROP CONSTRAINT relations_valid_from_ck,
            DROP CONSTRAINT relations_valid_to_ck, DROP CONSTRAINT relations_valid_interval_ck;
          INSERT INTO entities(id,type,name) VALUES ('aff-legacy-person','person','Fixture'), ('aff-legacy-org','company','Fixture');
          INSERT INTO relations(id,source_id,target_id,relation_type,valid_from,valid_to)
            VALUES ('aff-legacy','aff-legacy-person','aff-legacy-org','founded','2026-02-01','2026-01-01');
        `);
        await client.query('SAVEPOINT legacy_affiliation_migration');
        await expect(client.query(migrationSql)).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT legacy_affiliation_migration');
        expect(
          (
            await client.query(
              "SELECT valid_from::text, valid_to::text FROM relations WHERE id='aff-legacy'",
            )
          ).rows,
        ).toEqual([{ valid_from: '2026-02-01', valid_to: '2026-01-01' }]);
        expect(
          (await client.query("SELECT to_regclass('person_organization_affiliations') AS relation"))
            .rows[0].relation,
        ).toBeNull();
      } finally {
        await client.query('ROLLBACK');
      }
    });
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toMatchObject({ tableCount: expectedTableNames.size });
  }, 30_000);

  it('rejects a migration login that can inherit or SET ROLE', async () => {
    await adminClient.query(
      `GRANT ${quotedRoleName(inheritedRole)} TO ${quotedRoleName(migrationRole)}`,
    );
    try {
      await expect(
        runDatabasePreflight(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/must not inherit or be able to SET ROLE/);
    } finally {
      await adminClient.query(
        `REVOKE ${quotedRoleName(inheritedRole)} FROM ${quotedRoleName(migrationRole)}`,
      );
    }
  }, 30_000);

  it('persists the FTS-1 projection and preserves the golden ranking contract in PostgreSQL', async () => {
    const golden = JSON.parse(
      await readFile(
        resolve(process.cwd(), '../search/test/fixtures/search-ranking-golden.json'),
        'utf8',
      ),
    );
    const rankingDocuments = golden.documents.map((document) => ({
      ...document,
      summary: document.summary || '∅',
    }));
    const desiredDocuments = rankingDocuments.map((document) => ({
      id: `searchdoc-${document.type}-${document.id}`,
      sourceId: document.id,
      sourceType: document.type,
      title: document.title,
      summary: document.summary,
      href: document.href,
      keywords: document.keywords,
      body: document.body,
      importance: 1,
      documentDate: document.date ?? null,
      topics: [],
      entities: [],
      normalizedTitle: normalizeSearchText(document.title),
      normalizedSummary: normalizeSearchText(document.summary),
      normalizedKeywords: normalizeSearchText(document.keywords),
      normalizedBody: normalizeSearchText(document.body),
    }));
    const databaseUrl = connectionUrl(databaseNames.fresh);
    await withClient(databaseUrl, async (client) => {
      const sync = await syncSearchDocuments(client, desiredDocuments, { dryRun: false });
      expect(sync).toMatchObject({
        committed: true,
        inserted: desiredDocuments.length,
        updated: 0,
        deleted: 0,
      });
      for (const goldenCase of golden.cases) {
        const input = prepareDatabaseSearchInput(goldenCase.query, goldenCase.type);
        const rows = await client.query(databaseSearchQuery, [...databaseSearchValues(input)]);
        expect(mapDatabaseSearchRows(rows.rows)).toEqual(
          rankSearchDocuments(rankingDocuments, goldenCase.query, goldenCase.type),
        );
      }
      const vectors = await client.query(
        "SELECT count(*)::integer AS count FROM search_documents WHERE search_vector <> ''::tsvector",
      );
      expect(vectors.rows[0].count).toBeGreaterThan(0);
    });
  }, 30_000);

  it('fails fast under migration lock contention without changing history', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    const holder = new Client({ connectionString: databaseUrl });
    await holder.connect();
    const historyBefore = await withClient(databaseUrl, (client) =>
      client.query('SELECT name, checksum, applied_at FROM hzense_schema_migrations ORDER BY name'),
    );
    try {
      await holder.query('SELECT pg_advisory_lock($1, $2)', migrationLockKeys);
      await expect(runMigrations({ connectionString: databaseUrl })).rejects.toThrow(
        /Another database migration process currently holds the lock/,
      );
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1, $2)', migrationLockKeys);
      await holder.end();
    }

    const historyAfter = await withClient(databaseUrl, (client) =>
      client.query('SELECT name, checksum, applied_at FROM hzense_schema_migrations ORDER BY name'),
    );
    expect(historyAfter.rows).toEqual(historyBefore.rows);
    await expect(runGuardedMigrations(databaseNames.fresh)).resolves.toBeUndefined();
  }, 30_000);

  it('detects semantic default and check-constraint drift without relying on names', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    const driftClient = new Client({ connectionString: databaseUrl });
    await driftClient.connect();
    const constraint = await driftClient.query(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = 'public.sources'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%trust_score%'`,
    );
    const originalName = constraint.rows[0]?.conname;
    if (typeof originalName !== 'string' || !/^[a-z0-9_]+$/.test(originalName)) {
      throw new Error('Could not resolve the trust-score constraint safely');
    }

    await driftClient.query(`
      ALTER TABLE sources DROP CONSTRAINT "${originalName}";
      ALTER TABLE sources ADD CONSTRAINT hzense_test_trust_score_ck CHECK (true);
      ALTER TABLE sources ALTER COLUMN active SET DEFAULT false;
    `);
    try {
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/default expression mismatch|check constraint expression mismatch/);
    } finally {
      await driftClient.query(`
        ALTER TABLE sources ALTER COLUMN active SET DEFAULT true;
        ALTER TABLE sources DROP CONSTRAINT hzense_test_trust_score_ck;
        ALTER TABLE sources ADD CHECK (trust_score BETWEEN 0 AND 100);
      `);
      await driftClient.end();
    }
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toBeDefined();
  }, 30_000);

  it('detects table durability, ownership, RLS, policy, trigger and rewrite-rule drift', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);
    const driftClient = new Client({ connectionString: databaseUrl });
    await driftClient.connect();
    try {
      await driftClient.query('ALTER TABLE content_registry SET UNLOGGED');
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/table persistence mismatch/);
      await driftClient.query('ALTER TABLE content_registry SET LOGGED');

      await withClient(adminDatabaseUrl(databaseNames.fresh), (client) =>
        client.query(`ALTER TABLE content_registry OWNER TO ${quotedRoleName(inheritedRole)}`),
      );
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/table owner mismatch/);
      await withClient(adminDatabaseUrl(databaseNames.fresh), (client) =>
        client.query(`ALTER TABLE content_registry OWNER TO ${quotedRoleName(migrationRole)}`),
      );

      await driftClient.query('ALTER TABLE content_registry ENABLE ROW LEVEL SECURITY');
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/unexpected row-level security/);
      await driftClient.query('ALTER TABLE content_registry DISABLE ROW LEVEL SECURITY');

      await driftClient.query('CREATE POLICY hzense_test_policy ON content_registry USING (true)');
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/unexpected row-level security policy/);
      await driftClient.query('DROP POLICY hzense_test_policy ON content_registry');

      await driftClient.query(`
        CREATE FUNCTION hzense_test_trigger() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER hzense_test_trigger
        BEFORE UPDATE ON content_registry
        FOR EACH ROW EXECUTE FUNCTION hzense_test_trigger();
      `);
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/unexpected user trigger/);
      await driftClient.query(`
        DROP TRIGGER hzense_test_trigger ON content_registry;
        DROP FUNCTION hzense_test_trigger();
      `);

      await driftClient.query(`
        CREATE RULE hzense_test_rewrite_rule AS
        ON UPDATE TO content_registry DO ALSO NOTHING
      `);
      await expect(
        verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
      ).rejects.toThrow(/unexpected rewrite rule/);
      await driftClient.query('DROP RULE hzense_test_rewrite_rule ON content_registry');
    } finally {
      await withClient(adminDatabaseUrl(databaseNames.fresh), (client) =>
        client.query(`ALTER TABLE content_registry OWNER TO ${quotedRoleName(migrationRole)}`),
      );
      await driftClient.query(`
        ALTER TABLE content_registry SET LOGGED;
        ALTER TABLE content_registry DISABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS hzense_test_policy ON content_registry;
        DROP TRIGGER IF EXISTS hzense_test_trigger ON content_registry;
        DROP FUNCTION IF EXISTS hzense_test_trigger();
        DROP RULE IF EXISTS hzense_test_rewrite_rule ON content_registry;
      `);
      await driftClient.end();
    }
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.fresh)),
    ).resolves.toBeDefined();
  }, 30_000);

  it('upgrades a populated 0000 database to the current evidence seed', async () => {
    const databaseUrl = connectionUrl(databaseNames.legacy);
    await applyFoundation(databaseUrl);

    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO topics (id, title, status) VALUES
          ('topic-foundation-models', 'Foundation Models', 'strategic'),
          ('topic-ai-security', 'AI Security', 'active'),
          ('topic-watching', 'Watching Topic', 'watching'),
          ('topic-archived', 'Archived Topic', 'archived');

        INSERT INTO sources (id, name, type, trust_score, active)
        VALUES ('source-anthropic', 'Anthropic', 'company_blog', 95, true);

        INSERT INTO signals (
          id, title, type, status, occurred_at, captured_at, source_id,
          summary, importance, strength, confidence, novelty
        ) VALUES
          (
            'signal-20240620-claude35', 'Anthropic announced Claude 3.5 Sonnet',
            'product', 'accepted', '2024-06-20T00:00:00Z', '2026-08-20T00:00:00Z',
            'source-anthropic', 'Legacy Claude seed', 4, 4, 1, 0.8
          ),
          (
            'signal-20241125-mcp', 'Anthropic introduced Model Context Protocol',
            'technology', 'accepted', '2024-11-25T00:00:00Z', '2026-08-20T00:00:00Z',
            'source-anthropic', 'Legacy MCP seed', 5, 5, 1, 0.9
          );

        INSERT INTO signal_topics (signal_id, topic_id) VALUES
          ('signal-20240620-claude35', 'topic-foundation-models'),
          ('signal-20241125-mcp', 'topic-ai-security');

        INSERT INTO radar_snapshots (
          id, topic_id, snapshot_date, attention, trend, maturity,
          strategic_value, confidence
        ) VALUES (
          'radar-20260827-ai-security', 'topic-ai-security', '2026-08-27',
          85, 'rapid_growth', 'emerging', 'high', 0.9
        );
      `),
    );

    const baselineChecksum = await foundationChecksum();
    await runMigrations({
      connectionString: databaseUrl,
      baselineChecksum,
    });
    await runMigrations({ connectionString: databaseUrl });

    await withClient(databaseUrl, async (client) => {
      const source = await client.query(
        "SELECT allowed_hosts FROM sources WHERE id = 'source-anthropic'",
      );
      expect(source.rows[0].allowed_hosts).toEqual(['anthropic.com']);

      const signal = await client.query(
        `SELECT source_url, occurred_at
         FROM signals WHERE id = 'signal-20240620-claude35'`,
      );
      expect(signal.rows[0].source_url).toBe('https://www.anthropic.com/news/claude-3-5-sonnet');
      expect(signal.rows[0].occurred_at.toISOString()).toBe('2024-06-21T00:00:00.000Z');

      const radar = await client.query(
        `SELECT domain, attention, trend, maturity, strategic_value, confidence, reasoning
         FROM radar_snapshots WHERE id = 'radar-20260827-ai-security'`,
      );
      expect(radar.rows[0]).toMatchObject({
        domain: 'security',
        attention: 55,
        trend: 'growth',
        maturity: 'emerging',
        strategic_value: 'medium',
        confidence: 0.4,
      });
      expect(radar.rows[0].reasoning.trim().length).toBeGreaterThan(0);

      const evidence = await client.query(
        `SELECT signal_id, position
         FROM radar_snapshot_signals
         WHERE snapshot_id = 'radar-20260827-ai-security'
         ORDER BY position`,
      );
      expect(evidence.rows).toEqual([{ signal_id: 'signal-20241125-mcp', position: 0 }]);

      const topicProjection = await client.query(
        `SELECT id, runtime_enabled
         FROM topics
         ORDER BY id`,
      );
      expect(topicProjection.rows).toEqual([
        { id: 'topic-ai-security', runtime_enabled: true },
        { id: 'topic-archived', runtime_enabled: false },
        { id: 'topic-foundation-models', runtime_enabled: true },
        { id: 'topic-watching', runtime_enabled: false },
      ]);
      await expect(
        client.query(
          `UPDATE topics
           SET status = 'archived', runtime_enabled = true
           WHERE id = 'topic-ai-security'`,
        ),
      ).rejects.toThrow(/topics_runtime_enabled_status_ck/);
    });
    await expect(
      verifyDatabaseContract(productionLikeOptions(databaseNames.legacy)),
    ).resolves.toBeDefined();
  }, 30_000);

  it('rolls back 0001 when legacy provenance cannot be backfilled', async () => {
    const databaseUrl = connectionUrl(databaseNames.rollback);
    await applyFoundation(databaseUrl);
    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO sources (id, name, type, trust_score, active)
        VALUES ('source-legacy-unknown', 'Unknown', 'website', 50, true)
      `),
    );

    await expect(
      runMigrations({
        connectionString: databaseUrl,
        baselineChecksum: await foundationChecksum(),
      }),
    ).rejects.toThrow(/unresolved source IDs: source-legacy-unknown/);

    await withClient(databaseUrl, async (client) => {
      const column = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'sources'
           AND column_name = 'allowed_hosts'`,
      );
      expect(column.rowCount).toBe(0);

      const radarDomain = await client.query("SELECT to_regtype('public.radar_domain') AS type");
      expect(radarDomain.rows[0].type).toBeNull();

      const history = await client.query('SELECT name FROM hzense_schema_migrations ORDER BY name');
      expect(history.rows).toEqual([{ name: '0000_foundation.sql' }]);
    });
  }, 30_000);

  it('rolls back when a legacy Radar snapshot is missing an expected evidence Signal', async () => {
    const databaseUrl = connectionUrl(databaseNames.missingEdge);
    await applyFoundation(databaseUrl);
    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO topics (id, title, status)
        VALUES ('topic-ai-security', 'AI Security', 'active');

        INSERT INTO radar_snapshots (
          id, topic_id, snapshot_date, attention, trend, maturity,
          strategic_value, confidence
        ) VALUES (
          'radar-20260827-ai-security', 'topic-ai-security', '2026-08-27',
          85, 'rapid_growth', 'emerging', 'high', 0.9
        );
      `),
    );

    await expect(
      runMigrations({
        connectionString: databaseUrl,
        baselineChecksum: await foundationChecksum(),
      }),
    ).rejects.toThrow(/could not persist every expected evidence edge/);

    await withClient(databaseUrl, async (client) => {
      const evidenceTable = await client.query(
        "SELECT to_regclass('public.radar_snapshot_signals') AS table_name",
      );
      expect(evidenceTable.rows[0].table_name).toBeNull();

      const history = await client.query('SELECT name FROM hzense_schema_migrations ORDER BY name');
      expect(history.rows).toEqual([{ name: '0000_foundation.sql' }]);
    });
  }, 30_000);
});
