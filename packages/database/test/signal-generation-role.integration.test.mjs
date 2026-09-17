import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  assertGenerationRole,
  assertGenerationRoleProvisioned,
} from '../src/signal-generation-role.mjs';
import { signalGenerationRoleColumns } from '../src/signal-generation-role-columns.mjs';
import {
  createSignalGeneration,
  claimSignalGeneration,
  finishSignalGeneration,
  getSignalGeneration,
  listSignalGenerations,
  cancelSignalGeneration,
  signalGenerationSourceHash,
} from '../src/signal-generation-store.mjs';

const adminURL = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminURL) validateConnectionTarget({ connectionString: adminURL, profile: 'local-test' });
const suite = adminURL ? describe.sequential : describe.skip;
const role = 'hzense_generation_admin';
const peer = `generation_peer_${process.pid}_${Date.now()}`;
const sentinel = `generation_sentinel_${process.pid}_${Date.now()}`;
const checksum = '0c93078e520045e733824668d5eafe23064c48c60a0f0d52c72e00a9eae6b666';
const configureSQL = await readFile(
  new URL('../../../db/roles/configure_generation_admin.sql', import.meta.url),
  'utf8',
);
const createSQL = await readFile(
  new URL('../../../db/roles/create_generation_admin.sql', import.meta.url),
  'utf8',
);
const createdRoles = [],
  createdDatabases = [],
  ambient = [];
let admin, owner, fixture, reader, bootstrap;
function urlFor(database, username, password) {
  const url = new URL(adminURL);
  url.pathname = `/${database}`;
  if (username) {
    url.username = username;
    url.password = password;
  }
  return url.href;
}
async function execute(client, sql) {
  try {
    return await client.query(sql);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
const provision = (sql = configureSQL) => execute(owner, sql);
async function resetGrants() {
  await fixture.query(`DROP OWNED BY ${role}`);
}
async function expectNoGrants() {
  expect(
    (
      await admin.query(
        `SELECT count(*)::int AS n FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1::regrole AND deptype='a'`,
        [role],
      )
    ).rows[0].n,
  ).toBe(0);
}
async function checkBoth() {
  await assertGenerationRole(reader);
  await assertGenerationRoleProvisioned(owner);
}
suite('generation production role provisioning', () => {
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Generation provisioning requires a disposable isolated PostgreSQL cluster');
    admin = new pg.Client({ connectionString: adminURL });
    await admin.connect();
    bootstrap = (await admin.query('SELECT rolname FROM pg_roles WHERE oid=10')).rows[0].rolname;
    const occupied = await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
      [role, 'neondb_owner', peer],
    ]);
    if (occupied.rowCount) throw new Error('Refuse to mutate a pre-existing fixture role');
    if (
      (await admin.query('SELECT 1 FROM pg_database WHERE datname=ANY($1)', [['neondb', sentinel]]))
        .rowCount
    )
      throw new Error('Refuse to mutate a pre-existing fixture database');
    const other = (
      await admin.query(
        "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
      )
    ).rows;
    if (other.length) throw new Error('Refuse cluster containing unrelated connectable databases');
    // Preserve pristine provider-reserved databases to exercise that narrow
    // exception. Prior suites may have restored equivalent PUBLIC privileges
    // with a different ACL shape; isolate those ordinary fixtures instead.
    const pristineProviderDatabases =
      bootstrap === 'cloud_admin' &&
      (
        await admin.query(`SELECT
        EXISTS(SELECT 1 FROM pg_database WHERE datname='postgres' AND datacl IS NULL AND pg_get_userbyid(datdba)='cloud_admin')
        AND EXISTS(SELECT 1 FROM pg_database d WHERE datname='template1' AND datistemplate AND pg_get_userbyid(datdba)='cloud_admin'
          AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM aclexplode(d.datacl) a WHERE a.grantee=0)=ARRAY['CONNECT']::text[]) AS pristine`)
      ).rows[0].pristine;
    if (!pristineProviderDatabases) {
      for (const name of ['postgres', 'template1']) {
        const privileges = (
          await admin.query(
            "SELECT a.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0",
            [name],
          )
        ).rows.map((r) => r.privilege_type);
        ambient.push({ name, privileges });
        await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
      }
    }
    const password = randomUUID();
    await admin.query(`CREATE ROLE neondb_owner LOGIN NOINHERIT CREATEROLE PASSWORD '${password}'`);
    createdRoles.push('neondb_owner');
    await admin.query(`CREATE ROLE "${peer}" NOLOGIN NOINHERIT`);
    createdRoles.push(peer);
    await admin.query('CREATE DATABASE neondb OWNER neondb_owner TEMPLATE template0');
    createdDatabases.push('neondb');
    await admin.query(`CREATE DATABASE "${sentinel}" TEMPLATE template0`);
    createdDatabases.push(sentinel);
    await admin.query(`REVOKE ALL ON DATABASE "${sentinel}" FROM PUBLIC`);
    fixture = new pg.Client({ connectionString: urlFor('neondb') });
    await fixture.connect();
    owner = new pg.Client({ connectionString: urlFor('neondb', 'neondb_owner', password) });
    await owner.connect();
    await owner.query(
      'REVOKE ALL ON DATABASE neondb FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC',
    );
    await owner.query(
      await readFile(
        new URL('../../../db/migrations/0015_signal_generation.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query(
      `CREATE TABLE public.hzense_schema_migrations(name text,checksum text); INSERT INTO public.hzense_schema_migrations VALUES('0015_signal_generation.sql','${checksum}')`,
    );
    for (const name of [
      'import_documents',
      'ai_connections',
      'ai_profiles',
      'signal_candidates',
      'signals',
    ])
      await owner.query(`CREATE TABLE public.${name}(secret text)`);
    await owner.query("CREATE TYPE public.generation_fixture_type AS ENUM ('synthetic')");
  });
  afterAll(async () => {
    await reader?.end();
    await owner?.end();
    await fixture?.end();
    if (!admin) return;
    for (const name of createdDatabases.reverse())
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    for (const name of createdRoles.reverse()) await admin.query(`DROP ROLE "${name}"`);
    for (const { name, privileges } of ambient)
      for (const privilege of privileges) {
        if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(privilege))
          throw new Error('Unexpected fixture privilege');
        await admin.query(`GRANT ${privilege} ON DATABASE "${name}" TO PUBLIC`);
      }
    await admin.end();
  });
  it('creates an empty SCRAM login only under the exact Neon creator shape', async () => {
    await expect(execute(fixture, createSQL)).rejects.toThrow(/authenticated neondb owner/);
    let password;
    if (bootstrap === 'cloud_admin') {
      const results = await execute(owner, createSQL);
      createdRoles.push(role);
      password = results
        .flatMap((r) => r.rows)
        .find((r) => Object.hasOwn(r, 'HZENSE_GENERATION_DATABASE_PASSWORD - SECRET'))[
        'HZENSE_GENERATION_DATABASE_PASSWORD - SECRET'
      ];
      expect(typeof password === 'string' && /^[a-f0-9]{64}$/.test(password)).toBe(true);
    } else {
      await expect(execute(owner, createSQL)).rejects.toThrow(
        /Unexpected Generation role membership/,
      );
      expect((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount).toBe(
        0,
      );
      password = randomUUID();
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOINHERIT CONNECTION LIMIT 2 PASSWORD '${password}'`,
      );
      createdRoles.push(role);
    }
    await expectNoGrants();
    const before = (await admin.query('SELECT rolpassword FROM pg_authid WHERE rolname=$1', [role]))
      .rows[0].rolpassword;
    await expect(execute(owner, createSQL)).rejects.toThrow(/already exists/);
    const after = (await admin.query('SELECT rolpassword FROM pg_authid WHERE rolname=$1', [role]))
      .rows[0].rolpassword;
    expect(before === after && before.startsWith('SCRAM-SHA-256$')).toBe(true);
    // PostgreSQL pins retained creator grants to bootstrap role OID 10. A
    // postgres-bootstrap CI cluster cannot fabricate Neon's cloud_admin grantor.
    // Exercise the no-membership local variant there; the cloud_admin-bootstrap
    // run above executes the unchanged production credential script end to end.
    if (bootstrap !== 'cloud_admin') await admin.query('ALTER ROLE neondb_owner SUPERUSER');
    reader = new pg.Pool({ connectionString: urlFor('neondb', role, password), max: 1 });
  });
  it('grants the exact contract and passes owner and authenticated runtime checks', async () => {
    await provision();
    await checkBoth();
    await expect(provision()).rejects.toThrow(/existing direct ACLs/);
    await checkBoth();
    if (bootstrap === 'cloud_admin')
      await expect(execute(owner, `BEGIN; SET ROLE ${role}; ROLLBACK`)).rejects.toMatchObject({
        code: '42501',
      });
    await expect(reader.query('SET ROLE neondb_owner')).rejects.toMatchObject({ code: '42501' });
    await expect(assertGenerationRole(owner)).rejects.toThrow('generation_role_invalid');
    await expect(assertGenerationRoleProvisioned(reader)).rejects.toThrow(
      'generation_role_invalid',
    );
  });
  it.each([
    [
      'wrong checksum',
      "UPDATE public.hzense_schema_migrations SET checksum='wrong'",
      `UPDATE public.hzense_schema_migrations SET checksum='${checksum}'`,
    ],
    ['unsafe role', `ALTER ROLE ${role} INHERIT`, `ALTER ROLE ${role} NOINHERIT`],
    [
      'PUBLIC data',
      'GRANT SELECT ON public.import_documents TO PUBLIC',
      'REVOKE SELECT ON public.import_documents FROM PUBLIC',
    ],
    [
      'PUBLIC database CREATE',
      'GRANT CREATE ON DATABASE neondb TO PUBLIC',
      'REVOKE CREATE ON DATABASE neondb FROM PUBLIC',
    ],
    [
      'PUBLIC database TEMP',
      'GRANT TEMPORARY ON DATABASE neondb TO PUBLIC',
      'REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC',
    ],
    [
      'PUBLIC cross database',
      `GRANT CONNECT ON DATABASE "${sentinel}" TO PUBLIC`,
      `REVOKE CONNECT ON DATABASE "${sentinel}" FROM PUBLIC`,
    ],
    [
      'direct cross database',
      `GRANT CONNECT ON DATABASE "${sentinel}" TO ${role}`,
      `REVOKE CONNECT ON DATABASE "${sentinel}" FROM ${role}`,
    ],
    [
      'outbound membership',
      `GRANT "${peer}" TO ${role} WITH INHERIT FALSE, SET TRUE`,
      `REVOKE "${peer}" FROM ${role}`,
    ],
    [
      'inbound SET membership',
      `GRANT ${role} TO "${peer}" WITH INHERIT FALSE, SET TRUE`,
      `REVOKE ${role} FROM "${peer}"`,
    ],
    [
      'inbound INHERIT membership',
      `GRANT ${role} TO "${peer}" WITH INHERIT TRUE, SET FALSE`,
      `REVOKE ${role} FROM "${peer}"`,
    ],
    [
      'inbound ADMIN membership',
      `GRANT ${role} TO "${peer}" WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      `REVOKE ${role} FROM "${peer}"`,
    ],
    ['role setting', `ALTER ROLE ${role} SET search_path=public`, `ALTER ROLE ${role} RESET ALL`],
    ...['SELECT ON TABLES', 'USAGE ON SEQUENCES', 'EXECUTE ON FUNCTIONS'].map((p) => [
      `PUBLIC default ${p}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${p} TO PUBLIC`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ${p} FROM PUBLIC`,
    ]),
  ])(
    'rejects unsafe pre-existing state without granting rights: %s',
    async (label, drift, restore) => {
      await resetGrants();
      try {
        await fixture.query(drift);
        await expect(provision()).rejects.toThrow();
        if (label !== 'direct cross database') await expectNoGrants();
      } finally {
        await fixture.query(restore);
        await provision();
      }
      await checkBoth();
    },
  );
  it.each([
    'SELECT ON public.signal_generation_runs',
    'INSERT ON public.signal_generation_runs',
    'UPDATE ON public.signal_generation_runs',
    'DELETE ON public.signal_generation_runs',
    'UPDATE(owner_id) ON public.signal_generation_runs',
    'UPDATE(snapshot) ON public.signal_generation_runs',
    'INSERT(created_at) ON public.signal_generation_runs',
    'SELECT(secret) ON public.ai_connections',
  ])('rejects and atomically rolls back an injected grant: %s', async (grant) => {
    await resetGrants();
    try {
      await expect(
        provision(
          configureSQL.replace(
            'DO $generation_admin_verify$',
            `GRANT ${grant} TO ${role};\nDO $generation_admin_verify$`,
          ),
        ),
      ).rejects.toThrow(/privilege mismatch/);
      await expectNoGrants();
    } finally {
      await provision();
    }
    await checkBoth();
  });
  it.each([
    [
      'unsupported direct type ACL',
      `GRANT USAGE ON TYPE public.generation_fixture_type TO ${role}`,
      `REVOKE USAGE ON TYPE public.generation_fixture_type FROM ${role}`,
    ],
    [
      'PUBLIC already-allowed SELECT snapshot',
      'GRANT SELECT(snapshot) ON public.signal_generation_runs TO PUBLIC',
      'REVOKE SELECT(snapshot) ON public.signal_generation_runs FROM PUBLIC',
    ],
    [
      'PUBLIC already-allowed UPDATE result',
      'GRANT UPDATE(result) ON public.signal_generation_runs TO PUBLIC',
      'REVOKE UPDATE(result) ON public.signal_generation_runs FROM PUBLIC',
    ],
    [
      'default ACL',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC',
    ],
    [
      'cross database',
      `GRANT CONNECT ON DATABASE "${sentinel}" TO PUBLIC`,
      `REVOKE CONNECT ON DATABASE "${sentinel}" FROM PUBLIC`,
    ],
    [
      'unsafe inbound edge',
      `GRANT ${role} TO "${peer}" WITH INHERIT FALSE, SET TRUE`,
      `REVOKE ${role} FROM "${peer}"`,
    ],
    [
      'column grant option',
      `GRANT SELECT(id) ON public.signal_generation_runs TO ${role} WITH GRANT OPTION`,
      `REVOKE GRANT OPTION FOR SELECT(id) ON public.signal_generation_runs FROM ${role}`,
    ],
  ])(
    'detects post-provisioning drift at runtime and by owner audit: %s',
    async (_label, drift, restore) => {
      try {
        await fixture.query(drift);
        await expect(assertGenerationRole(reader)).rejects.toThrow('generation_role_invalid');
        await expect(assertGenerationRoleProvisioned(owner)).rejects.toThrow(
          'generation_role_invalid',
        );
      } finally {
        await fixture.query(restore);
      }
      await checkBoth();
    },
  );
  it.each([
    `ALTER ROLE ${role} CONNECTION LIMIT 3`,
    `GRANT USAGE ON TYPE public.generation_fixture_type TO ${role}`,
    'GRANT SELECT(snapshot) ON public.signal_generation_runs TO PUBLIC',
    'GRANT UPDATE(result) ON public.signal_generation_runs TO PUBLIC',
    `GRANT ${role} TO "${peer}" WITH INHERIT FALSE, SET TRUE`,
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC',
    'GRANT CREATE ON SCHEMA public TO PUBLIC',
    'GRANT TEMPORARY ON DATABASE neondb TO PUBLIC',
    `GRANT SELECT(id) ON public.signal_generation_runs TO ${role} WITH GRANT OPTION`,
  ])(
    'rechecks capability drift before COMMIT and rolls the whole transaction back: %s',
    async (drift) => {
      await resetGrants();
      try {
        await expect(
          provision(
            configureSQL.replace(
              'DO $generation_admin_verify$',
              `${drift};\nDO $generation_admin_verify$`,
            ),
          ),
        ).rejects.toThrow();
        await expectNoGrants();
      } finally {
        await provision();
      }
      await checkBoth();
    },
  );
  it('keeps owner audit catalog reads safe from temporary catalog shadows', async () => {
    await owner.query(
      'CREATE TEMP TABLE pg_roles(poison text); CREATE TEMP TABLE pg_database(poison text)',
    );
    try {
      await assertGenerationRoleProvisioned(owner);
    } finally {
      await owner.query('DROP TABLE pg_temp.pg_roles,pg_temp.pg_database');
    }
  });
  it('runs the private lifecycle with pinned projections and rejects other private services', async () => {
    await owner.query('ALTER TABLE public.signal_generation_runs ADD COLUMN future_secret text');
    try {
      await checkBoth();
      const source = {
        classification: 'private',
        fragments: [{ index: 0, text: 'Synthetic only', locator: { paragraph: 1 } }],
        warnings: [],
      };
      const connection = {
        id: randomUUID(),
        revision: 1,
        protocol: 'openai-compatible',
        base_url: 'https://provider.example/v1',
        settings: {},
      };
      const profile = {
        id: randomUUID(),
        revision: 1,
        stages: { extract: { connection_id: connection.id, connection_revision: 1 } },
      };
      const run = await createSignalGeneration({
        pool: reader,
        owner: 'synthetic',
        request: {
          id: randomUUID(),
          batchId: randomUUID(),
          itemId: randomUUID(),
          sourceFence: 1,
          sourceHash: signalGenerationSourceHash(source),
          profileId: profile.id,
          profileRevision: 1,
        },
        snapshot: { source, profile, connection },
        configuration: {
          version: 'test-v1',
          reserveMicrousd: 10,
          batchLimitMicrousd: 100,
          dailyLimitMicrousd: 100,
        },
      });
      const args = {
        pool: reader,
        owner: 'synthetic',
        id: run.id,
        currentLimits: { batchLimitMicrousd: 100, dailyLimitMicrousd: 100 },
      };
      const claimed = await claimSignalGeneration(args);
      await finishSignalGeneration({
        ...args,
        token: claimed.run.lease_token,
        outcome: 'completed',
        chargedMicrousd: 1,
        result: { classification: 'private', candidates: [] },
      });
      expect((await getSignalGeneration(args)).status).toBe('completed');
      expect(
        (await listSignalGenerations({ pool: reader, owner: 'synthetic' }))[0],
      ).not.toHaveProperty('future_secret');
      await cancelSignalGeneration(args);
      for (const sql of [
        'SELECT future_secret FROM public.signal_generation_runs',
        'DELETE FROM public.signal_generation_runs',
        "UPDATE public.signal_generation_runs SET snapshot='{}'",
        'CREATE TABLE public.forbidden(id int)',
        ...[
          'import_documents',
          'ai_connections',
          'ai_profiles',
          'signal_candidates',
          'signals',
        ].map((name) => `SELECT * FROM public.${name}`),
      ])
        await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
      await owner.query(`GRANT SELECT(future_secret) ON public.signal_generation_runs TO ${role}`);
      await expect(assertGenerationRole(reader)).rejects.toThrow('generation_role_invalid');
    } finally {
      await owner.query('ALTER TABLE public.signal_generation_runs DROP COLUMN future_secret');
    }
    await checkBoth();
    expect(Object.values(signalGenerationRoleColumns).flat()).toHaveLength(43);
  });
});
