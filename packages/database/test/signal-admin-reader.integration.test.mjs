import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { verifyDatabaseContract } from '../src/verify.mjs';
import {
  signalWorkbenchReadColumns,
  verifySignalWorkbenchAccess,
} from '../src/signal-workbench-contract.mjs';
import { listSignalWorkbench, getSignalWorkbenchDetail } from '../src/signal-workbench-store.mjs';
import { recordPrivateSignalPublicationTransition } from '../src/signal-publication-store.mjs';
import {
  readPrivateCandidateVerificationMaterial,
  recordPrivateCandidateVerification,
  assemblePrivateVerifiedSignalCandidate,
} from '../src/signal-candidate-verification-store.mjs';
import { publishVerifiedSignal } from '../src/signal-publication-service-store.mjs';
import {
  createPrivatePublicationRun,
  claimPrivatePublicationRun,
} from '../src/signal-publication-control-store.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const database = `hzense_workbench_${suffix}`;
const ownerRole = `hzense_workbench_owner_${suffix}`;
const auxiliaryRole = `hzense_workbench_aux_${suffix}`;
const readerRole = 'hzense_signal_admin_reader';
const password = `synthetic-workbench-${suffix}`;
const quote = (value) => {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error('Unsafe fixture identifier');
  return `"${value}"`;
};
function urlFor(role) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.toString();
}
async function connect(role, callback) {
  const client = new pg.Client({ connectionString: urlFor(role) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}
const owner = (callback) => connect(ownerRole, callback);
const admin = (callback) => connect(undefined, callback);

suite('Signal administrator has exact read-only PostgreSQL privileges', () => {
  let administrator;
  let reader;
  let ownerPool;
  let createdDatabase = false;
  const roles = [];
  const restoredDatabases = [];
  let roleSql;

  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable isolated PostgreSQL cluster required');
    administrator = new pg.Client({ connectionString: adminUrl });
    await administrator.connect();
    const publicGrants = (
      await administrator.query(`SELECT d.datname AS name,array_agg(a.privilege_type ORDER BY a.privilege_type) AS privileges
      FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
      WHERE d.datallowconn AND a.grantee=0 GROUP BY d.datname ORDER BY d.datname`)
    ).rows;
    for (const row of publicGrants) {
      if (!['postgres', 'template1'].includes(row.name))
        throw new Error('Refuse to modify unrelated database ACLs');
      if (row.privileges.some((value) => !['CONNECT', 'CREATE', 'TEMPORARY'].includes(value)))
        throw new Error('Unexpected PUBLIC privilege');
    }
    for (const row of publicGrants) {
      restoredDatabases.push(row);
      await administrator.query(
        `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(row.name)} FROM PUBLIC`,
      );
    }
    for (const role of [ownerRole, auxiliaryRole, readerRole]) {
      expect(
        (await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows,
      ).toEqual([]);
      await administrator.query(
        `CREATE ROLE ${quote(role)} LOGIN NOINHERIT CONNECTION LIMIT 2 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
      );
      roles.push(role);
    }
    await administrator.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(ownerRole)}`);
    createdDatabase = true;
    await admin((client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: urlFor(ownerRole) });
    roleSql = await readFile(
      new URL('../../../db/roles/configure_signal_admin_reader.sql', import.meta.url),
      'utf8',
    );
    await owner(async (client) => {
      await client.query(
        `REVOKE CREATE,TEMPORARY ON DATABASE ${quote(database)} FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      );
      await client.query(roleSql);
    });
    reader = new pg.Pool({
      connectionString: urlFor(readerRole),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    ownerPool = new pg.Pool({
      connectionString: urlFor(ownerRole),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await seed('signal-alpha', 3);
    await seed('signal-beta', 1);
    await seed('signal-gamma', 1);
    // Synthetic PRIVATE history only: no public permit, verifier execution,
    // publication task, model request or public eligibility is manufactured.
    await recordPrivateSignalPublicationTransition({
      pool: ownerPool,
      request: {
        signal_id: 'signal-alpha',
        request_key: 'workbench-private-head',
        action: 'publish',
        target_version: 2,
        expected_revision: 0,
        reason_code: 'initial_publication',
      },
    });
  }, 30000);

  afterAll(async () => {
    try {
      await reader?.end();
      await ownerPool?.end();
      if (createdDatabase) {
        await waitForDatabaseDisconnects(administrator, database);
        await administrator.query(`DROP DATABASE ${quote(database)}`);
      }
      for (const role of roles.reverse()) await administrator.query(`DROP ROLE ${quote(role)}`);
    } finally {
      try {
        for (const row of restoredDatabases) {
          await administrator.query(
            `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE ${quote(row.name)} FROM PUBLIC`,
          );
          for (const privilege of row.privileges)
            await administrator.query(
              `GRANT ${privilege} ON DATABASE ${quote(row.name)} TO PUBLIC`,
            );
        }
      } finally {
        await administrator?.end();
      }
    }
  }, 30000);

  async function seed(id, versions) {
    await owner(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts) VALUES($1,'Synthetic source','website',80,ARRAY['example.com'])`,
          [`${id}-source`],
        );
        await client.query(
          `INSERT INTO public.signals(id,title,type,occurred_at,source_id,source_url,summary,importance,strength,confidence,novelty,metadata)
          VALUES($1,'Legacy row must not substitute snapshots','research','2026-01-01Z',$2,'https://example.com/source','Legacy summary',3,3,0.8,0.5,'{"private":"RAW_METADATA_SENTINEL"}')`,
          [id, `${id}-source`],
        );
        for (let version = 1; version <= versions; version++) {
          await client.query(
            `INSERT INTO public.signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
            VALUES($1,$2,$3,'research','2026-01-01Z','day','Synthetic event date','2026-09-15Z',$4,'Synthetic analysis',3,3,0.8,0.5,'Synthetic revision','manual',repeat('a',64))`,
            [id, version, `${id} snapshot ${version}`, `Summary version ${version}`],
          );
          await client.query(
            `INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at)
            VALUES($1,$2,$3,'RAW_LOCATOR_SENTINEL','RAW_EXCERPT_SENTINEL',repeat('b',64),'2026-09-15Z')`,
            [
              `${id}-evidence-${version}`,
              `${id}-source`,
              version === 1
                ? 'https://user:URL_SECRET_SENTINEL@example.com/source'
                : 'https://example.com/source',
            ],
          );
          await client.query(
            `INSERT INTO public.signal_version_evidence(signal_id,version,evidence_id,claim,relation) VALUES($1,$2,$3,$4,'supports')`,
            [id, version, `${id}-evidence-${version}`, `Claim version ${version}`],
          );
        }
        await client.query(
          `INSERT INTO public.signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis) VALUES($1,$2,1,$3,'Synthetic identity')`,
          [id, `${id}-event`, `${id}-evidence-1`],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async function businessState() {
    return owner(
      async (client) =>
        (
          await client.query(`SELECT
    (SELECT count(*) FROM public.signal_versions)::int AS versions,
    (SELECT count(*) FROM public.signal_publication_outbox)::int AS outbox,
    (SELECT count(*) FROM public.signal_candidate_verifications)::int AS verifications,
    (SELECT count(*) FROM public.signal_publication_runs)::int AS runs,
    (SELECT count(*) FROM public.ai_probe_runs)::int AS probes,
    (SELECT publication_enabled FROM public.signal_publication_control WHERE singleton) AS publication_enabled`)
        ).rows[0],
    );
  }

  it('authenticates as the exact least-privilege reader and grants only the pinned columns', async () => {
    expect((await reader.query('SELECT session_user,current_user')).rows[0]).toEqual({
      session_user: readerRole,
      current_user: readerRole,
    });
    await verifySignalWorkbenchAccess(reader);
    const grants = await admin(
      async (client) =>
        (
          await client.query(
            `SELECT c.relname AS table_name,a.attname AS column_name,p.privilege_type,p.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      CROSS JOIN LATERAL aclexplode(a.attacl) p WHERE n.nspname='public' AND p.grantee=$1::regrole ORDER BY c.relname,a.attname`,
            [readerRole],
          )
        ).rows,
    );
    expect(grants).toEqual(
      Object.entries(signalWorkbenchReadColumns)
        .flatMap(([table_name, columns]) =>
          columns.map((column_name) => ({
            table_name,
            column_name,
            privilege_type: 'SELECT',
            is_grantable: false,
          })),
        )
        .sort(
          (a, b) =>
            a.table_name.localeCompare(b.table_name, 'en') ||
            a.column_name.localeCompare(b.column_name, 'en'),
        ),
    );
    expect(
      (
        await reader.query(
          `SELECT has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY') AS creates`,
        )
      ).rows[0].creates,
    ).toBe(false);
  });

  it('full schema verification accepts the actual reviewed reader provisioning after all migrations', async () => {
    const result = await verifyDatabaseContract({
      connectionString: urlFor(ownerRole),
      profile: 'local-test',
      expectedDatabase: database,
      expectedUser: ownerRole,
    });
    expect(result).toMatchObject({ migrationCount: 24, tableCount: 55 });
  });

  it('empty-role-only provisioning refuses a second grant run without changing valid rights', async () => {
    await expect(owner((client) => client.query(roleSql))).rejects.toThrow();
    await verifySignalWorkbenchAccess(reader);
  });

  it.each([
    [
      'missing predicate execute',
      `REVOKE EXECUTE ON FUNCTION public.hzense_public_signal_is_current(uuid) FROM ${quote(readerRole)}`,
      `GRANT EXECUTE ON FUNCTION public.hzense_public_signal_is_current(uuid) TO ${quote(readerRole)}`,
    ],
    [
      'role attributes',
      `ALTER ROLE ${quote(readerRole)} INHERIT`,
      `ALTER ROLE ${quote(readerRole)} NOINHERIT`,
    ],
    [
      'inbound membership',
      `GRANT ${quote(readerRole)} TO ${quote(auxiliaryRole)}`,
      `REVOKE ${quote(readerRole)} FROM ${quote(auxiliaryRole)}`,
    ],
    [
      'outbound membership',
      `GRANT ${quote(auxiliaryRole)} TO ${quote(readerRole)}`,
      `REVOKE ${quote(auxiliaryRole)} FROM ${quote(readerRole)}`,
    ],
    [
      'extra column',
      `GRANT SELECT(excerpt) ON public.public_source_evidence TO ${quote(readerRole)}`,
      `REVOKE SELECT(excerpt) ON public.public_source_evidence FROM ${quote(readerRole)}`,
    ],
    [
      'missing column',
      `REVOKE SELECT(title) ON public.signal_versions FROM ${quote(readerRole)}`,
      `GRANT SELECT(title) ON public.signal_versions TO ${quote(readerRole)}`,
    ],
  ])(
    'full schema verification rejects optional reader drift: %s',
    async (_label, change, restore) => {
      const verify = () =>
        verifyDatabaseContract({
          connectionString: urlFor(ownerRole),
          profile: 'local-test',
          expectedDatabase: database,
          expectedUser: ownerRole,
        });
      await admin((client) => client.query(change));
      try {
        await expect(verify()).rejects.toThrow(/Signal workbench reader/);
      } finally {
        await admin((client) => client.query(restore));
      }
      await expect(verify()).resolves.toMatchObject({ migrationCount: 24, tableCount: 55 });
    },
  );

  it.each([
    'SELECT * FROM public.signals',
    'SELECT excerpt FROM public.public_source_evidence',
    'SELECT locator FROM public.public_source_evidence',
    'SELECT metadata FROM public.entities',
    'SELECT dependency_seal FROM public.signal_verification_dependency_seals',
    'SELECT encrypted_key FROM public.ai_connections',
    'SELECT * FROM public.ai_connections',
    "UPDATE public.signal_versions SET title='forbidden' WHERE false",
    'DELETE FROM public.signal_versions WHERE false',
    'INSERT INTO public.signal_versions(signal_id,version) SELECT signal_id,version FROM public.signal_versions WHERE false',
    'CREATE TEMP TABLE workbench_forbidden(id integer)',
    'CREATE TABLE public.workbench_forbidden(id integer)',
    `SET ROLE ${quote(ownerRole)}`,
  ])('rejects disallowed operation %s', async (sql) => {
    await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
  });

  it('lists stable bounded pages and separates latest snapshot, recorded head and current public visibility', async () => {
    const before = await businessState();
    const first = await listSignalWorkbench({ pool: reader, request: { limit: 2 } });
    expect(first.items.map((row) => row.signal_id)).toEqual(['signal-alpha', 'signal-beta']);
    expect(first.next_after).toBe('signal-beta');
    expect(first.items[0]).toMatchObject({
      latest_snapshot_version: 3,
      recorded_head: { content_version: 2, status: 'published' },
      current_public_version: null,
    });
    const second = await listSignalWorkbench({
      pool: reader,
      request: { limit: 2, after: first.next_after },
    });
    expect(second.items.map((row) => row.signal_id)).toEqual(['signal-gamma']);
    expect(second.next_after).toBeNull();
    expect(
      (await listSignalWorkbench({ pool: reader, request: { q: "%_' OR TRUE --" } })).items,
    ).toEqual([]);
    expect(await businessState()).toEqual(before);
  });

  it('returns exact requested historical snapshot and version-bound safe evidence without raw fields', async () => {
    const current = await getSignalWorkbenchDetail({
      pool: reader,
      request: { signal_id: 'signal-alpha' },
    });
    const historical = await getSignalWorkbenchDetail({
      pool: reader,
      request: { signal_id: 'signal-alpha', version: 1 },
    });
    expect(current).toMatchObject({
      latest_snapshot_version: 3,
      selected_version: 3,
      snapshot: { version: 3, title: 'signal-alpha snapshot 3' },
      recorded_head: { content_version: 2 },
      current_public_version: null,
    });
    expect(historical).toMatchObject({
      latest_snapshot_version: 3,
      selected_version: 1,
      snapshot: { version: 1, title: 'signal-alpha snapshot 1' },
    });
    expect(historical.evidence).toHaveLength(1);
    expect(historical.evidence[0]).toMatchObject({ claim: 'Claim version 1', source_url: null });
    expect(current.evidence[0]).toMatchObject({
      claim: 'Claim version 3',
      source_url: 'https://example.com/source',
    });
    const json = JSON.stringify([current, historical]);
    for (const marker of [
      'RAW_EXCERPT_SENTINEL',
      'RAW_LOCATOR_SENTINEL',
      'RAW_METADATA_SENTINEL',
      'URL_SECRET_SENTINEL',
    ])
      expect(json).not.toContain(marker);
    expect(historical.verifications).toEqual([]);
  });

  it('does not synthesize a missing Signal or version', async () => {
    await expect(
      getSignalWorkbenchDetail({ pool: reader, request: { signal_id: 'not-present' } }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      getSignalWorkbenchDetail({
        pool: reader,
        request: { signal_id: 'signal-alpha', version: 99 },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects effective over-privilege at runtime and leaves no partial provisioning change', async () => {
    await owner((client) =>
      client.query(
        `GRANT SELECT(excerpt) ON public.public_source_evidence TO ${quote(readerRole)}`,
      ),
    );
    try {
      await expect(listSignalWorkbench({ pool: reader })).rejects.toMatchObject({
        code: 'access_denied',
      });
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow();
    } finally {
      await owner((client) =>
        client.query(
          `REVOKE SELECT(excerpt) ON public.public_source_evidence FROM ${quote(readerRole)}`,
        ),
      );
    }
    await verifySignalWorkbenchAccess(reader);
  });

  it('role membership cannot become an alternate path to owner privileges', async () => {
    await administrator.query(
      `GRANT ${quote(auxiliaryRole)} TO ${quote(readerRole)} WITH INHERIT FALSE,SET FALSE`,
    );
    try {
      await expect(listSignalWorkbench({ pool: reader })).rejects.toMatchObject({
        code: 'access_denied',
      });
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow();
    } finally {
      await administrator.query(`REVOKE ${quote(auxiliaryRole)} FROM ${quote(readerRole)}`);
    }
    await verifySignalWorkbenchAccess(reader);
  });

  it('a concurrent new snapshot cannot mix latest-version metadata with an older transaction view', async () => {
    let inserted = false;
    const pool = {
      connect: async () => {
        const client = await reader.connect();
        return {
          release: (error) => client.release(error),
          query: async (sql, values) => {
            const result = await client.query(sql, values);
            if (sql.includes('workbench:overview') && !inserted) {
              inserted = true;
              await owner((writer) =>
                writer.query(`INSERT INTO public.signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
            VALUES('signal-alpha',4,'Concurrent snapshot four','research','2026-01-01Z','day','Synthetic event date','2026-09-15Z','Concurrent summary',3,3,0.8,0.5,'Synthetic later snapshot','manual',repeat('a',64))`),
              );
            }
            return result;
          },
        };
      },
    };
    const observed = await getSignalWorkbenchDetail({
      pool,
      request: { signal_id: 'signal-alpha' },
    });
    expect(inserted).toBe(true);
    expect(observed.latest_snapshot_version).toBe(3);
    expect(observed.snapshot.version).toBe(3);
    expect(observed.versions.some((row) => row.version === 4)).toBe(false);
    expect(
      (await getSignalWorkbenchDetail({ pool: reader, request: { signal_id: 'signal-alpha' } }))
        .latest_snapshot_version,
    ).toBe(4);
  });

  it('post-GRANT drift aborts and rolls back all new privileges', async () => {
    // This role has no owned objects (verified above). Reset only this fixture
    // role's grants to exercise the production script's empty-role boundary.
    await admin((client) => client.query(`DROP OWNED BY ${quote(readerRole)}`));
    const marker = 'DO $signal_admin_reader_verify$';
    expect(roleSql).toContain(marker);
    const injected = roleSql.replace(
      marker,
      `GRANT SELECT(excerpt) ON public.public_source_evidence TO ${quote(readerRole)};\n${marker}`,
    );
    await expect(owner((client) => client.query(injected))).rejects.toThrow();
    expect(
      (
        await administrator.query(
          `SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1::regrole AND deptype='a'`,
          [readerRole],
        )
      ).rows,
    ).toEqual([]);
    await owner((client) => client.query(roleSql));
    await verifySignalWorkbenchAccess(reader);
  });

  it('reads a genuinely permitted current view then observes dependency invalidation without equating the historical head with eligibility', async () => {
    const id = 'signal-public-fixture';
    const row = {
      signal_id: id,
      version: 1,
      schema_version: '3.0.0',
      title: 'Synthetic qualified fixture',
      type: 'research',
      occurred_at: '2026-01-01T00:00:00.000Z',
      date_precision: 'day',
      date_basis: 'Synthetic event date',
      captured_at: '2026-09-15T00:00:00.000Z',
      summary: 'Synthetic fixture claim',
      analysis: 'Synthetic fixture analysis',
      importance: 3,
      strength: 3,
      confidence: 0.8,
      novelty: 0.5,
      revision_reason: 'Synthetic fixture',
      origin: 'manual',
      legacy_status: null,
    };
    const hash = createHash('sha256').update(JSON.stringify(row), 'utf8').digest('hex');
    // Owner-only synthetic preparation reuses the real verification/assembly
    // contract. This is not a factual assessment or a workbench write path.
    await owner(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts) VALUES($1,'Synthetic source','website',80,ARRAY['example.com'])`,
          [`${id}-source`],
        );
        await client.query(
          `INSERT INTO public.entities(id,type,name) VALUES($1,'person','Synthetic author'),($2,'company','Synthetic organization')`,
          [`${id}-person`, `${id}-organization`],
        );
        await client.query('INSERT INTO public.person_profiles(entity_id) VALUES($1)', [
          `${id}-person`,
        ]);
        await client.query(
          "INSERT INTO public.organization_profiles(entity_id,entity_type) VALUES($1,'company')",
          [`${id}-organization`],
        );
        await client.query(
          "INSERT INTO public.topics(id,title,status,runtime_enabled) VALUES($1,'Synthetic Topic','active',true)",
          [`${id}-topic`],
        );
        await client.query(
          `INSERT INTO public.signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty) VALUES($1,'Synthetic fixture','research',$2,$3,$4,'https://example.com/source','Synthetic fixture claim',3,3,0.8,0.5)`,
          [id, row.occurred_at, row.captured_at, `${id}-source`],
        );
        await client.query(
          `INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status) VALUES($1,$2,'https://example.com/source','Synthetic locator','Synthetic evidence',repeat('b',64),$3,$4,'verified')`,
          [`${id}-evidence`, `${id}-source`, row.captured_at, row.occurred_at],
        );
        await client.query(
          `INSERT INTO public.signal_versions(signal_id,version,schema_version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash) VALUES(${Array.from({ length: 19 }, (_, index) => `$${index + 1}`).join(',')})`,
          [...Object.values(row), hash],
        );
        await client.query(
          `INSERT INTO public.signal_version_evidence(signal_id,version,evidence_id,claim,relation) VALUES($1,1,$2,'Synthetic fixture claim','supports')`,
          [id, `${id}-evidence`],
        );
        await client.query(
          `INSERT INTO public.signal_version_people(signal_id,version,person_id,evidence_id,event_role,verification_status) VALUES($1,1,$2,$3,'research_author','pending')`,
          [id, `${id}-person`, `${id}-evidence`],
        );
        await client.query(
          `INSERT INTO public.signal_version_organizations(signal_id,version,organization_id,evidence_id,event_role,verification_status) VALUES($1,1,$2,$3,'subject','pending')`,
          [id, `${id}-organization`, `${id}-evidence`],
        );
        await client.query(
          'INSERT INTO public.signal_version_topics(signal_id,version,topic_id) VALUES($1,1,$2)',
          [id, `${id}-topic`],
        );
        await client.query(
          `INSERT INTO public.signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis) VALUES($1,$2,1,$3,'Synthetic identity')`,
          [id, `${id}-event`, `${id}-evidence`],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    const material = await readPrivateCandidateVerificationMaterial({
      pool: ownerPool,
      request: { signal_id: id, source_version: 1 },
    });
    const verification = {
      verification_id: randomUUID(),
      signal_id: id,
      source_version: 1,
      source_content_hash: material.bundle.snapshot.content_hash,
      bundle_fingerprint: material.bundle_fingerprint,
      verifier_id: randomUUID(),
      policy_version: 'candidate-verification-v1',
      decision: 'approved',
      checks: {
        claims_supported: true,
        people_disambiguated: true,
        people_are_participants: true,
        organizations_supported: true,
        public_sources_cleared: true,
        contradictions_resolved: true,
      },
      valid_for_seconds: 60,
    };
    await recordPrivateCandidateVerification({ pool: ownerPool, request: verification });
    await assemblePrivateVerifiedSignalCandidate({
      pool: ownerPool,
      request: {
        request_key: `assemble:${randomUUID()}`,
        verification_id: verification.verification_id,
        signal_id: id,
        source_version: 1,
        target_version: 2,
      },
    });
    const run = {
      run_id: randomUUID(),
      task_id: randomUUID(),
      principal_id: randomUUID(),
      original_intent: 'auto_publish',
    };
    await ownerPool.query(
      'UPDATE public.signal_publication_control SET publication_enabled=true WHERE singleton',
    );
    try {
      await ownerPool.query(
        `INSERT INTO public.signal_publication_tasks(task_id,policy,publication_enabled) VALUES($1,'auto_publish',true)`,
        [run.task_id],
      );
      await ownerPool.query(
        'INSERT INTO public.signal_publication_authorizations(task_id,principal_id,can_publish) VALUES($1,$2,true)',
        [run.task_id, run.principal_id],
      );
      await createPrivatePublicationRun({ pool: ownerPool, request: run });
      const leaseOwner = randomUUID();
      await claimPrivatePublicationRun({
        pool: ownerPool,
        request: { run_id: run.run_id, lease_owner: leaseOwner, lease_seconds: 60 },
      });
      await publishVerifiedSignal({
        pool: ownerPool,
        request: {
          request_key: `public:${randomUUID()}`,
          signal_id: id,
          source_version: 2,
          target_version: 3,
          expected_revision: 0,
          reason_code: 'initial_publication',
          run_id: run.run_id,
          lease_owner: leaseOwner,
          fencing_token: 1,
        },
      });
      const before = await businessState();
      const current = await getSignalWorkbenchDetail({ pool: reader, request: { signal_id: id } });
      expect(current.current_public_version).toBe(3);
      expect(current.people).toMatchObject([
        {
          entity_id: `${id}-person`,
          event_role: 'research_author',
          verification_status: 'verified',
        },
      ]);
      expect(current.organizations).toMatchObject([
        { entity_id: `${id}-organization`, event_role: 'subject', verification_status: 'verified' },
      ]);
      expect(current.topics).toEqual([{ id: `${id}-topic`, title: 'Synthetic Topic' }]);
      expect(current.verifications[0]).toMatchObject({
        decision: 'approved',
        dependency_invalidated: false,
      });
      expect(await businessState()).toEqual(before);
      await ownerPool.query('UPDATE public.sources SET active=false WHERE id=$1', [`${id}-source`]);
      const invalidated = await getSignalWorkbenchDetail({
        pool: reader,
        request: { signal_id: id },
      });
      expect(invalidated.recorded_head).toMatchObject({ status: 'published', content_version: 3 });
      expect(invalidated.current_public_version).toBeNull();
      expect(invalidated.verifications[0].dependency_invalidated).toBe(true);
    } finally {
      await ownerPool.query(
        'UPDATE public.signal_publication_control SET publication_enabled=false WHERE singleton',
      );
    }
  });

  it('reports a legal-database but non-URL-compatible identifier without silently dropping it', async () => {
    await owner(async (client) => {
      await client.query(
        `INSERT INTO public.signals(id,title,type,occurred_at,source_id,source_url,summary,importance,strength,confidence,novelty) VALUES('Bad Private ID','Bad identifier fixture','research','2026-01-01Z','signal-alpha-source','https://example.com/source','Synthetic summary',3,3,0.8,0.5)`,
      );
      await client.query(
        `INSERT INTO public.signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash) VALUES('Bad Private ID',1,'Bad identifier fixture','research','2026-01-01Z','day','Synthetic date','2026-09-15Z','Synthetic summary',3,3,0.8,0.5,'Synthetic revision','manual',repeat('a',64))`,
      );
    });
    await expect(listSignalWorkbench({ pool: reader })).rejects.toMatchObject({
      code: 'incompatible_data',
      message: 'incompatible_data',
    });
  });

  it('bounds real history reads to fifty records and explicitly marks truncation', async () => {
    await seed('signal-bounded', 51);
    const result = await getSignalWorkbenchDetail({
      pool: reader,
      request: { signal_id: 'signal-bounded', version: 1 },
    });
    expect(result.versions).toHaveLength(50);
    expect(result.versions[0].version).toBe(51);
    expect(result.versions.at(-1).version).toBe(2);
    expect(result.snapshot.version).toBe(1);
    expect(result.truncated.versions).toBe(true);
    expect(result).not.toHaveProperty('total');
  });
});
