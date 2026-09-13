import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { inspectSignalWriterGrants, signalWriterRoleName } from '../src/signal-writer-contract.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integration = adminUrl ? describe.sequential : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_writer_${suffix}`;
const ownerRole = `hzense_writer_owner_${suffix}`;
const auxiliaryRole = `hzense_writer_aux_${suffix}`;
const writerRole = signalWriterRoleName;
const ownerPassword = `fixture-owner-${suffix}`;
const writerPassword = `fixture-writer-${suffix}`;
const roleSql = await readFile(
  new URL('../../../db/roles/configure_signal_writer.sql', import.meta.url),
  'utf8',
);

function quote(value) {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error('Unsafe fixture identifier');
  return `"${value}"`;
}
function urlFor(role, password, database = databaseName) {
  const url = new URL(adminUrl);
  if (role) url.username = role;
  if (password) url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
async function connect(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}
const owner = (callback) => connect(urlFor(ownerRole, ownerPassword), callback);
const writer = (callback) => connect(urlFor(writerRole, writerPassword), callback);
const databaseAdmin = (callback) => connect(urlFor(), callback);

async function aclSnapshot() {
  return databaseAdmin(async (client) => {
    const result = await client.query(`
      SELECT 'database' AS kind, datname::text AS object, datacl::text AS acl FROM pg_database WHERE datname = current_database()
      UNION ALL SELECT 'schema', nspname, nspacl::text FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
      UNION ALL SELECT 'relation', c.oid::regclass::text, c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'column', a.attrelid::regclass::text || '.' || a.attname, a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL SELECT 'function', p.oid::regprocedure::text, p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'default', d.oid::text, d.defaclacl::text FROM pg_default_acl d
      ORDER BY 1, 2`);
    return result.rows;
  });
}
async function directGrants() {
  return databaseAdmin(async (client) => {
    const result = await client.query(
      `
      SELECT 'database' AS kind, 'current_database' AS object, NULL::text AS column, a.privilege_type AS privilege, a.is_grantable AS grant_option
      FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE d.datname = current_database() AND a.grantee = $1::regrole
      UNION ALL SELECT 'schema', n.nspname, NULL, a.privilege_type, a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee = $1::regrole
      UNION ALL SELECT 'table', n.nspname || '.' || c.relname, NULL, a.privilege_type, a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee = $1::regrole
      UNION ALL SELECT 'column', n.nspname || '.' || c.relname, col.attname, a.privilege_type, a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute col ON col.attrelid = c.oid CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE a.grantee = $1::regrole`,
      [writerRole],
    );
    return result.rows.map(({ column, ...row }) => (column === null ? row : { ...row, column }));
  });
}

integration('PostgreSQL private Signal snapshot writer role', () => {
  let administrator;
  let databaseCreated = false;
  const createdRoles = [];
  let originalOtherDatabasePrivileges = [];
  let otherDatabasesIsolated = false;
  async function restoreOtherDatabases() {
    if (!otherDatabasesIsolated) return;
    for (const database of new Set(originalOtherDatabasePrivileges.map((row) => row.database))) {
      await administrator.query(
        `REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${quote(database)} FROM PUBLIC`,
      );
      for (const row of originalOtherDatabasePrivileges.filter(
        (value) => value.database === database,
      )) {
        if (!['CONNECT', 'CREATE', 'TEMPORARY'].includes(row.privilege))
          throw new Error('Unexpected fixture database privilege');
        await administrator.query(
          `GRANT ${row.privilege} ON DATABASE ${quote(database)} TO PUBLIC`,
        );
      }
    }
    otherDatabasesIsolated = false;
  }
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1') {
      throw new Error(
        'Signal writer tests require RUNTIME_READER_TEST_ISOLATED_CLUSTER=1 and a disposable PostgreSQL cluster',
      );
    }
    administrator = new Client({ connectionString: adminUrl });
    await administrator.connect();
    const existing = await administrator.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      writerRole,
    ]);
    if (existing.rowCount)
      throw new Error(
        'Isolated test cluster already has hzense_signal_writer; refusing to modify it',
      );
    for (const [role, password, limit] of [
      [ownerRole, ownerPassword, -1],
      [writerRole, writerPassword, 2],
      [auxiliaryRole, `fixture-aux-${suffix}`, -1],
    ]) {
      await administrator.query(
        `CREATE ROLE ${quote(role)} LOGIN NOINHERIT CONNECTION LIMIT ${limit} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
      );
      createdRoles.push(role);
    }
    const adminRole = (await administrator.query('SELECT current_user AS role')).rows[0].role;
    await administrator.query(`REVOKE ${quote(writerRole)} FROM ${quote(adminRole)}`);
    await administrator.query(`CREATE DATABASE ${quote(databaseName)} OWNER ${quote(ownerRole)}`);
    databaseCreated = true;
    originalOtherDatabasePrivileges = (
      await administrator.query(
        `SELECT d.datname AS database,a.privilege_type AS privilege FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname<>$1 AND d.datallowconn AND a.grantee=0 ORDER BY 1,2`,
        [databaseName],
      )
    ).rows;
    otherDatabasesIsolated = true;
    for (const database of new Set(originalOtherDatabasePrivileges.map((row) => row.database))) {
      await administrator.query(
        `REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${quote(database)} FROM PUBLIC`,
      );
    }
    await databaseAdmin((client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: urlFor(ownerRole, ownerPassword) });
    // Isolated fixture setup only: the configurator must never perform these PUBLIC changes.
    await owner((client) =>
      client.query(`
      REVOKE TEMPORARY ON DATABASE ${quote(databaseName)} FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts) VALUES ('writer-source','Fixture source','website',90,ARRAY['example.com']);
      INSERT INTO public.entities(id,type,name) VALUES ('writer-person','person','Fixture person'),('writer-org','company','Fixture organization');
      INSERT INTO public.person_profiles(entity_id) VALUES ('writer-person');
      INSERT INTO public.organization_profiles(entity_id,entity_type) VALUES ('writer-org','company');
      INSERT INTO public.topics(id,title) VALUES ('writer-topic','Fixture topic');
    `),
    );
  }, 30_000);

  afterAll(async () => {
    if (!administrator) return;
    await restoreOtherDatabases();
    if (databaseCreated) {
      await administrator.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [databaseName],
      );
      await administrator.query(`DROP DATABASE ${quote(databaseName)}`);
    }
    for (const role of [...createdRoles].reverse())
      await administrator.query(`DROP ROLE ${quote(role)}`);
    await administrator.end();
  }, 30_000);

  it('rejects non-owner and SET ROLE sessions without changing ACLs', async () => {
    const before = await aclSnapshot();
    await expect(databaseAdmin((client) => client.query(roleSql))).rejects.toThrow('Run as owner');
    await expect(
      databaseAdmin(async (client) => {
        await client.query(`SET ROLE ${quote(ownerRole)}`);
        await client.query(roleSql);
      }),
    ).rejects.toThrow('without SET ROLE');
    expect(await aclSnapshot()).toEqual(before);
  });

  it('requires the pre-created dedicated role rather than creating one', async () => {
    await administrator.query(
      `ALTER ROLE ${quote(writerRole)} RENAME TO ${quote(`hzense_writer_hidden_${suffix}`)}`,
    );
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('pre-create');
    } finally {
      await administrator.query(
        `ALTER ROLE ${quote(`hzense_writer_hidden_${suffix}`)} RENAME TO ${quote(writerRole)}`,
      );
    }
  });

  it.each([
    ['INHERIT', 'NOINHERIT'],
    ['CONNECTION LIMIT 3', 'CONNECTION LIMIT 2'],
    ['NOLOGIN', 'LOGIN'],
    ['CREATEDB', 'NOCREATEDB'],
    ['BYPASSRLS', 'NOBYPASSRLS'],
    ['CREATEROLE', 'NOCREATEROLE'],
    ['REPLICATION', 'NOREPLICATION'],
    ['SUPERUSER', 'NOSUPERUSER'],
  ])('rejects role attribute %s without repairing it', async (unsafe, safe) => {
    await administrator.query(`ALTER ROLE ${quote(writerRole)} ${unsafe}`);
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'no privileged attributes',
      );
    } finally {
      await administrator.query(`ALTER ROLE ${quote(writerRole)} ${safe}`);
    }
  });

  it.each(['incoming', 'outgoing'])('rejects %s role membership', async (direction) => {
    const granted = direction === 'incoming' ? writerRole : auxiliaryRole;
    const member = direction === 'incoming' ? auxiliaryRole : writerRole;
    await administrator.query(`GRANT ${quote(granted)} TO ${quote(member)}`);
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('role memberships');
    } finally {
      await administrator.query(`REVOKE ${quote(granted)} FROM ${quote(member)}`);
    }
  });

  it('rejects preconfigured trigger-bypass role settings', async () => {
    await administrator.query(
      `ALTER ROLE ${quote(writerRole)} SET session_replication_role = replica`,
    );
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'configuration settings',
      );
    } finally {
      await administrator.query(`ALTER ROLE ${quote(writerRole)} RESET session_replication_role`);
    }
  });

  it('rejects missing 0007 marker without granting privileges', async () => {
    await owner((client) =>
      client.query(
        "UPDATE public.hzense_schema_migrations SET name='held-0007' WHERE name='0007_signal_version_immutability.sql'",
      ),
    );
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('must be applied');
    } finally {
      await owner((client) =>
        client.query(
          "UPDATE public.hzense_schema_migrations SET name='0007_signal_version_immutability.sql' WHERE name='held-0007'",
        ),
      );
    }
  });

  it.each([
    [
      'PUBLIC database TEMP',
      `GRANT TEMPORARY ON DATABASE ${quote(databaseName)} TO PUBLIC`,
      `REVOKE TEMPORARY ON DATABASE ${quote(databaseName)} FROM PUBLIC`,
    ],
    [
      'PUBLIC table read',
      'GRANT SELECT ON public.signals TO PUBLIC',
      'REVOKE SELECT ON public.signals FROM PUBLIC',
    ],
    [
      'PUBLIC protected column',
      'GRANT INSERT (status) ON public.signals TO PUBLIC',
      'REVOKE INSERT (status) ON public.signals FROM PUBLIC',
    ],
    [
      'writer protected column',
      'GRANT INSERT (status) ON public.signals TO hzense_signal_writer',
      'REVOKE INSERT (status) ON public.signals FROM hzense_signal_writer',
    ],
    [
      'PUBLIC guard execution',
      'GRANT EXECUTE ON FUNCTION public.hzense_guard_sealed_row() TO PUBLIC',
      'REVOKE EXECUTE ON FUNCTION public.hzense_guard_sealed_row() FROM PUBLIC',
    ],
    [
      'writer unsafe default',
      'ALTER DEFAULT PRIVILEGES GRANT INSERT ON TABLES TO hzense_signal_writer',
      'ALTER DEFAULT PRIVILEGES REVOKE INSERT ON TABLES FROM hzense_signal_writer',
    ],
    [
      'PUBLIC unsafe default',
      'ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
      'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    ],
    [
      'writer partial direct ACL',
      'GRANT SELECT ON public.signals TO hzense_signal_writer',
      'REVOKE SELECT ON public.signals FROM hzense_signal_writer',
    ],
    [
      'writer grant option',
      'GRANT SELECT ON public.signals TO hzense_signal_writer WITH GRANT OPTION',
      'REVOKE SELECT ON public.signals FROM hzense_signal_writer',
    ],
  ])('fails closed for %s and leaves existing ACLs untouched', async (_name, unsafe, cleanup) => {
    await owner((client) => client.query(unsafe));
    try {
      const before = await aclSnapshot();
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow();
      expect(await aclSnapshot()).toEqual(before);
    } finally {
      await owner((client) => client.query(cleanup));
    }
  });

  it('rejects writer ownership, extra-schema access and non-application sequence reads', async () => {
    await owner((client) =>
      client.query('CREATE SCHEMA writer_extra; CREATE SEQUENCE writer_extra.fixture_sequence'),
    );
    try {
      await owner((client) =>
        client.query('GRANT USAGE ON SCHEMA writer_extra TO hzense_signal_writer'),
      );
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('schema privileges');
      await owner((client) =>
        client.query(
          'REVOKE USAGE ON SCHEMA writer_extra FROM hzense_signal_writer; GRANT SELECT ON SEQUENCE writer_extra.fixture_sequence TO hzense_signal_writer',
        ),
      );
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'table/sequence privilege',
      );
      await owner((client) =>
        client.query(
          'REVOKE SELECT ON SEQUENCE writer_extra.fixture_sequence FROM hzense_signal_writer',
        ),
      );
      await databaseAdmin((client) =>
        client.query('ALTER SEQUENCE writer_extra.fixture_sequence OWNER TO hzense_signal_writer'),
      );
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('must not own');
    } finally {
      await databaseAdmin((client) => client.query('DROP SCHEMA writer_extra CASCADE'));
    }
  });

  it('rejects direct access to another database', async () => {
    const adminDatabase = new URL(adminUrl).pathname.slice(1);
    await administrator.query(
      `GRANT CONNECT ON DATABASE ${quote(adminDatabase)} TO ${quote(writerRole)}`,
    );
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow('database privileges');
    } finally {
      await administrator.query(
        `REVOKE CONNECT ON DATABASE ${quote(adminDatabase)} FROM ${quote(writerRole)}`,
      );
    }
  });

  it('rejects effective other-database PUBLIC access without normalizing it', async () => {
    const adminDatabase = new URL(adminUrl).pathname.slice(1);
    await administrator.query(
      `GRANT CONNECT, TEMPORARY ON DATABASE ${quote(adminDatabase)} TO PUBLIC`,
    );
    try {
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'another connectable database',
      );
      const acl = (
        await administrator.query(
          "SELECT has_database_privilege($1,$2,'CONNECT') AS connect,has_database_privilege($1,$2,'TEMPORARY') AS temporary",
          [writerRole, adminDatabase],
        )
      ).rows[0];
      expect(acl).toEqual({ connect: true, temporary: true });
    } finally {
      await administrator.query(
        `REVOKE CONNECT, TEMPORARY ON DATABASE ${quote(adminDatabase)} FROM PUBLIC`,
      );
    }
  });

  it('resolves catalog objects safely despite an owner temporary-schema shadow', async () => {
    await owner(async (client) => {
      await client.query(
        'CREATE TEMP TABLE pg_roles(poison text); CREATE TEMP TABLE pg_database(poison text)',
      );
      await client.query(roleSql);
    });
    expect(inspectSignalWriterGrants(await directGrants())).toEqual({ ok: true, problems: [] });
    // This is the first successful configuration, so following tests exercise re-entry.
  });

  it('installs exactly 79 direct grants while preserving PUBLIC and peer ACLs', async () => {
    await owner((client) =>
      client.query('GRANT SELECT ON public.topics TO ' + quote(auxiliaryRole)),
    );
    const publicAndPeer = async () =>
      databaseAdmin(
        async (client) =>
          (
            await client.query(
              `SELECT c.relname,a.grantee,a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND a.grantee IN (0,$1::regrole) ORDER BY 1,2,3`,
              [auxiliaryRole],
            )
          ).rows,
      );
    const before = await publicAndPeer();
    await owner((client) => client.query(roleSql));
    expect(inspectSignalWriterGrants(await directGrants())).toEqual({ ok: true, problems: [] });
    expect(await publicAndPeer()).toEqual(before);
    const after = await aclSnapshot();
    await owner((client) => client.query(roleSql));
    expect(await aclSnapshot()).toEqual(after);
  });

  it('rejects partial reconfiguration rather than silently restoring a missing grant', async () => {
    await owner((client) =>
      client.query('REVOKE INSERT (summary) ON public.signal_versions FROM hzense_signal_writer'),
    );
    try {
      const before = await aclSnapshot();
      await expect(owner((client) => client.query(roleSql))).rejects.toThrow(
        'missing required column',
      );
      expect(await aclSnapshot()).toEqual(before);
    } finally {
      await owner((client) =>
        client.query('GRANT INSERT (summary) ON public.signal_versions TO hzense_signal_writer'),
      );
    }
  });

  it('assembles a UTC-dated private snapshot in a non-UTC session with inbox/pending defaults', async () => {
    await writer((client) =>
      client.query(`
      BEGIN;
      SET LOCAL TIME ZONE 'Europe/Berlin';
      INSERT INTO public.signals(id,title,type,occurred_at,source_id,source_url,summary,importance,strength,confidence,novelty)
        VALUES ('writer-signal','Fixture','technology','2026-01-01T00:00:00Z','writer-source','https://example.com/fixture','Fixture',3,3,0.8,0.5);
      INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at)
        VALUES ('writer-evidence','writer-source','https://example.com/fixture','section','Fixture evidence','${'a'.repeat(64)}','2026-01-02T00:00:00Z');
      INSERT INTO public.signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash)
        VALUES ('writer-signal',1,'Fixture','technology','2026-01-01T00:00:00Z','day','Fixture date','2026-01-02T00:00:00Z','Fixture',3,3,0.8,0.5,'Initial assembly','manual',NULL,'${'b'.repeat(64)}');
      INSERT INTO public.signal_version_evidence(signal_id,version,evidence_id,claim,relation)
        VALUES ('writer-signal',1,'writer-evidence','Fixture claim','supports');
      INSERT INTO public.signal_version_people(signal_id,version,person_id,evidence_id,event_role)
        VALUES ('writer-signal',1,'writer-person','writer-evidence','participant');
      INSERT INTO public.signal_version_organizations(signal_id,version,organization_id,evidence_id,event_role)
        VALUES ('writer-signal',1,'writer-org','writer-evidence','subject');
      INSERT INTO public.signal_version_topics(signal_id,version,topic_id) VALUES ('writer-signal',1,'writer-topic');
      INSERT INTO public.signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
        VALUES ('writer-signal','writer-fixture-event',1,'writer-evidence','Fixture identity');
      COMMIT;
    `),
    );
    const state = await writer(
      async (client) =>
        (
          await client.query(
            `SELECT s.status,e.verification_status AS evidence_status,p.verification_status AS person_status,o.verification_status AS organization_status,v.created_xid::text AS version_xid,e.created_xid::text AS evidence_xid,i.created_xid::text AS identity_xid FROM public.signals s JOIN public.signal_versions v ON v.signal_id=s.id JOIN public.signal_version_people p ON p.signal_id=s.id JOIN public.signal_version_organizations o ON o.signal_id=s.id JOIN public.public_source_evidence e ON e.id=p.evidence_id JOIN public.signal_event_identities i ON i.signal_id=s.id WHERE s.id='writer-signal'`,
          )
        ).rows[0],
    );
    expect(state).toMatchObject({
      status: 'inbox',
      evidence_status: 'pending',
      person_status: 'pending',
      organization_status: 'pending',
    });
    expect(state.version_xid).toBe(state.evidence_xid);
    expect(state.version_xid).toBe(state.identity_xid);
  });

  it.each([
    "INSERT INTO public.signals(id,status) VALUES ('forbidden-signal','accepted')",
    "INSERT INTO public.public_source_evidence(id,verification_status) VALUES ('forbidden-evidence','verified')",
    "INSERT INTO public.signal_versions(signal_id,version,created_xid) VALUES ('writer-signal',2,pg_current_xact_id())",
    "INSERT INTO public.signal_versions(signal_id,version,created_at) VALUES ('writer-signal',2,now())",
    "INSERT INTO public.signal_event_identities(signal_id,created_xid) VALUES ('writer-signal',pg_current_xact_id())",
    "INSERT INTO public.signal_version_people(signal_id,verification_status) VALUES ('writer-signal','verified')",
    "UPDATE public.signals SET status='accepted' WHERE id='writer-signal'",
    "UPDATE public.public_source_evidence SET verification_status='verified' WHERE id='writer-evidence'",
    "UPDATE public.signal_versions SET summary='tamper' WHERE signal_id='writer-signal'",
    "DELETE FROM public.signal_versions WHERE signal_id='writer-signal'",
    'TRUNCATE public.signal_versions',
    'ALTER TABLE public.signal_versions DISABLE TRIGGER ALL',
    'SET session_replication_role=replica',
    `SET ROLE ${quote(ownerRole)}`,
    'SELECT public.hzense_guard_sealed_row()',
    'SELECT public.hzense_guard_version_edge()',
    'SELECT public.hzense_reject_sealed_truncate()',
    "INSERT INTO public.topics(id,title) VALUES ('forbidden-topic','No')",
    "INSERT INTO public.person_profiles(entity_id) VALUES ('writer-person')",
    "INSERT INTO public.sources(id,name,type,trust_score) VALUES ('forbidden-source','No','website',0)",
    'SELECT * FROM public.search_documents',
    'DELETE FROM public.search_documents',
    "UPDATE public.content_registry SET status='published'",
  ])('cannot review, modify history or expand authority: %s', async (statement) => {
    await expect(writer((client) => client.query(statement))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('cannot append version edges after the parent creation transaction commits', async () => {
    await expect(
      writer((client) =>
        client.query(
          "INSERT INTO public.signal_version_topics(signal_id,version,topic_id) VALUES ('writer-signal',1,'writer-topic')",
        ),
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it.each([
    ...['signal_publication_state', 'signal_publication_outbox'].flatMap((table) => [
      `SELECT * FROM public.${table}`,
      `INSERT INTO public.${table} DEFAULT VALUES`,
      `UPDATE public.${table} SET status='published'`,
      `DELETE FROM public.${table}`,
    ]),
    'SELECT public.hzense_guard_publication_receipt()',
    'SELECT public.hzense_check_publication_pair()',
    ...[
      ['signal_publication_control', 'publication_enabled'],
      ['signal_publication_tasks', 'publication_enabled'],
      ['signal_publication_authorizations', 'can_publish'],
      ['signal_publication_runs', 'fencing_token'],
    ].flatMap(([table, column]) => [
      `SELECT * FROM public.${table}`,
      `INSERT INTO public.${table} DEFAULT VALUES`,
      `UPDATE public.${table} SET ${column}=${column}`,
      `DELETE FROM public.${table}`,
      `TRUNCATE public.${table}`,
    ]),
    'SELECT public.hzense_guard_publication_run()',
  ])('keeps private publication storage inaccessible to snapshot writer: %s', async (statement) => {
    await expect(writer((client) => client.query(statement))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('cannot grant permissions or call guards directly', async () => {
    const before = await aclSnapshot();
    // PostgreSQL GRANT without grant option may warn instead of throwing; assert its actual effect.
    await writer((client) => client.query('GRANT SELECT ON public.signal_versions TO PUBLIC'));
    expect(await aclSnapshot()).toEqual(before);
    const guards = await writer(
      async (client) =>
        (
          await client.query(
            "SELECT has_function_privilege(current_user,'public.hzense_guard_sealed_row()','EXECUTE') AS row_guard,has_function_privilege(current_user,'public.hzense_guard_version_edge()','EXECUTE') AS edge_guard,has_function_privilege(current_user,'public.hzense_reject_sealed_truncate()','EXECUTE') AS truncate_guard",
          )
        ).rows[0],
    );
    expect(guards).toEqual({ row_guard: false, edge_guard: false, truncate_guard: false });
  });
});
