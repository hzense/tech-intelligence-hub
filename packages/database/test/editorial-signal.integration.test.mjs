import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  saveEditorialSignal,
  readEditorialSignal,
  previewEditorialResources,
} from '../src/editorial-signal-store.mjs';
import { normalizeEditorialRequest } from '../src/editorial-signal-contract.mjs';
import { assertEditorialRole } from '../src/editorial-signal-role.mjs';
import { assertCandidateReviewRole } from '../src/candidate-review-role.mjs';
import { editorialVectorQuery } from '../src/editorial-vector-query.mjs';
import { editorialFixture } from './editorial-signal.test.mjs';
import { resourceFixture } from './editorial-resources.test.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('editorial publication persistence and isolated capabilities', () => {
  let admin,
    pool,
    writer,
    reader,
    reviewer,
    created = false,
    rolesCreated = false,
    reviewerCreated = false;
  const db = `hzense_editorial_${process.pid}_${Date.now()}`;
  const roles = ['hzense_editorial_writer', 'hzense_editorial_reader'];
  const ambient = [];
  const sql = async (name) => readFile(new URL(`../../../db/${name}`, import.meta.url), 'utf8');
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    if (
      (await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [roles]))
        .rows.length
    )
      throw new Error('Editorial test roles already exist; refusing modification');
    const otherDatabases = (
      await admin.query(
        "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
      )
    ).rows;
    if (otherDatabases.length) throw new Error('Refuse cluster containing unrelated databases');
    for (const name of ['postgres', 'template1']) {
      const privileges = (
        await admin.query(
          "SELECT a.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0",
          [name],
        )
      ).rows.map((row) => row.privilege_type);
      ambient.push({ name, privileges });
      await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    }
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${db}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(
      'CREATE TABLE public.signal_generation_runs(id uuid PRIMARY KEY,owner_id text NOT NULL,status text,deleted_at timestamptz); CREATE TABLE public.topics(id text PRIMARY KEY,title text,runtime_enabled boolean,status text); CREATE TABLE public.hzense_schema_migrations(name text PRIMARY KEY,checksum text);',
    );
    await pool.query(`CREATE TABLE public.entities(id text PRIMARY KEY,name text NOT NULL,type text NOT NULL,status text NOT NULL,aliases text[] NOT NULL DEFAULT '{}',metadata jsonb NOT NULL DEFAULT '{}',UNIQUE(id,type));
      CREATE TABLE public.person_profiles(entity_id text PRIMARY KEY,entity_type text NOT NULL DEFAULT 'person' CHECK(entity_type='person'),FOREIGN KEY(entity_id,entity_type) REFERENCES public.entities(id,type));
      CREATE TABLE public.organization_profiles(entity_id text PRIMARY KEY,entity_type text NOT NULL CHECK(entity_type IN ('company','institution')),FOREIGN KEY(entity_id,entity_type) REFERENCES public.entities(id,type));`);
    await pool.query(await sql('migrations/0025_editorial_signal_publication.sql'));
    await pool.query(
      "INSERT INTO hzense_schema_migrations VALUES('0025_editorial_signal_publication.sql','d4ce2249d08f675cf0ea4a614790aa5c1cc2e793998a545a76a60f898a97e2ae'); INSERT INTO topics VALUES('ai','AI',true,'watching');",
    );
    await pool.query(`REVOKE CREATE,TEMPORARY ON DATABASE "${db}" FROM PUBLIC`);
    await pool.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
    await admin.query(await sql('roles/create_editorial_roles.sql'));
    rolesCreated = true;
    for (const role of roles)
      await admin.query(`ALTER ROLE ${role} PASSWORD 'editorial-test-only'`);
    await pool.query(await sql('roles/configure_editorial_roles.sql'));
    url.username = roles[0];
    url.password = 'editorial-test-only';
    writer = new pg.Pool({ connectionString: url.toString(), max: 2 });
    url.username = roles[1];
    reader = new pg.Pool({ connectionString: url.toString(), max: 2 });
  });
  afterAll(async () => {
    await reviewer?.end();
    await writer?.end();
    await reader?.end();
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    if (rolesCreated) for (const role of roles) await admin.query(`DROP ROLE ${role}`);
    if (reviewerCreated) await admin.query('DROP ROLE hzense_candidate_reviewer');
    for (const { name, privileges } of ambient) {
      if (privileges.length)
        await admin.query(`GRANT ${privileges.join(',')} ON DATABASE "${name}" TO PUBLIC`);
    }
    await admin?.end();
  });
  it('rejects cross-database PUBLIC, direct and dormant object privileges for both roles', async () => {
    const sentinel = `${db}_other`;
    let other;
    await admin.query(`CREATE DATABASE "${sentinel}" TEMPLATE template0`);
    try {
      const url = new URL(adminUrl);
      url.pathname = `/${sentinel}`;
      other = new pg.Client({ connectionString: url.toString() });
      await other.connect();
      await other.query('CREATE TABLE private_sentinel(id integer)');
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        const roleName = `hzense_editorial_${role}`;
        try {
          for (const privilege of ['CONNECT', 'CREATE', 'TEMPORARY']) {
            for (const grantee of ['PUBLIC', roleName]) {
              await admin.query(`REVOKE ALL ON DATABASE "${sentinel}" FROM PUBLIC, ${roleName}`);
              await admin.query(`GRANT ${privilege} ON DATABASE "${sentinel}" TO ${grantee}`);
              await expect(assertEditorialRole(client, role)).rejects.toThrow(
                'editorial_role_invalid',
              );
              await admin.query(`REVOKE ALL ON DATABASE "${sentinel}" FROM ${grantee}`);
              await assertEditorialRole(client, role);
            }
          }
          await other.query(`GRANT SELECT ON private_sentinel TO ${roleName}`);
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
          await other.query(`REVOKE SELECT ON private_sentinel FROM ${roleName}`);
          await assertEditorialRole(client, role);
        } finally {
          client.release();
        }
      }
    } finally {
      await other?.end();
      await admin.query(`DROP DATABASE "${sentinel}"`);
    }
  });
  it('provisions exact direct-login capabilities, rejects escalation and keeps raw history private', async () => {
    for (const [connection, role] of [
      [writer, 'writer'],
      [reader, 'reader'],
    ]) {
      const client = await connection.connect();
      try {
        await assertEditorialRole(client, role);
      } finally {
        client.release();
      }
    }
    await expect(reader.query('SELECT * FROM editorial_signal_revisions')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(reader.query('SELECT * FROM signal_generation_runs')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(writer.query('SELECT * FROM editorial_public_signals')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(writer.query('DELETE FROM editorial_signal_revisions')).rejects.toMatchObject({
      code: '42501',
    });
    await pool.query(
      'GRANT SELECT ON public.editorial_signal_revisions TO hzense_editorial_reader',
    );
    const client = await reader.connect();
    try {
      await expect(assertEditorialRole(client, 'reader')).rejects.toThrow('editorial_role_invalid');
    } finally {
      client.release();
    }
    await pool.query(
      'REVOKE SELECT ON public.editorial_signal_revisions FROM hzense_editorial_reader',
    );
  });
  it('rejects shared parameter privileges for both application roles', async () => {
    for (const [connection, role] of [
      [reader, 'reader'],
      [writer, 'writer'],
    ]) {
      const client = await connection.connect();
      const roleName = `hzense_editorial_${role}`;
      try {
        for (const privilege of ['SET', 'ALTER SYSTEM']) {
          await admin.query(`GRANT ${privilege} ON PARAMETER work_mem TO ${roleName}`);
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
          await admin.query(`REVOKE ${privilege} ON PARAMETER work_mem FROM ${roleName}`);
          await assertEditorialRole(client, role);
        }
      } finally {
        await admin.query(`REVOKE ALL ON PARAMETER work_mem FROM ${roleName}`);
        client.release();
      }
    }
  });
  it('rejects direct system catalog table, column and schema ACLs', async () => {
    for (const [connection, role] of [
      [reader, 'reader'],
      [writer, 'writer'],
    ]) {
      const client = await connection.connect();
      const roleName = `hzense_editorial_${role}`;
      try {
        for (const privilege of [
          'SELECT ON pg_catalog.pg_authid',
          'SELECT(rolpassword) ON pg_catalog.pg_authid',
          'USAGE ON SCHEMA pg_catalog',
        ]) {
          await pool.query(`GRANT ${privilege} TO ${roleName}`);
          try {
            await expect(assertEditorialRole(client, role)).rejects.toThrow(
              'editorial_role_invalid',
            );
          } finally {
            await pool.query(`REVOKE ${privilege} FROM ${roleName}`);
          }
          await assertEditorialRole(client, role);
        }
      } finally {
        client.release();
      }
    }
  });
  it('retains initial system PUBLIC privileges but rejects new table, column and schema grants', async () => {
    for (const privilege of [
      'SELECT ON pg_catalog.pg_authid',
      'SELECT(rolpassword) ON pg_catalog.pg_authid',
      'UPDATE ON pg_catalog.pg_class',
      'CREATE ON SCHEMA pg_catalog',
      'UPDATE ON information_schema.sql_features',
    ]) {
      await pool.query(`GRANT ${privilege} TO PUBLIC`);
      try {
        for (const [connection, role] of [
          [reader, 'reader'],
          [writer, 'writer'],
        ]) {
          const client = await connection.connect();
          try {
            await expect(assertEditorialRole(client, role)).rejects.toThrow(
              'editorial_role_invalid',
            );
          } finally {
            client.release();
          }
        }
      } finally {
        await pool.query(`REVOKE ${privilege} FROM PUBLIC`);
      }
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await assertEditorialRole(client, role);
        } finally {
          client.release();
        }
      }
    }
    await pool.query('CREATE TABLE information_schema.editorial_test_only(id integer)');
    try {
      await pool.query('GRANT SELECT ON information_schema.editorial_test_only TO PUBLIC');
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.query('DROP TABLE information_schema.editorial_test_only');
    }
  });
  it('rejects extra PUBLIC system function, large-object and tablespace capabilities', async () => {
    const expectRejected = async () => {
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
        } finally {
          client.release();
        }
      }
    };
    await pool.query('GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO PUBLIC');
    try {
      await expectRejected();
    } finally {
      await pool.query('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) FROM PUBLIC');
    }
    await pool.query(
      'CREATE FUNCTION pg_catalog.editorial_test_only() RETURNS integer LANGUAGE sql AS $$SELECT 1$$',
    );
    try {
      await expectRejected();
    } finally {
      await pool.query('DROP FUNCTION pg_catalog.editorial_test_only()');
    }
    const oid = (await pool.query('SELECT lo_create(0) AS oid')).rows[0].oid;
    try {
      await pool.query(`GRANT SELECT ON LARGE OBJECT ${Number(oid)} TO PUBLIC`);
      await expectRejected();
    } finally {
      await pool.query('SELECT lo_unlink($1)', [oid]);
    }
    await pool.query('CREATE FOREIGN DATA WRAPPER editorial_test_fdw NO HANDLER');
    try {
      await pool.query(
        'CREATE SERVER editorial_test_server FOREIGN DATA WRAPPER editorial_test_fdw',
      );
      try {
        for (const target of [
          'FOREIGN SERVER editorial_test_server',
          'FOREIGN DATA WRAPPER editorial_test_fdw',
        ]) {
          await pool.query(`GRANT USAGE ON ${target} TO PUBLIC`);
          try {
            await expectRejected();
          } finally {
            await pool.query(`REVOKE USAGE ON ${target} FROM PUBLIC`);
          }
        }
      } finally {
        await pool.query('DROP SERVER editorial_test_server');
      }
    } finally {
      await pool.query('DROP FOREIGN DATA WRAPPER editorial_test_fdw');
    }
    const initialPublic = (
      await admin.query(
        "SELECT 1 FROM pg_tablespace t CROSS JOIN LATERAL aclexplode(t.spcacl) a WHERE t.spcname='pg_default' AND a.grantee=0",
      )
    ).rows;
    expect(initialPublic).toEqual([]);
    await admin.query('GRANT CREATE ON TABLESPACE pg_default TO PUBLIC');
    try {
      await expectRejected();
    } finally {
      await admin.query('REVOKE CREATE ON TABLESPACE pg_default FROM PUBLIC');
    }
    for (const [connection, role] of [
      [reader, 'reader'],
      [writer, 'writer'],
    ]) {
      const client = await connection.connect();
      try {
        await assertEditorialRole(client, role);
      } finally {
        client.release();
      }
    }
  });
  it('requires usable non-grantable public schema and rejects unrelated schema access', async () => {
    await pool.query('CREATE SCHEMA editorial_extra');
    try {
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        const roleName = `hzense_editorial_${role}`;
        try {
          await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${roleName}`);
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
          await pool.query(`GRANT USAGE ON SCHEMA public TO ${roleName} WITH GRANT OPTION`);
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
          await pool.query(`REVOKE GRANT OPTION FOR USAGE ON SCHEMA public FROM ${roleName}`);
          await assertEditorialRole(client, role);
          await pool.query(`GRANT USAGE ON SCHEMA editorial_extra TO ${roleName}`);
          await expect(assertEditorialRole(client, role)).rejects.toThrow('editorial_role_invalid');
          await pool.query(`REVOKE USAGE ON SCHEMA editorial_extra FROM ${roleName}`);
          await assertEditorialRole(client, role);
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.query('DROP SCHEMA editorial_extra');
    }
  });
  it('PostgreSQL denies operator and cast execution when the implementation EXECUTE is revoked', async () => {
    const assertBoth = async (query) => {
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await assertEditorialRole(client, role);
          await expect(client.query(query)).rejects.toMatchObject({ code: '42501' });
        } finally {
          client.release();
        }
      }
    };
    await pool.query(
      'CREATE FUNCTION public.editorial_hidden_operator(text,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT true$$',
    );
    await pool.query(
      'REVOKE EXECUTE ON FUNCTION public.editorial_hidden_operator(text,text) FROM PUBLIC',
    );
    await pool.query(
      'CREATE OPERATOR public.=== (LEFTARG=text,RIGHTARG=text,FUNCTION=public.editorial_hidden_operator)',
    );
    try {
      await assertBoth("SELECT 'a' OPERATOR(public.===) 'b' AS value");
    } finally {
      await pool.query('DROP OPERATOR public.=== (text,text)');
      await pool.query('DROP FUNCTION public.editorial_hidden_operator(text,text)');
    }
    await pool.query(
      "CREATE FUNCTION public.editorial_hidden_cast(integer) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$SELECT '00000000-0000-0000-0000-000000000000'::uuid$$",
    );
    await pool.query(
      'REVOKE EXECUTE ON FUNCTION public.editorial_hidden_cast(integer) FROM PUBLIC',
    );
    await pool.query(
      'CREATE CAST (integer AS uuid) WITH FUNCTION public.editorial_hidden_cast(integer)',
    );
    try {
      await assertBoth('SELECT 1::uuid AS value');
    } finally {
      await pool.query('DROP CAST (integer AS uuid)');
      await pool.query('DROP FUNCTION public.editorial_hidden_cast(integer)');
    }
    for (const [connection, role] of [
      [reader, 'reader'],
      [writer, 'writer'],
    ]) {
      const client = await connection.connect();
      try {
        await assertEditorialRole(client, role);
      } finally {
        client.release();
      }
    }
  });
  it('accepts only the audited vector extension and rejects attached application functions', async () => {
    await pool.query("CREATE EXTENSION vector VERSION '0.8.6'");
    try {
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await assertEditorialRole(client, role);
        } finally {
          client.release();
        }
      }
      await pool.query(
        'CREATE FUNCTION public.editorial_extra_function() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$',
      );
      for (const extension of ['plpgsql', 'vector']) {
        await pool.query(
          `ALTER EXTENSION ${extension} ADD FUNCTION public.editorial_extra_function()`,
        );
        try {
          for (const [connection, role] of [
            [reader, 'reader'],
            [writer, 'writer'],
          ]) {
            const client = await connection.connect();
            try {
              await expect(assertEditorialRole(client, role)).rejects.toThrow(
                'editorial_role_invalid',
              );
            } finally {
              client.release();
            }
          }
        } finally {
          await pool.query(
            `ALTER EXTENSION ${extension} DROP FUNCTION public.editorial_extra_function()`,
          );
        }
      }
      await pool.query('ALTER FUNCTION public.editorial_extra_function() SECURITY INVOKER');
      await pool.query('ALTER EXTENSION vector DROP FUNCTION public.vector_dims(public.vector)');
      try {
        await pool.query(
          'REVOKE EXECUTE ON FUNCTION public.vector_dims(public.vector) FROM PUBLIC',
        );
        await pool.query('ALTER EXTENSION vector ADD FUNCTION public.editorial_extra_function()');
        try {
          for (const [connection, role] of [
            [reader, 'reader'],
            [writer, 'writer'],
          ]) {
            const client = await connection.connect();
            try {
              await expect(assertEditorialRole(client, role)).rejects.toThrow(
                'editorial_role_invalid',
              );
            } finally {
              client.release();
            }
          }
        } finally {
          await pool.query(
            'ALTER EXTENSION vector DROP FUNCTION public.editorial_extra_function()',
          );
        }
      } finally {
        await pool.query('ALTER EXTENSION vector ADD FUNCTION public.vector_dims(public.vector)');
        await pool.query('GRANT EXECUTE ON FUNCTION public.vector_dims(public.vector) TO PUBLIC');
        await pool.query('DROP FUNCTION public.editorial_extra_function()');
      }
      const sumProc = async () => {
        const row = (await pool.query(editorialVectorQuery)).rows.find(
          (row) => row.name === 'sum' && row.args[0] === 'public.vector',
        );
        const { aggregate, ...proc } = row;
        expect(aggregate).toBeTruthy();
        return proc;
      };
      const originalProc = await sumProc();
      await pool.query(
        'CREATE FUNCTION public.editorial_extra_trans(public.vector, public.vector) RETURNS public.vector LANGUAGE sql SECURITY DEFINER AS $$SELECT $1$$',
      );
      await pool.query(
        'REVOKE EXECUTE ON FUNCTION public.editorial_extra_trans(public.vector, public.vector) FROM PUBLIC',
      );
      await pool.query('ALTER EXTENSION vector DROP AGGREGATE public.sum(public.vector)');
      await pool.query('DROP AGGREGATE public.sum(public.vector)');
      await pool.query(
        'CREATE AGGREGATE public.sum(public.vector) (SFUNC=public.editorial_extra_trans, STYPE=public.vector, COMBINEFUNC=public.vector_add, PARALLEL=SAFE)',
      );
      await pool.query('ALTER EXTENSION vector ADD AGGREGATE public.sum(public.vector)');
      try {
        expect(await sumProc()).toEqual(originalProc);
        for (const [connection, role] of [
          [reader, 'reader'],
          [writer, 'writer'],
        ]) {
          const client = await connection.connect();
          try {
            await expect(assertEditorialRole(client, role)).rejects.toThrow(
              'editorial_role_invalid',
            );
          } finally {
            client.release();
          }
        }
      } finally {
        await pool.query('ALTER EXTENSION vector DROP AGGREGATE public.sum(public.vector)');
        await pool.query('DROP AGGREGATE public.sum(public.vector)');
        await pool.query(
          'CREATE AGGREGATE public.sum(public.vector) (SFUNC=public.vector_add, STYPE=public.vector, COMBINEFUNC=public.vector_add, PARALLEL=SAFE)',
        );
        await pool.query('ALTER EXTENSION vector ADD AGGREGATE public.sum(public.vector)');
        await pool.query(
          'DROP FUNCTION public.editorial_extra_trans(public.vector, public.vector)',
        );
      }
      for (const [connection, role] of [
        [reader, 'reader'],
        [writer, 'writer'],
      ]) {
        const client = await connection.connect();
        try {
          await assertEditorialRole(client, role);
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.query('DROP EXTENSION vector');
    }
  });
  it('publishes one immutable receipt, compares revisions, and withdraws without reviving older publications', async () => {
    const { request, material } = editorialFixture();
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      request.runId,
    ]);
    const args = { pool: writer, owner: 'owner', request, material };
    const first = await saveEditorialSignal(args);
    expect(first.revision).toBe(1);
    expect(await saveEditorialSignal(args)).toEqual(first);
    await expect(saveEditorialSignal({ ...args, owner: 'other' })).rejects.toThrow('not_found');
    expect(
      await readEditorialSignal({
        pool: writer,
        owner: 'other',
        runId: request.runId,
        candidateIndex: 0,
      }),
    ).toBeNull();
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...request, content: { ...request.content, persons: ['Other'] } },
      }),
    ).rejects.toThrow('request_id_conflict');
    const publicRow = (await reader.query('SELECT * FROM editorial_public_signals')).rows[0];
    expect(Object.keys(publicRow)).toEqual(['signal_id', 'revision', 'content', 'published_at']);
    expect(publicRow.signal_id).toMatch(/^editorial-[a-f0-9]{32}$/);
    expect(publicRow.signal_id).not.toContain(request.runId);
    await expect(
      pool.query('UPDATE signal_generation_runs SET deleted_at=now() WHERE id=$1', [request.runId]),
    ).rejects.toThrow('published_candidate_delete_forbidden');
    await expect(pool.query('UPDATE editorial_signal_revisions SET revision=5')).rejects.toThrow(
      'append-only',
    );
    await expect(pool.query('TRUNCATE editorial_signal_revisions')).rejects.toThrow('append-only');
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...request, requestId: randomUUID(), expectedRevision: 1, action: 'draft' },
      }),
    ).rejects.toThrow('published_draft_forbidden');
    const race = await Promise.allSettled(
      [0, 1].map(() =>
        saveEditorialSignal({
          ...args,
          request: { ...request, requestId: randomUUID(), expectedRevision: 1 },
        }),
      ),
    );
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await saveEditorialSignal({
      ...args,
      request: {
        ...request,
        requestId: randomUUID(),
        expectedRevision: 2,
        action: 'withdraw',
        content: { ...request.content, persons: [], eventDate: null },
      },
    });
    expect((await reader.query('SELECT * FROM editorial_public_signals')).rows).toEqual([]);
    const latest = await readEditorialSignal({
      pool: writer,
      owner: 'owner',
      runId: request.runId,
      candidateIndex: 0,
    });
    expect(latest.content.persons).toEqual(['Person']);
    expect(latest.action).toBe('withdraw');
    await expect(
      saveEditorialSignal({
        ...args,
        request: {
          ...request,
          requestId: randomUUID(),
          expectedRevision: 3,
          content: { ...request.content, topics: [{ id: 'ai', title: 'Forged' }] },
        },
      }),
    ).rejects.toThrow('topic_reference_invalid');
    await pool.query('UPDATE signal_generation_runs SET deleted_at=now() WHERE id=$1', [
      request.runId,
    ]);
    expect(
      await readEditorialSignal({
        pool: writer,
        owner: 'owner',
        runId: request.runId,
        candidateIndex: 0,
      }),
    ).toBeNull();
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...request, requestId: randomUUID(), expectedRevision: 3 },
      }),
    ).rejects.toThrow('not_found');
  });
  it('replays legacy publication after a later revision removes its unavailable source, but requires classification for new writes', async () => {
    const { request, material } = editorialFixture();
    request.runId = randomUUID();
    request.requestId = randomUUID();
    delete request.content.signalType;
    const legacy = normalizeEditorialRequest(request, material, { checkPublication: false });
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ owner: 'owner', ...legacy }))
      .digest('hex');
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      request.runId,
    ]);
    // This is a receipt from the version before signalType was introduced.
    await pool.query(
      "INSERT INTO editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash) VALUES($1,$2,'owner',0,1,$3,'publish',$4::jsonb,$5)",
      [
        request.requestId,
        request.runId,
        request.materialHash,
        JSON.stringify(legacy.content),
        requestHash,
      ],
    );
    const args = {
      pool: writer,
      owner: 'owner',
      material: { ...material, sourceUrls: [], sourceOptions: [] },
    };
    const update = {
      ...request,
      requestId: randomUUID(),
      expectedRevision: 1,
      content: { ...request.content, signalType: 'product', sourceUrls: [] },
    };
    await saveEditorialSignal({ ...args, request: update });
    const replay = await saveEditorialSignal({ ...args, request });
    expect(replay.revision).toBe(1);
    expect(replay.content).toEqual(legacy.content);
    expect(Object.hasOwn(replay.content, 'signalType')).toBe(false);
    expect(
      (
        await readEditorialSignal({
          pool: writer,
          owner: 'owner',
          runId: request.runId,
          candidateIndex: 0,
        })
      ).revision,
    ).toBe(2);
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...request, content: { ...request.content, persons: ['Changed'] } },
      }),
    ).rejects.toThrow('request_id_conflict');
    await expect(
      saveEditorialSignal({
        ...args,
        request: {
          ...request,
          requestId: randomUUID(),
          expectedRevision: 2,
          content: { ...request.content, sourceUrls: [] },
        },
      }),
    ).rejects.toThrow('confirmation_required');
    await expect(
      saveEditorialSignal({
        ...args,
        request: {
          ...update,
          requestId: randomUUID(),
          expectedRevision: 2,
          content: { ...update.content, sourceUrls: material.sourceUrls },
        },
      }),
    ).rejects.toThrow('material_changed');
    await saveEditorialSignal({
      ...args,
      request: {
        ...update,
        requestId: randomUUID(),
        expectedRevision: 2,
        action: 'withdraw',
        content: request.content,
      },
    });
    expect(
      (
        await reader.query('SELECT * FROM editorial_public_signals WHERE signal_id=$1', [
          `editorial-${createHash('md5').update(`${request.runId}:0`).digest('hex')}`,
        ])
      ).rows,
    ).toEqual([]);
  });
  it('serializes soft deletion and publication in both commit orders', async () => {
    const { request, material } = editorialFixture();
    for (const publicationFirst of [true, false]) {
      const runId = randomUUID();
      await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
        runId,
      ]);
      const holder = await pool.connect();
      let racing;
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [runId]);
        if (publicationFirst) {
          await holder.query(
            "INSERT INTO editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash) VALUES($1,$2,'owner',0,1,$3,'publish',$4::jsonb,$3)",
            [randomUUID(), runId, material.materialHash, JSON.stringify(request.content)],
          );
          racing = pool
            .query('UPDATE signal_generation_runs SET deleted_at=now() WHERE id=$1', [runId])
            .then(
              () => null,
              (error) => error.message,
            );
        } else {
          await holder.query('UPDATE signal_generation_runs SET deleted_at=now() WHERE id=$1', [
            runId,
          ]);
          racing = saveEditorialSignal({
            pool: writer,
            owner: 'owner',
            material,
            request: { ...request, requestId: randomUUID(), runId },
          }).then(
            () => null,
            (error) => error.code,
          );
        }
        let blocked = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          blocked = (
            await admin.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event='advisory') AS blocked",
              [db],
            )
          ).rows[0].blocked;
          if (blocked) break;
          await setTimeout(5);
        }
        expect(blocked).toBe(true);
        await holder.query('COMMIT');
        expect(await racing).toBe(
          publicationFirst ? 'published_candidate_delete_forbidden' : 'not_found',
        );
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        await racing;
      }
    }
  });
  it('atomically registers resources, requires consent before reusing concurrent identities and preserves history on withdrawal', async () => {
    const make = async () => {
      const fixture = resourceFixture('-atomic');
      fixture.request.runId = randomUUID();
      fixture.request.requestId = randomUUID();
      await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
        fixture.request.runId,
      ]);
      return { pool: writer, owner: 'owner', ...fixture };
    };
    const first = await make();
    const second = await make();
    await saveEditorialSignal({
      ...first,
      request: { ...first.request, action: 'draft', consent: false },
    });
    expect(
      (await pool.query("SELECT id FROM entities WHERE name LIKE '%-atomic'")).rows,
    ).toHaveLength(0);
    first.request = { ...first.request, requestId: randomUUID(), expectedRevision: 1 };
    const race = await Promise.allSettled([
      saveEditorialSignal(first),
      saveEditorialSignal(second),
    ]);
    expect(race.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((row) => row.status === 'rejected').reason.code).toBe(
      'resource_identity_ambiguous',
    );
    const committed = race.find((row) => row.status === 'fulfilled').value;
    const loser = race[0].status === 'rejected' ? first : second;
    loser.request.content = {
      ...loser.request.content,
      resources: loser.request.content.resources.map((row, i) => ({
        ...row,
        entity_id: committed.content.resources[i].entity_id,
      })),
    };
    await saveEditorialSignal(loser);
    const a = await saveEditorialSignal(first);
    expect(a.content.resources.map((row) => row.entity_id)).toEqual(
      committed.content.resources.map((row) => row.entity_id),
    );
    expect(a.content.resources.every((row) => row.entity_id)).toBe(true);
    expect(
      (await pool.query("SELECT id FROM entities WHERE name LIKE '%-atomic'")).rows,
    ).toHaveLength(2);
    expect(await saveEditorialSignal(first)).toEqual(a);
    await expect(
      saveEditorialSignal({
        ...first,
        request: {
          ...first.request,
          content: { ...first.request.content, resources: a.content.resources },
        },
      }),
    ).rejects.toThrow('request_id_conflict');
    await saveEditorialSignal({
      ...first,
      request: {
        ...first.request,
        requestId: randomUUID(),
        expectedRevision: 2,
        action: 'withdraw',
      },
    });
    expect(
      (await pool.query("SELECT id FROM entities WHERE name LIKE '%-atomic'")).rows,
    ).toHaveLength(2);
    expect(
      (
        await reader.query(
          "SELECT content FROM editorial_public_signals WHERE content->>'title'=$1",
          [first.content.title],
        )
      ).rows.some(
        (row) => row.content.resources?.[0]?.entity_id === a.content.resources[0].entity_id,
      ),
    ).toBe(true);
  });
  it('rolls back all new resources on ambiguity, explicitly corrects organization type and never rewrites canonical metadata', async () => {
    const fixture = resourceFixture('-ambiguous');
    fixture.request.runId = randomUUID();
    fixture.request.requestId = randomUUID();
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      fixture.request.runId,
    ]);
    await pool.query(
      "INSERT INTO entities(id,type,name,status,aliases,metadata) VALUES('person-ambiguity-one','person','Person-ambiguous','active','{}','{\"keep\":true}'),('person-ambiguity-two','person','Other','active',ARRAY['Person-ambiguous'],'{}')",
    );
    const args = { pool: writer, owner: 'owner', ...fixture };
    await expect(saveEditorialSignal(args)).rejects.toThrow('resource_identity_ambiguous');
    expect(
      (await pool.query("SELECT id FROM entities WHERE name='Organization-ambiguous'")).rows,
    ).toHaveLength(0);
    expect(
      (
        await pool.query('SELECT request_id FROM editorial_signal_revisions WHERE run_id=$1', [
          fixture.request.runId,
        ])
      ).rows,
    ).toHaveLength(0);
    fixture.content.resources[1].entity_id = 'person-ambiguity-one';
    args.material.resourceCatalog = [
      {
        id: 'institution-ambiguous',
        name: 'Organization-ambiguous',
        type: 'institution',
        status: 'active',
      },
    ];
    const preview = await previewEditorialResources({
      pool: writer,
      resources: fixture.material.resources,
      catalog: args.material.resourceCatalog,
    });
    expect(preview[0].status).toBe('ambiguous');
    await expect(saveEditorialSignal(args)).rejects.toThrow('resource_identity_ambiguous');
    fixture.content.resources[0].entity_id = 'institution-ambiguous';
    const published = await saveEditorialSignal(args);
    expect(published.content.resources[0]).toMatchObject({
      entity_id: 'institution-ambiguous',
      type: 'institution',
    });
    const changed = await saveEditorialSignal({
      ...args,
      request: {
        ...fixture.request,
        requestId: randomUUID(),
        expectedRevision: 1,
        content: published.content,
      },
    });
    expect(changed.revision).toBe(2);
    expect(
      (await pool.query("SELECT metadata FROM entities WHERE id='person-ambiguity-one'")).rows[0]
        .metadata,
    ).toEqual({ keep: true });
    await expect(
      writer.query("UPDATE entities SET name='Changed' WHERE id='person-ambiguity-one'"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(writer.query('SELECT metadata FROM entities')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(writer.query('DELETE FROM entities')).rejects.toMatchObject({ code: '42501' });
  });
  it('upgrades exactly the legacy editorial ACL idempotently and rejects partial grants', async () => {
    const upgrade = await sql('roles/upgrade_editorial_resources.sql');
    await pool.query(upgrade);
    await pool.query(upgrade);
    await pool.query(
      'REVOKE SELECT(id,name,type,status,aliases), INSERT(id,name,type,status,aliases) ON entities FROM hzense_editorial_writer; REVOKE SELECT(entity_id,entity_type), INSERT(entity_id,entity_type) ON person_profiles,organization_profiles FROM hzense_editorial_writer',
    );
    const client = await writer.connect();
    try {
      await assertEditorialRole(client, 'writer');
    } finally {
      client.release();
    }
    await pool.query('GRANT SELECT(name) ON entities TO hzense_editorial_writer');
    await expect(pool.query(upgrade)).rejects.toThrow('ACL mismatch');
    // SQL errors leave its transaction aborted; restore the admin connection.
    await pool.query('ROLLBACK');
    await pool.query('REVOKE SELECT(name) ON entities FROM hzense_editorial_writer');
    await pool.query(upgrade);
    const upgraded = await writer.connect();
    try {
      await assertEditorialRole(upgraded, 'writer');
    } finally {
      upgraded.release();
    }
  });

  it('publishes resource-version company-only events without inventing a person', async () => {
    const fixture = resourceFixture('-no-person');
    fixture.request.runId = randomUUID();
    fixture.request.requestId = randomUUID();
    fixture.content.persons = [];
    fixture.content.resources = fixture.content.resources.filter((row) => row.type !== 'person');
    fixture.material.resources = fixture.material.resources.filter((row) => row.type !== 'person');
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      fixture.request.runId,
    ]);
    const saved = await saveEditorialSignal({ pool: writer, owner: 'owner', ...fixture });
    expect(saved.action).toBe('publish');
    expect(saved.content.persons).toEqual([]);
    expect(saved.content.resources).toHaveLength(1);
    expect(saved.content.resources[0].entity_id).toMatch(/^company-generated-/);
    const old = editorialFixture();
    old.content.persons = [];
    expect(() => normalizeEditorialRequest(old.request, old.material)).toThrow(
      'confirmation_required',
    );
  });

  it('keeps independent same-name identities and binds each profile only to its own selected provenance', async () => {
    const fixture = resourceFixture('-evidence');
    fixture.request.runId = randomUUID();
    fixture.request.requestId = randomUUID();
    const urls = ['https://example.com/company-evidence', 'https://example.com/person-evidence'];
    fixture.content.sourceUrls = urls;
    fixture.material.sourceOptions = urls;
    fixture.material.resourceSourceOptions.forEach((row, i) => {
      row.sourceUrls = [urls[i]];
    });
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      fixture.request.runId,
    ]);
    const args = { pool: writer, owner: 'owner', ...fixture };
    await expect(
      saveEditorialSignal({
        ...args,
        material: { ...fixture.material, resourceSourceOptions: undefined },
      }),
    ).rejects.toThrow('resource_source_required');
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...fixture.request, content: { ...fixture.content, sourceUrls: [urls[0]] } },
      }),
    ).rejects.toThrow('resource_source_required');
    expect(
      (await pool.query("SELECT id FROM entities WHERE name LIKE '%-evidence'")).rows,
    ).toHaveLength(0);
    fixture.content.resources.forEach((row) => {
      row.source_urls = ['https://forged.example/source'];
    });
    const original = await saveEditorialSignal(args);
    expect(original.content.resources.map((row) => row.source_urls)).toEqual([
      [urls[0]],
      [urls[1]],
    ]);
    const other = {
      ...fixture.request,
      runId: randomUUID(),
      requestId: randomUUID(),
      content: {
        ...fixture.content,
        resources: fixture.content.resources.map((row) => ({ ...row, entity_id: '__new__' })),
      },
    };
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      other.runId,
    ]);
    const separate = await saveEditorialSignal({ ...args, request: other });
    expect(
      separate.content.resources.every(
        (row, index) => row.entity_id !== original.content.resources[index].entity_id,
      ),
    ).toBe(true);
    expect(await saveEditorialSignal({ ...args, request: other })).toEqual(separate);
    expect(
      (await pool.query("SELECT id FROM entities WHERE name LIKE '%-evidence'")).rows,
    ).toHaveLength(4);
  });
  it('retains locked published resource provenance after imports disappear without trusting client or changed profiles', async () => {
    const fixture = resourceFixture('-retained-provenance');
    fixture.request.runId = randomUUID();
    fixture.request.requestId = randomUUID();
    const urls = ['https://example.com/company-retained', 'https://example.com/person-retained'];
    fixture.content.sourceUrls = urls;
    fixture.material.sourceOptions = urls;
    fixture.material.resourceSourceOptions.forEach((row, index) => {
      row.sourceUrls = [urls[index]];
    });
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      fixture.request.runId,
    ]);
    const args = { pool: writer, owner: 'owner', ...fixture };
    const original = await saveEditorialSignal(args);
    const unavailable = {
      ...fixture.material,
      sourceUrls: [],
      sourceOptions: [],
      resourceSourceOptions: [],
    };
    const update = {
      ...fixture.request,
      requestId: randomUUID(),
      expectedRevision: 1,
      content: {
        ...original.content,
        resources: original.content.resources.map((row, index) => ({
          ...row,
          source_urls: [urls[1 - index], 'https://forged.example/source'],
        })),
      },
    };
    const retained = await saveEditorialSignal({ ...args, material: unavailable, request: update });
    expect(retained.content.resources.map((row) => row.source_urls)).toEqual([
      [urls[0]],
      [urls[1]],
    ]);
    expect(
      await saveEditorialSignal({ ...args, material: unavailable, request: fixture.request }),
    ).toEqual(original);
    const next = {
      ...update,
      requestId: randomUUID(),
      expectedRevision: 2,
      content: retained.content,
    };
    for (const patch of [
      { introduction: 'Changed profile' },
      { event_role: 'Changed role' },
      { evidence: [{ fragment_id: 'fragment-2', quote: 'Changed evidence' }] },
    ]) {
      const resources = retained.content.resources.map((row, index) =>
        index ? row : { ...row, ...patch },
      );
      const materialResources = unavailable.resources.map((row, index) =>
        index ? row : { ...row, ...patch },
      );
      await expect(
        saveEditorialSignal({
          ...args,
          material: { ...unavailable, resources: materialResources },
          request: { ...next, content: { ...next.content, resources } },
        }),
      ).rejects.toThrow('resource_source_required');
    }
    await pool.query(
      "INSERT INTO entities(id,type,name,status) VALUES('company-other-retained','company','Organization-retained-provenance','active')",
    );
    await expect(
      saveEditorialSignal({
        ...args,
        material: unavailable,
        request: {
          ...next,
          content: {
            ...next.content,
            resources: next.content.resources.map((row, index) =>
              index ? row : { ...row, entity_id: 'company-other-retained' },
            ),
          },
        },
      }),
    ).rejects.toThrow('resource_source_required');
    expect(
      (
        await readEditorialSignal({
          pool: writer,
          owner: 'owner',
          runId: fixture.request.runId,
          candidateIndex: 0,
        })
      ).revision,
    ).toBe(2);
    const withdrawn = await saveEditorialSignal({
      ...args,
      material: unavailable,
      request: { ...next, action: 'withdraw' },
    });
    expect(withdrawn.content.resources).toEqual(retained.content.resources);
    const republished = await saveEditorialSignal({
      ...args,
      material: unavailable,
      request: { ...next, requestId: randomUUID(), expectedRevision: 3 },
    });
    expect(republished.content.resources).toEqual(retained.content.resources);
    const draftFixture = resourceFixture('-untrusted-draft');
    draftFixture.request.runId = randomUUID();
    draftFixture.request.requestId = randomUUID();
    draftFixture.material.resourceSourceOptions = [];
    draftFixture.content.resources.forEach((row) => {
      row.source_urls = draftFixture.content.sourceUrls;
    });
    await pool.query("INSERT INTO signal_generation_runs VALUES($1,'owner','completed',NULL)", [
      draftFixture.request.runId,
    ]);
    const draftArgs = { pool: writer, owner: 'owner', ...draftFixture };
    await saveEditorialSignal({
      ...draftArgs,
      request: { ...draftFixture.request, action: 'draft', consent: false },
    });
    await expect(
      saveEditorialSignal({
        ...draftArgs,
        request: { ...draftFixture.request, requestId: randomUUID(), expectedRevision: 1 },
      }),
    ).rejects.toThrow('resource_source_required');
  });
  it('previews resources through the reviewer while legacy writer publication stays fail-closed until upgrade', async () => {
    // This is the existing limited editorial fixture, extended only with the
    // reviewer grant contract. It exercises real role SQL and direct logins;
    // it does not claim to replace the full migration/vector integration suite.
    if (
      (await admin.query("SELECT 1 FROM pg_roles WHERE rolname='hzense_candidate_reviewer'"))
        .rowCount
    )
      throw new Error('Refusing to modify existing reviewer');
    await pool.query(`
      ALTER TABLE public.signal_generation_runs ADD COLUMN snapshot jsonb, ADD COLUMN source_hash text, ADD COLUMN result jsonb;
      ALTER TABLE public.topics ADD COLUMN parent_id text, ADD COLUMN metadata jsonb;
      ALTER TABLE public.entities ADD COLUMN created_at timestamptz, ADD COLUMN updated_at timestamptz;
      CREATE TABLE public.signals(id text PRIMARY KEY);
      CREATE TABLE public.candidate_reviews(id uuid,request_id uuid,owner_id text,run_id uuid,candidate_index integer,revision integer,material_hash text,fingerprint text,decision text,note text,draft jsonb,created_at timestamptz);
      CREATE TABLE public.sources(id text,name text,type text,url text,trust_score double precision,active boolean,allowed_hosts text[]);
      CREATE TABLE public.public_source_evidence(id uuid,source_id text,source_url text,locator text,excerpt text,content_hash text,captured_at timestamptz,source_published_at timestamptz,verification_status text,created_xid xid8);
      INSERT INTO public.hzense_schema_migrations(name) VALUES('0020_candidate_reviews.sql'),('0021_candidate_review_attestations.sql');
    `);
    await admin.query(
      "CREATE ROLE hzense_candidate_reviewer LOGIN NOINHERIT CONNECTION LIMIT 2 PASSWORD 'reviewer-test-only'",
    );
    reviewerCreated = true;
    await pool.query(await sql('roles/configure_candidate_reviewer.sql'));
    const reviewerUrl = new URL(adminUrl);
    reviewerUrl.pathname = `/${db}`;
    reviewerUrl.username = 'hzense_candidate_reviewer';
    reviewerUrl.password = 'reviewer-test-only';
    reviewer = new pg.Pool({ connectionString: reviewerUrl.toString(), max: 1 });
    await expect(assertCandidateReviewRole(reviewer)).resolves.toBeUndefined();
    expect((await reviewer.query('SELECT session_user,current_user')).rows).toEqual([
      { session_user: 'hzense_candidate_reviewer', current_user: 'hzense_candidate_reviewer' },
    ]);
    await pool.query(
      'REVOKE SELECT(id,name,type,status,aliases), INSERT(id,name,type,status,aliases) ON entities FROM hzense_editorial_writer; REVOKE SELECT(entity_id,entity_type), INSERT(entity_id,entity_type) ON person_profiles,organization_profiles FROM hzense_editorial_writer',
    );
    await expect(assertEditorialRole(writer, 'writer')).resolves.toBeUndefined();
    const fixture = resourceFixture('-legacy-writer-preview');
    fixture.request.runId = randomUUID();
    fixture.request.requestId = randomUUID();
    fixture.content.resources[0].entity_id = 'company-preview-role-fixture';
    await pool.query(
      "INSERT INTO public.signal_generation_runs(id,owner_id,status,deleted_at) VALUES($1,'owner','completed',NULL)",
      [fixture.request.runId],
    );
    await pool.query(
      "INSERT INTO public.entities(id,name,type,status,aliases,metadata) VALUES('company-preview-role-fixture','Canonical preview company','company','active',$1,'{\"keep\":true}');",
      [[fixture.material.resources[0].name]],
    );
    await pool.query(
      "INSERT INTO public.organization_profiles(entity_id,entity_type) VALUES('company-preview-role-fixture','company')",
    );
    const before = (
      await pool.query(`SELECT
        (SELECT count(*)::integer FROM public.entities) AS entities,
        (SELECT count(*)::integer FROM public.person_profiles) AS people,
        (SELECT count(*)::integer FROM public.organization_profiles) AS organizations,
        (SELECT count(*)::integer FROM public.editorial_signal_revisions) AS revisions`)
    ).rows[0];
    // Observe real PostgreSQL SQLSTATE before the store deliberately translates
    // database errors to its public database_unavailable contract.
    const deniedStates = [];
    const observedWriter = {
      async connect() {
        const client = await writer.connect();
        return {
          async query(...args) {
            try {
              return await client.query(...args);
            } catch (error) {
              deniedStates.push(error.code);
              throw error;
            }
          },
          release: (discard) => client.release(discard),
        };
      },
    };
    const previewArgs = { resources: fixture.material.resources, catalog: [] };
    await expect(
      previewEditorialResources({ pool: observedWriter, ...previewArgs }),
    ).rejects.toThrow('database_unavailable');
    expect(deniedStates).toEqual(['42501']);
    const expectedPreview = [
      {
        name: fixture.material.resources[0].name,
        type: 'company',
        status: 'reuse',
        matches: [
          {
            id: 'company-preview-role-fixture',
            name: 'Canonical preview company',
            type: 'company',
          },
        ],
      },
      { name: fixture.material.resources[1].name, type: 'person', status: 'new', matches: [] },
    ];
    await expect(previewEditorialResources({ pool: reviewer, ...previewArgs })).resolves.toEqual(
      expectedPreview,
    );
    await expect(
      reviewer.query(
        "INSERT INTO public.entities(id,name,type,status,aliases) VALUES('person-forbidden-preview','Forbidden','person','active','{}')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      saveEditorialSignal({ pool: observedWriter, owner: 'owner', ...fixture }),
    ).rejects.toThrow('database_unavailable');
    expect(deniedStates).toEqual(['42501', '42501']);
    expect(
      (
        await pool.query(`SELECT
          (SELECT count(*)::integer FROM public.entities) AS entities,
          (SELECT count(*)::integer FROM public.person_profiles) AS people,
          (SELECT count(*)::integer FROM public.organization_profiles) AS organizations,
          (SELECT count(*)::integer FROM public.editorial_signal_revisions) AS revisions`)
      ).rows[0],
    ).toEqual(before);
    await expect(
      readEditorialSignal({
        pool: writer,
        owner: 'owner',
        runId: fixture.request.runId,
        candidateIndex: 0,
      }),
    ).resolves.toBeNull();
    await pool.query(await sql('roles/upgrade_editorial_resources.sql'));
    await expect(assertEditorialRole(writer, 'writer')).resolves.toBeUndefined();
    await expect(previewEditorialResources({ pool: writer, ...previewArgs })).resolves.toEqual(
      expectedPreview,
    );
    const publishArgs = { pool: writer, owner: 'owner', ...fixture };
    const published = await saveEditorialSignal(publishArgs);
    expect(published).toMatchObject({ action: 'publish', revision: 1 });
    expect(published.content.resources[0].entity_id).toBe('company-preview-role-fixture');
    expect(published.content.resources[1].entity_id).toMatch(/^person-generated-/);
    expect(
      (
        await pool.query('SELECT entity_id FROM public.person_profiles WHERE entity_id=$1', [
          published.content.resources[1].entity_id,
        ])
      ).rowCount,
    ).toBe(1);
    await expect(saveEditorialSignal(publishArgs)).resolves.toEqual(published);
    expect(
      (
        await pool.query(
          'SELECT count(*)::integer AS revisions FROM public.editorial_signal_revisions WHERE run_id=$1',
          [fixture.request.runId],
        )
      ).rows,
    ).toEqual([{ revisions: 1 }]);
    expect(
      (
        await pool.query(
          "SELECT metadata FROM public.entities WHERE id='company-preview-role-fixture'",
        )
      ).rows,
    ).toEqual([{ metadata: { keep: true } }]);
  });
});
