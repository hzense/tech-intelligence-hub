import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { loadMigrations, runMigrations } from '../src/migrate.mjs';
import { collectSignalImmutabilityProblems } from '../src/signal-immutability-catalog.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const ownerRole = `hzense_sealed_owner_${suffix}`;
const ownerPassword = 'test-only-transaction-sealing';
const databases = {
  fresh: `hzense_sealed_fresh_${suffix}`,
  legacy: `hzense_sealed_legacy_${suffix}`,
};
const stampedTables = ['signal_versions', 'public_source_evidence', 'signal_event_identities'];
const edgeTables = [
  'signal_version_evidence',
  'signal_version_people',
  'signal_version_organizations',
  'signal_version_topics',
];

function identifier(value) {
  if (!/^hzense_sealed_[a-z_0-9]+$/.test(value)) throw new Error('Unsafe sealing-test identifier');
  return `"${value}"`;
}

function databaseUrl(name, asAdmin = false) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  if (!asAdmin) {
    url.username = ownerRole;
    url.password = ownerPassword;
  }
  return url.toString();
}

async function withClient(name, callback, asAdmin = false) {
  const client = new Client({ connectionString: databaseUrl(name, asAdmin) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function rejected(client, sql, code = '55000', values = [], message) {
  await client.query('SAVEPOINT rejected_sealed_write');
  try {
    await expect(client.query(sql, values)).rejects.toMatchObject({
      code,
      ...(message === undefined ? {} : { message }),
    });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rejected_sealed_write');
    await client.query('RELEASE SAVEPOINT rejected_sealed_write');
  }
}

async function seedRoots(client, prefix) {
  if (!/^[a-z]+$/.test(prefix)) throw new Error('Unsafe sealing fixture prefix');
  await client.query(`
    INSERT INTO topics(id,title) VALUES ('${prefix}-topic','Fixture topic');
    INSERT INTO entities(id,type,name) VALUES ('${prefix}-person','person','Fixture person'), ('${prefix}-org','company','Fixture organization');
    INSERT INTO person_profiles(entity_id) VALUES ('${prefix}-person');
    INSERT INTO organization_profiles(entity_id,entity_type) VALUES ('${prefix}-org','company');
    INSERT INTO sources(id,name,type,trust_score,allowed_hosts)
      VALUES ('${prefix}-source','Fixture source','website',80,ARRAY['example.com']);
    INSERT INTO signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty)
      VALUES ('${prefix}-signal','Fixture event','research','2026-01-01T00:00:00Z','2026-09-13T00:00:00Z',
        '${prefix}-source','https://example.com/event','Fixture summary',3,3,0.8,0.6);
  `);
}

async function seedSnapshot(client, prefix, version = 1, withIdentity = true) {
  if (!/^[a-z]+$/.test(prefix) || !Number.isSafeInteger(version) || version < 1)
    throw new Error('Unsafe sealing fixture');
  await client.query(`
    INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,
      importance,strength,confidence,novelty,revision_reason,origin,content_hash)
      VALUES ('${prefix}-signal',${version},'Fixture event','research','2026-01-01T00:00:00Z','day','Fixture event date',
        '2026-09-13T00:00:00Z','Fixture summary',3,3,0.8,0.6,'Fixture revision','manual',repeat('a',64));
    INSERT INTO public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at)
      VALUES ('${prefix}-evidence-${version}','${prefix}-source','https://example.com/event','paragraph 1','Fixture excerpt',repeat('b',64),'2026-09-13T00:00:00Z');
    INSERT INTO signal_version_evidence(signal_id,version,evidence_id,claim,relation)
      VALUES ('${prefix}-signal',${version},'${prefix}-evidence-${version}','Fixture claim','supports');
    INSERT INTO signal_version_people(signal_id,version,person_id,evidence_id,event_role)
      VALUES ('${prefix}-signal',${version},'${prefix}-person','${prefix}-evidence-${version}','research_author');
    INSERT INTO signal_version_organizations(signal_id,version,organization_id,evidence_id,event_role)
      VALUES ('${prefix}-signal',${version},'${prefix}-org','${prefix}-evidence-${version}','participant');
    INSERT INTO signal_version_topics(signal_id,version,topic_id)
      VALUES ('${prefix}-signal',${version},'${prefix}-topic');
  `);
  if (withIdentity) {
    await client.query(`INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
      VALUES ('${prefix}-signal','${prefix}-event',${version},'${prefix}-evidence-${version}','Fixture identity basis')`);
  }
}

async function seedCommitted(name, prefix, withIdentity = true) {
  await withClient(name, async (client) => {
    await client.query('BEGIN');
    try {
      await seedRoots(client, prefix);
      await seedSnapshot(client, prefix, 1, withIdentity);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function payloads(client) {
  const result = {};
  for (const table of stampedTables) {
    result[table] = (
      await client.query(
        `SELECT to_jsonb(item)-'created_xid' AS payload FROM ${table} AS item ORDER BY to_jsonb(item)::text`,
      )
    ).rows;
  }
  return result;
}

suite('Signal snapshot transaction sealing', () => {
  let admin;
  let legacyPayloads;
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${identifier(ownerRole)} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    for (const name of Object.values(databases)) {
      await admin.query(`CREATE DATABASE ${identifier(name)} OWNER ${identifier(ownerRole)}`);
      await withClient(
        name,
        (client) =>
          client.query('CREATE EXTENSION vector; REVOKE CREATE ON SCHEMA public FROM PUBLIC'),
        true,
      );
    }
    await runMigrations({ connectionString: databaseUrl(databases.fresh) });
    // Build an exact pre-0007 database including its ledger, then upgrade it
    // through the real runner. No new guard is disabled for legacy fixtures.
    const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
    await withClient(databases.legacy, async (client) => {
      await client.query(
        'CREATE TABLE hzense_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL CHECK(length(checksum)=64),applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const migration of migrations.filter(
        ({ name }) => name < '0007_signal_version_immutability.sql',
      )) {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO hzense_schema_migrations(name,checksum) VALUES ($1,$2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      }
    });
    await seedCommitted(databases.legacy, 'legacy');
    legacyPayloads = await withClient(databases.legacy, payloads);
    await runMigrations({ connectionString: databaseUrl(databases.legacy) });
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    for (const name of Object.values(databases)) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${identifier(name)}`);
    }
    await admin.query(`DROP ROLE IF EXISTS ${identifier(ownerRole)}`);
    await admin.end();
  }, 30_000);

  it('freezes pre-existing rows at the migration commit without changing their payloads', async () => {
    await withClient(databases.legacy, async (client) => {
      expect(await payloads(client)).toEqual(legacyPayloads);
      const stamps = await client.query(`SELECT created_xid::text AS stamp FROM signal_versions
        UNION SELECT created_xid::text FROM public_source_evidence
        UNION SELECT created_xid::text FROM signal_event_identities`);
      expect(stamps.rows).toHaveLength(1);
      await client.query('BEGIN');
      try {
        expect(stamps.rows[0].stamp).not.toBe(
          (await client.query('SELECT pg_current_xact_id()::text AS stamp')).rows[0].stamp,
        );
        await rejected(client, "UPDATE signal_versions SET title='Changed legacy event'");
        await rejected(
          client,
          "UPDATE public_source_evidence SET excerpt='Changed legacy excerpt'",
        );
        await rejected(
          client,
          "UPDATE signal_event_identities SET event_key='changed-legacy-event'",
        );
        for (const table of edgeTables) await rejected(client, `DELETE FROM ${table}`);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('allows complete assembly, edits and deletion inside the creating transaction', async () => {
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        await seedRoots(client, 'assembly');
        await seedSnapshot(client, 'assembly');
        await client.query(
          "UPDATE signal_versions SET title='Assembled event' WHERE signal_id='assembly-signal'",
        );
        await client.query(
          "UPDATE public_source_evidence SET excerpt='Assembled excerpt' WHERE id='assembly-evidence-1'",
        );
        await client.query(
          "UPDATE signal_event_identities SET event_key='assembled-event' WHERE signal_id='assembly-signal'",
        );
        for (const [table, field, value] of [
          ['signal_version_evidence', 'claim', 'Assembled claim'],
          ['signal_version_people', 'event_role', 'speaker'],
          ['signal_version_organizations', 'event_role', 'subject'],
        ])
          await client.query(`UPDATE ${table} SET ${field}=$1 WHERE signal_id='assembly-signal'`, [
            value,
          ]);
        await client.query("DELETE FROM signal_version_topics WHERE signal_id='assembly-signal'");
        await client.query(
          "INSERT INTO signal_version_topics VALUES ('assembly-signal',1,'assembly-topic')",
        );
        await client.query("DELETE FROM signal_event_identities WHERE signal_id='assembly-signal'");
        for (const table of [
          'signal_version_people',
          'signal_version_organizations',
          'signal_version_topics',
          'signal_version_evidence',
        ]) {
          await client.query(`DELETE FROM ${table} WHERE signal_id='assembly-signal'`);
        }
        await client.query("DELETE FROM signal_versions WHERE signal_id='assembly-signal'");
        await client.query("DELETE FROM public_source_evidence WHERE id='assembly-evidence-1'");
        expect(
          (
            await client.query(
              "SELECT count(*)::integer AS count FROM signal_versions WHERE signal_id='assembly-signal'",
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('uses the top-level transaction stamp across savepoints and freezes on commit', async () => {
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        await seedRoots(client, 'savepoint');
        const topStamp = (await client.query('SELECT pg_current_xact_id()::text AS stamp')).rows[0]
          .stamp;
        await client.query('SAVEPOINT before_assembly');
        await seedSnapshot(client, 'savepoint');
        expect(
          (
            await client.query(
              "SELECT created_xid::text AS stamp FROM signal_versions WHERE signal_id='savepoint-signal'",
            )
          ).rows[0].stamp,
        ).toBe(topStamp);
        await client.query('ROLLBACK TO SAVEPOINT before_assembly');
        await seedSnapshot(client, 'savepoint');
        await client.query('RELEASE SAVEPOINT before_assembly');
        await client.query(
          "UPDATE signal_versions SET title='After savepoint' WHERE signal_id='savepoint-signal'",
        );
        expect(
          (
            await client.query(
              "SELECT created_xid::text AS stamp FROM signal_event_identities WHERE signal_id='savepoint-signal'",
            )
          ).rows[0].stamp,
        ).toBe(topStamp);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      await client.query('BEGIN');
      try {
        await rejected(
          client,
          "UPDATE signal_versions SET title='After commit' WHERE signal_id='savepoint-signal'",
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('rejects post-commit payload changes, deletions and restamping while allowing only evidence verification updates', async () => {
    await seedCommitted(databases.fresh, 'sealed');
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        for (const [table, predicate] of [
          ['signal_versions', "signal_id='sealed-signal'"],
          ['public_source_evidence', "id='sealed-evidence-1'"],
          ['signal_event_identities', "signal_id='sealed-signal'"],
        ]) {
          await rejected(
            client,
            `UPDATE ${table} SET created_xid=pg_current_xact_id() WHERE ${predicate}`,
          );
          await rejected(client, `UPDATE ${table} SET created_xid=NULL WHERE ${predicate}`);
          await rejected(client, `DELETE FROM ${table} WHERE ${predicate}`);
        }
        await rejected(
          client,
          "UPDATE signal_versions SET title=title WHERE signal_id='sealed-signal'",
        );
        await rejected(
          client,
          "UPDATE signal_event_identities SET identity_basis='Changed' WHERE signal_id='sealed-signal'",
        );
        for (const [field, value] of [
          ['excerpt', 'Changed'],
          ['content_hash', 'c'.repeat(64)],
          ['source_url', 'https://example.com/other'],
          ['locator', 'paragraph 2'],
        ]) {
          await rejected(
            client,
            `UPDATE public_source_evidence SET ${field}=$1,verification_status='verified' WHERE id='sealed-evidence-1'`,
            '55000',
            [value],
          );
        }
        await client.query(
          "UPDATE public_source_evidence SET verification_status='verified' WHERE id='sealed-evidence-1'",
        );
        await client.query(
          "UPDATE public_source_evidence SET verification_status='rejected' WHERE id='sealed-evidence-1'",
        );
        expect(
          (
            await client.query(
              "SELECT verification_status FROM public_source_evidence WHERE id='sealed-evidence-1'",
            )
          ).rows[0].verification_status,
        ).toBe('rejected');
        for (const table of edgeTables) {
          await rejected(client, `DELETE FROM ${table} WHERE signal_id='sealed-signal'`);
          await rejected(
            client,
            `UPDATE ${table} SET version=version WHERE signal_id='sealed-signal'`,
          );
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('rejects fabricated creation stamps and changes to even an open snapshot stamp', async () => {
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        await seedRoots(client, 'stamp');
        await seedSnapshot(client, 'stamp');
        for (const table of stampedTables) {
          await rejected(
            client,
            `UPDATE ${table} SET created_xid='1'::xid8 WHERE created_xid=pg_current_xact_id()`,
          );
          await rejected(
            client,
            `INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table},to_jsonb(item)||jsonb_build_object('created_xid','1'))).* FROM ${table} AS item WHERE created_xid=pg_current_xact_id()`,
          );
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('checks old and new edge parents and refuses late inserts from another transaction', async () => {
    await seedCommitted(databases.fresh, 'movement');
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        await seedSnapshot(client, 'movement', 2, false);
        for (const table of edgeTables) {
          await rejected(
            client,
            `UPDATE ${table} SET version=2 WHERE signal_id='movement-signal' AND version=1`,
          );
          await rejected(
            client,
            `UPDATE ${table} SET version=1 WHERE signal_id='movement-signal' AND version=2`,
          );
          await rejected(
            client,
            `INSERT INTO ${table} SELECT * FROM ${table} WHERE signal_id='movement-signal' AND version=1`,
          );
        }
        // An edge may still be organized between two versions created by this
        // same transaction, subject to its ordinary exact-version foreign keys.
        await client.query(`INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
          SELECT signal_id,3,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash
          FROM signal_versions WHERE signal_id='movement-signal' AND version=2`);
        await client.query(
          "UPDATE signal_version_topics SET version=3 WHERE signal_id='movement-signal' AND version=2",
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('allows a first canonical identity for an existing sealed version but seals that identity at its own commit', async () => {
    await seedCommitted(databases.fresh, 'lateidentity', false);
    await withClient(databases.fresh, async (client) => {
      await client.query(`INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
        VALUES ('lateidentity-signal','late-identity-event',1,'lateidentity-evidence-1','Reviewed identity basis')`);
      await client.query('BEGIN');
      try {
        await rejected(
          client,
          "UPDATE signal_event_identities SET event_key='changed-identity' WHERE signal_id='lateidentity-signal'",
        );
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('blocks TRUNCATE and keeps every guard active in replica session mode', async () => {
    await withClient(databases.fresh, async (client) => {
      await client.query('BEGIN');
      try {
        for (const table of [...stampedTables, ...edgeTables])
          await rejected(client, `TRUNCATE ${table} CASCADE`);
      } finally {
        await client.query('ROLLBACK');
      }
    });
    await withClient(
      databases.fresh,
      async (client) => {
        await client.query('BEGIN');
        try {
          await client.query("SET LOCAL session_replication_role='replica'");
          await rejected(
            client,
            "UPDATE signal_versions SET title='Replica bypass' WHERE signal_id='sealed-signal'",
          );
          await rejected(
            client,
            "INSERT INTO signal_version_topics SELECT * FROM signal_version_topics WHERE signal_id='sealed-signal'",
          );
          // 0008 references identities from the Outbox: RESTRICT now fails
          // before BEFORE TRUNCATE triggers, even in replica mode. Include the
          // FK closure so this test actually reaches the original ALWAYS guard.
          await rejected(client, 'TRUNCATE public.signal_event_identities', '0A000');
          await rejected(
            client,
            'TRUNCATE public.signal_event_identities CASCADE',
            '55000',
            [],
            'Sealed snapshot tables cannot be truncated',
          );
        } finally {
          await client.query('ROLLBACK');
        }
      },
      true,
    );
  });

  for (const [isolation, prefix] of [
    ['READ COMMITTED', 'readcommitted'],
    ['REPEATABLE READ', 'repeatableread'],
  ]) {
    it(`rejects a late edge from a different connection under ${isolation}`, async () => {
      const creator = new Client({ connectionString: databaseUrl(databases.fresh) });
      const lateWriter = new Client({ connectionString: databaseUrl(databases.fresh) });
      try {
        await creator.connect();
        await lateWriter.connect();
        const creatorPid = (await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const lateWriterPid = (await lateWriter.query('SELECT pg_backend_pid() AS pid')).rows[0]
          .pid;
        expect(lateWriterPid).not.toBe(creatorPid);
        await creator.query('BEGIN');
        await seedRoots(creator, prefix);
        await seedSnapshot(creator, prefix);
        const creatorStamp = (await creator.query('SELECT pg_current_xact_id()::text AS stamp'))
          .rows[0].stamp;
        await creator.query('COMMIT');
        await lateWriter.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        expect(
          (await lateWriter.query('SHOW transaction_isolation')).rows[0].transaction_isolation,
        ).toBe(isolation.toLowerCase());
        const lateStamp = (await lateWriter.query('SELECT pg_current_xact_id()::text AS stamp'))
          .rows[0].stamp;
        expect(lateStamp).not.toBe(creatorStamp);
        expect(
          (
            await lateWriter.query(
              'SELECT created_xid::text AS stamp FROM signal_versions WHERE signal_id=$1',
              [`${prefix}-signal`],
            )
          ).rows[0].stamp,
        ).toBe(creatorStamp);
        for (const table of edgeTables) {
          await rejected(
            lateWriter,
            `INSERT INTO ${table} SELECT * FROM ${table} WHERE signal_id=$1`,
            '55000',
            [`${prefix}-signal`],
          );
        }
      } finally {
        await creator.query('ROLLBACK').catch(() => undefined);
        await lateWriter.query('ROLLBACK').catch(() => undefined);
        await Promise.all([creator.end(), lateWriter.end()]);
      }
    });
  }

  const catalogMutations = [
    [
      'function body',
      `CREATE OR REPLACE FUNCTION public.hzense_guard_sealed_row() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$ BEGIN RETURN NEW; END $$`,
      /function contract mismatch/,
    ],
    ['function literal', null, /function contract mismatch/],
    [
      'security definer',
      'ALTER FUNCTION public.hzense_guard_sealed_row() SECURITY DEFINER',
      /function contract mismatch/,
    ],
    [
      'function search path',
      'ALTER FUNCTION public.hzense_guard_sealed_row() SET search_path=public,pg_catalog',
      /function contract mismatch/,
    ],
    [
      'origin-only trigger',
      'ALTER TABLE signal_versions ENABLE TRIGGER signal_versions_sealed_row_trg',
      /trigger contract mismatch/,
    ],
    [
      'disabled trigger',
      'ALTER TABLE signal_versions DISABLE TRIGGER signal_versions_sealed_row_trg',
      /trigger contract mismatch/,
    ],
    [
      'conditional trigger',
      `DROP TRIGGER signal_versions_sealed_row_trg ON signal_versions;
      CREATE TRIGGER signal_versions_sealed_row_trg BEFORE INSERT OR UPDATE OR DELETE ON signal_versions
        FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.hzense_guard_sealed_row();
      ALTER TABLE signal_versions ENABLE ALWAYS TRIGGER signal_versions_sealed_row_trg`,
      /trigger contract mismatch/,
    ],
    [
      'column-only update trigger',
      `DROP TRIGGER signal_versions_sealed_row_trg ON signal_versions;
      CREATE TRIGGER signal_versions_sealed_row_trg BEFORE UPDATE OF title ON signal_versions
        FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_sealed_row();
      ALTER TABLE signal_versions ENABLE ALWAYS TRIGGER signal_versions_sealed_row_trg`,
      /trigger contract mismatch/,
    ],
    [
      'public function execution',
      'GRANT EXECUTE ON FUNCTION public.hzense_guard_sealed_row() TO PUBLIC',
      /function contract mismatch/,
    ],
    [
      'creation stamp default',
      "ALTER TABLE signal_versions ALTER COLUMN created_xid SET DEFAULT '1'::xid8",
      /creation transaction column mismatch/,
    ],
  ];
  for (const [label, mutation, expectedProblem] of catalogMutations) {
    it(`detects actual PostgreSQL catalog drift: ${label}`, async () => {
      await withClient(databases.fresh, async (client) => {
        expect(await collectSignalImmutabilityProblems(client, ownerRole)).toEqual([]);
        await client.query('BEGIN');
        try {
          let sql = mutation;
          if (label === 'function literal') {
            const definition = (
              await client.query(
                "SELECT pg_get_functiondef('public.hzense_guard_sealed_row()'::regprocedure) AS definition",
              )
            ).rows[0].definition;
            sql = definition.replace(
              'A snapshot is sealed after its creation transaction',
              'A snapshot is SEALED after its creation transaction',
            );
            expect(sql).not.toBe(definition);
          }
          await client.query(sql);
          const problems = await collectSignalImmutabilityProblems(client, ownerRole);
          expect(problems.some((problem) => expectedProblem.test(problem))).toBe(true);
        } finally {
          await client.query('ROLLBACK');
        }
        // Only the dedicated drift assertion runs against weakened DDL. Every
        // functional sealing test and the post-rollback check use intact guards.
        expect(await collectSignalImmutabilityProblems(client, ownerRole)).toEqual([]);
      });
    });
  }
});
