import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { saveEditorialSignal, readEditorialSignal } from '../src/editorial-signal-store.mjs';
import { assertEditorialRole } from '../src/editorial-signal-role.mjs';
import { editorialFixture } from './editorial-signal.test.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('editorial publication persistence and isolated capabilities', () => {
  let admin,
    pool,
    writer,
    reader,
    created = false,
    rolesCreated = false;
  const db = `hzense_editorial_${process.pid}_${Date.now()}`;
  const roles = ['hzense_editorial_writer', 'hzense_editorial_reader'];
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
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${db}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(
      'CREATE TABLE public.signal_generation_runs(id uuid PRIMARY KEY,owner_id text NOT NULL,status text,deleted_at timestamptz); CREATE TABLE public.topics(id text PRIMARY KEY,title text,runtime_enabled boolean,status text); CREATE TABLE public.hzense_schema_migrations(name text PRIMARY KEY);',
    );
    await pool.query(await sql('migrations/0025_editorial_signal_publication.sql'));
    await pool.query(
      "INSERT INTO hzense_schema_migrations VALUES('0025_editorial_signal_publication.sql'); INSERT INTO topics VALUES('ai','AI',true,'watching');",
    );
    await pool.query(`REVOKE CREATE,TEMPORARY ON DATABASE "${db}" FROM PUBLIC`);
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
    await writer?.end();
    await reader?.end();
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    if (rolesCreated) for (const role of roles) await admin.query(`DROP ROLE ${role}`);
    await admin?.end();
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
});
