import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';

const { Client, Pool } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `hzense_qualified_test_${suffix}`;
const ownerRole = `hzense_qualified_owner_${suffix}`;
const ownerPassword = 'test-only-private-qualified-publication';

function identifier(value) {
  if (!/^hzense_qualified_(?:test|owner)_[0-9]+_[0-9]+$/.test(value))
    throw new Error('Unsafe qualified publication fixture identifier');
  return `"${value}"`;
}
function databaseUrl(asAdmin = false) {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  if (!asAdmin) {
    url.username = ownerRole;
    url.password = ownerPassword;
  }
  return url.toString();
}
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

async function observeBlocked(observer, pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 AS blocked
       FROM pg_stat_activity WHERE pid=$1`,
      [pid],
    );
    if (result.rows[0]?.blocked) return;
    await delay(10);
  }
  throw new Error('Expected an observed PostgreSQL backend lock wait');
}
async function observeExpired(observer, runId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      'SELECT lease_expires_at<=clock_timestamp() AS expired FROM public.signal_publication_runs WHERE run_id=$1',
      [runId],
    );
    if (result.rows[0]?.expired) return;
    await delay(10);
  }
  throw new Error('Expected database clock expiry of the synthetic fixture lease');
}

// Independent implementation of the existing 3.0.0 fixed-order preimage, not
// the publisher's own clone function. Synthetic data is not verified journalism.
function snapshot(signalId, version = 1) {
  const row = {
    signal_id: signalId,
    version,
    schema_version: '3.0.0',
    title: 'Synthetic event',
    type: 'research',
    occurred_at: '2026-01-01T00:00:00.000Z',
    date_precision: 'day',
    date_basis: 'Synthetic UTC event date',
    captured_at: '2026-09-13T08:10:11.678Z',
    summary: 'Synthetic public evidence-backed claim',
    analysis: 'Synthetic bounded analysis',
    importance: 3,
    strength: 3,
    confidence: 0.8,
    novelty: 0.6,
    revision_reason: 'Synthetic fixture version',
    origin: 'manual',
    legacy_status: null,
  };
  return {
    ...row,
    content_hash: createHash('sha256').update(JSON.stringify(row), 'utf8').digest('hex'),
  };
}

suite('PostgreSQL private recorded qualification and atomic Signal publication', () => {
  let administrator;
  let pool;
  let publish;
  let create;
  let claim;
  let cancel;
  let record;
  let roleCreated = false;
  let databaseCreated = false;

  beforeAll(async () => {
    ({ publishPrivateQualifiedSignalVersion: publish } =
      await import('../src/signal-qualified-publication-store.mjs'));
    ({
      createPrivatePublicationRun: create,
      claimPrivatePublicationRun: claim,
      cancelPrivatePublicationRun: cancel,
    } = await import('../src/signal-publication-control-store.mjs'));
    ({ recordPrivateSignalPublicationTransition: record } =
      await import('../src/signal-publication-store.mjs'));
    administrator = new Client({ connectionString: adminUrl });
    await administrator.connect();
    await administrator.query(`CREATE ROLE ${identifier(ownerRole)} LOGIN PASSWORD '${ownerPassword}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    roleCreated = true;
    await administrator.query(
      `CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier(ownerRole)}`,
    );
    databaseCreated = true;
    const target = new Client({ connectionString: databaseUrl(true) });
    await target.connect();
    try {
      await target.query('CREATE EXTENSION vector; REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    } finally {
      await target.end();
    }
    await runMigrations({ connectionString: databaseUrl() });
    pool = new Pool({ connectionString: databaseUrl(), max: 8 });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (!administrator) return;
    try {
      if (databaseCreated) {
        await waitForDatabaseDisconnects(administrator, databaseName);
        await administrator.query(`DROP DATABASE ${identifier(databaseName)}`);
      }
      if (roleCreated) await administrator.query(`DROP ROLE ${identifier(ownerRole)}`);
    } finally {
      await administrator.end();
    }
  }, 30_000);

  async function fixture({ sourceVersion = 1, leaseSeconds = 60, beforeSeal } = {}) {
    const id = `qualified-${randomUUID()}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts)
        VALUES($1,'Synthetic source','website',80,ARRAY['example.com'])`,
        [`${id}-source`],
      );
      await client.query(
        `INSERT INTO public.entities(id,type,name) VALUES($1,'person','Synthetic Person'),($2,'company','Synthetic Organization')`,
        [`${id}-person`, `${id}-organization`],
      );
      await client.query(`INSERT INTO public.person_profiles(entity_id) VALUES($1)`, [
        `${id}-person`,
      ]);
      await client.query(
        `INSERT INTO public.organization_profiles(entity_id,entity_type) VALUES($1,'company')`,
        [`${id}-organization`],
      );
      await client.query(
        `INSERT INTO public.topics(id,title,status,runtime_enabled) VALUES($1,'Synthetic Topic','active',true)`,
        [`${id}-topic`],
      );
      await client.query(
        `INSERT INTO public.signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty)
        VALUES($1,'Synthetic event','research','2026-01-01T00:00:00Z','2026-09-13T08:10:11.678Z',$2,'https://example.com/event','Synthetic claim',3,3,0.8,0.6)`,
        [id, `${id}-source`],
      );
      await client.query(
        `INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status)
        VALUES($1,$2,'https://example.com/event','paragraph 1','Synthetic excerpt',$3,'2026-09-13T08:10:11.678Z','2026-01-01T00:00:00Z','verified')`,
        [`${id}-evidence`, `${id}-source`, 'a'.repeat(64)],
      );
      for (let version = 1; version <= sourceVersion; version += 1) {
        const row = snapshot(id, version);
        await client.query(
          `INSERT INTO public.signal_versions(signal_id,version,schema_version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,analysis,importance,strength,confidence,novelty,revision_reason,origin,legacy_status,content_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          Object.values(row),
        );
        await client.query(
          `INSERT INTO public.signal_version_evidence(signal_id,version,evidence_id,claim,relation) VALUES($1,$2,$3,'Synthetic event claim','supports')`,
          [id, version, `${id}-evidence`],
        );
        await client.query(
          `INSERT INTO public.signal_version_people(signal_id,version,person_id,evidence_id,event_role,verification_status) VALUES($1,$2,$3,$4,'research_author','verified')`,
          [id, version, `${id}-person`, `${id}-evidence`],
        );
        await client.query(
          `INSERT INTO public.signal_version_organizations(signal_id,version,organization_id,evidence_id,event_role,verification_status) VALUES($1,$2,$3,$4,'subject','verified')`,
          [id, version, `${id}-organization`, `${id}-evidence`],
        );
        await client.query(
          `INSERT INTO public.signal_version_topics(signal_id,version,topic_id) VALUES($1,$2,$3)`,
          [id, version, `${id}-topic`],
        );
      }
      await client.query(
        `INSERT INTO public.signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis) VALUES($1,$2,1,$3,'Synthetic exact event identity')`,
        [id, `${id}-event`, `${id}-evidence`],
      );
      if (beforeSeal) await beforeSeal(client, id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const run = {
      run_id: randomUUID(),
      task_id: randomUUID(),
      principal_id: randomUUID(),
      original_intent: 'auto_publish',
    };
    await pool.query(
      'UPDATE public.signal_publication_control SET publication_enabled=true WHERE singleton',
    );
    await pool.query(
      `INSERT INTO public.signal_publication_tasks(task_id,policy,publication_enabled) VALUES($1,'auto_publish',true)`,
      [run.task_id],
    );
    await pool.query(
      `INSERT INTO public.signal_publication_authorizations(task_id,principal_id,can_publish) VALUES($1,$2,true)`,
      [run.task_id, run.principal_id],
    );
    await create({ pool, request: run });
    const leaseOwner = randomUUID();
    await claim({
      pool,
      request: { run_id: run.run_id, lease_owner: leaseOwner, lease_seconds: leaseSeconds },
    });
    return {
      id,
      run,
      request: {
        request_key: `qualified:${randomUUID()}`,
        signal_id: id,
        source_version: sourceVersion,
        target_version: sourceVersion + 1,
        expected_revision: 0,
        reason_code: 'initial_publication',
        run_id: run.run_id,
        lease_owner: leaseOwner,
        fencing_token: 1,
      },
    };
  }

  async function state(id) {
    const rows = await Promise.all([
      pool.query('SELECT * FROM public.signal_versions WHERE signal_id=$1 ORDER BY version', [id]),
      pool.query('SELECT * FROM public.signal_publication_state WHERE signal_id=$1', [id]),
      pool.query(
        'SELECT * FROM public.signal_publication_outbox WHERE signal_id=$1 ORDER BY publication_revision',
        [id],
      ),
      pool.query('SELECT * FROM public.signal_qualified_publication_receipts WHERE signal_id=$1', [
        id,
      ]),
    ]);
    return {
      versions: rows[0].rows,
      heads: rows[1].rows,
      events: rows[2].rows,
      receipts: rows[3].rows,
    };
  }
  async function expectNoWrite(f) {
    const actual = await state(f.id);
    expect(actual.versions).toHaveLength(f.request.source_version);
    expect(actual.heads).toEqual([]);
    expect(actual.events).toEqual([]);
    expect(actual.receipts).toEqual([]);
  }
  async function startObserved(request) {
    const client = await pool.connect();
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // A real freshly borrowed connection with no caller transaction; the
    // adapter still owns BEGIN/COMMIT/release. Only its PID is observed here.
    return { pid, pending: settle(publish({ pool: { connect: async () => client }, request })) };
  }

  it('atomically clones a sealed snapshot and all four edge sets with a new canonical hash', async () => {
    const f = await fixture();
    const result = await publish({ pool, request: f.request });
    expect(result).toMatchObject({
      outcome: 'apply',
      scope: 'private_recorded_qualification',
      head: { signal_id: f.id, content_version: 2, publication_revision: 1, status: 'published' },
    });
    const actual = await state(f.id);
    expect(actual.versions).toHaveLength(2);
    expect(actual.versions[0].content_hash).toBe(snapshot(f.id, 1).content_hash);
    expect(actual.versions[1].content_hash).toBe(snapshot(f.id, 2).content_hash);
    expect(actual.versions[1].content_hash).not.toBe(actual.versions[0].content_hash);
    expect(actual.versions[1].occurred_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(actual.versions[1].captured_at.toISOString()).toBe('2026-09-13T08:10:11.678Z');
    expect(actual.versions[1].created_xid).not.toBe(actual.versions[0].created_xid);
    expect(actual.heads).toHaveLength(1);
    expect(actual.events).toHaveLength(1);
    expect(actual.receipts).toHaveLength(1);
    expect(actual.heads[0].event_id).toBe(actual.events[0].event_id);
    expect(actual.receipts[0]).toMatchObject({
      request_key: f.request.request_key,
      signal_id: f.id,
      source_version: 1,
      target_version: 2,
      run_id: f.run.run_id,
    });
    for (const table of [
      'signal_version_evidence',
      'signal_version_people',
      'signal_version_organizations',
      'signal_version_topics',
    ]) {
      const edges = (
        await pool.query(
          `SELECT to_jsonb(edge)-'version' AS payload FROM public.${table} AS edge WHERE signal_id=$1 ORDER BY version`,
          [f.id],
        )
      ).rows;
      expect(edges).toHaveLength(2);
      expect(edges[1]).toEqual(edges[0]);
    }
  });

  it.each([
    ['no people', `DELETE FROM public.signal_version_people WHERE signal_id=$1`],
    [
      'pending people',
      `UPDATE public.signal_version_people SET verification_status='pending' WHERE signal_id=$1`,
    ],
    [
      'rejected organization',
      `UPDATE public.signal_version_organizations SET verification_status='rejected' WHERE signal_id=$1`,
    ],
    [
      'context instead of support',
      `UPDATE public.signal_version_evidence SET relation='context' WHERE signal_id=$1`,
    ],
    ['missing event identity', `DELETE FROM public.signal_event_identities WHERE signal_id=$1`],
    ['no topic', `DELETE FROM public.signal_version_topics WHERE signal_id=$1`],
    [
      'wrong content hash',
      `UPDATE public.signal_versions SET content_hash=repeat('b',64) WHERE signal_id=$1`,
    ],
    [
      'microsecond source date',
      `UPDATE public.signal_versions SET captured_at=captured_at+interval '1 microsecond' WHERE signal_id=$1`,
    ],
    [
      'out-of-range source year',
      `UPDATE public.signal_versions SET captured_at='10000-01-01T00:00:00Z' WHERE signal_id=$1`,
    ],
  ])('rejects %s without any partially created publication data', async (_label, sql) => {
    const f = await fixture({ beforeSeal: (client, id) => client.query(sql, [id]) });
    await expect(publish({ pool, request: f.request })).rejects.toBeDefined();
    await expectNoWrite(f);
  });

  const dependencies = [
    ['Source', `UPDATE public.sources SET active=false WHERE id=$1`, '-source'],
    [
      'Evidence',
      `UPDATE public.public_source_evidence SET verification_status='rejected' WHERE id=$1`,
      '-evidence',
    ],
    ['Person', `UPDATE public.entities SET status='inactive' WHERE id=$1`, '-person'],
    ['Organization', `UPDATE public.entities SET status='inactive' WHERE id=$1`, '-organization'],
    ['Topic', `UPDATE public.topics SET runtime_enabled=false WHERE id=$1`, '-topic'],
    [
      'source hostname',
      `UPDATE public.sources SET allowed_hosts=ARRAY['other.example.com'] WHERE id=$1`,
      '-source',
    ],
  ];
  it.each(dependencies)(
    'rejects current %s invalidation rather than using frozen verified flags',
    async (_label, sql, suffix) => {
      const f = await fixture();
      await pool.query(sql, [`${f.id}${suffix}`]);
      await expect(publish({ pool, request: f.request })).rejects.toBeDefined();
      await expectNoWrite(f);
    },
  );

  it('rejects a non-rejected contradiction on an older canonical identity basis version', async () => {
    const f = await fixture({
      sourceVersion: 2,
      beforeSeal: async (client, id) => {
        await client.query(
          `INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at,verification_status)
        VALUES($1,$2,'https://example.com/counter','paragraph 2','Synthetic contradiction',$3,'2026-09-13T00:00:00Z','pending')`,
          [`${id}-counter`, `${id}-source`, 'd'.repeat(64)],
        );
        await client.query(
          `INSERT INTO public.signal_version_evidence(signal_id,version,evidence_id,claim,relation) VALUES($1,1,$2,'Synthetic contrary claim','contradicts')`,
          [id, `${id}-counter`],
        );
      },
    });
    await expect(publish({ pool, request: f.request })).rejects.toBeDefined();
    await expectNoWrite(f);
  });

  it('requires target to exceed every existing version, not only the source or published head', async () => {
    const f = await fixture({ sourceVersion: 2 });
    await expect(
      publish({ pool, request: { ...f.request, source_version: 1, target_version: 2 } }),
    ).rejects.toBeDefined();
    await expectNoWrite(f);
  });

  it.each(['source_version', 'target_version', 'expected_revision', 'reason_code', 'run_id'])(
    'rejects reuse of an applied request key with changed %s',
    async (field) => {
      const f = await fixture({ sourceVersion: field === 'source_version' ? 2 : 1 });
      await publish({ pool, request: f.request });
      const replacement = {
        source_version: 1,
        target_version: 3,
        expected_revision: 1,
        reason_code: 'content_correction',
        run_id: randomUUID(),
      };
      await expect(
        publish({ pool, request: { ...f.request, [field]: replacement[field] } }),
      ).rejects.toMatchObject({ code: 'request_key_reused' });
      const actual = await state(f.id);
      expect(actual.events).toHaveLength(1);
      expect(actual.versions).toHaveLength(f.request.source_version + 1);
    },
  );

  it('replays only historical receipt after cancellation, disabled policy and invalidated evidence', async () => {
    const f = await fixture();
    await publish({ pool, request: f.request });
    const original = await state(f.id);
    await cancel({ pool, request: { run_id: f.run.run_id } });
    await pool.query(
      'UPDATE public.signal_publication_control SET publication_enabled=false WHERE singleton',
    );
    await pool.query(
      `UPDATE public.public_source_evidence SET verification_status='rejected' WHERE id=$1`,
      [`${f.id}-evidence`],
    );
    const replay = await publish({
      pool,
      request: { ...f.request, lease_owner: randomUUID(), fencing_token: 12 },
    });
    expect(replay).toMatchObject({
      outcome: 'replay',
      scope: 'private_historical_receipt',
      current_head_unchanged: true,
    });
    expect(await state(f.id)).toEqual(original);
  });

  it('does not restore an old published head when its historical receipt is replayed after withdrawal', async () => {
    const f = await fixture();
    await publish({ pool, request: f.request });
    await record({
      pool,
      request: {
        request_key: `withdraw:${randomUUID()}`,
        signal_id: f.id,
        action: 'withdraw',
        target_version: 2,
        expected_revision: 1,
        reason_code: 'operator_request',
      },
    });
    const original = await state(f.id);
    expect(original.heads[0]).toMatchObject({ publication_revision: 2, status: 'withdrawn' });
    const replay = await publish({ pool, request: f.request });
    expect(replay).toMatchObject({
      outcome: 'replay',
      current_head_unchanged: true,
      current_head: { publication_revision: 2, status: 'withdrawn' },
    });
    expect(await state(f.id)).toEqual(original);
  });

  it('does not adopt a legacy Outbox receipt which has no source/run binding', async () => {
    const f = await fixture();
    await record({
      pool,
      request: {
        request_key: f.request.request_key,
        signal_id: f.id,
        action: 'publish',
        target_version: 1,
        expected_revision: 0,
        reason_code: 'initial_publication',
      },
    });
    const original = await state(f.id);
    await expect(publish({ pool, request: f.request })).rejects.toMatchObject({
      code: 'unbound_publication_receipt',
    });
    expect(await state(f.id)).toEqual(original);
  });

  it('rejects a globally reused request key even when the new command targets another Signal', async () => {
    const first = await fixture();
    const second = await fixture();
    await publish({ pool, request: first.request });
    await expect(
      publish({ pool, request: { ...second.request, request_key: first.request.request_key } }),
    ).rejects.toMatchObject({ code: 'request_key_reused' });
    await expectNoWrite(second);
  });

  it('requires a current takeover token for unapplied work but can replay its receipt with the former token', async () => {
    const f = await fixture({ leaseSeconds: 1 });
    await observeExpired(pool, f.run.run_id);
    const leaseOwner = randomUUID();
    await claim({
      pool,
      request: { run_id: f.run.run_id, lease_owner: leaseOwner, lease_seconds: 60 },
    });
    await expect(publish({ pool, request: f.request })).rejects.toBeDefined();
    await expectNoWrite(f);
    await expect(
      publish({ pool, request: { ...f.request, lease_owner: leaseOwner, fencing_token: 2 } }),
    ).resolves.toMatchObject({ outcome: 'apply' });
    await expect(publish({ pool, request: f.request })).resolves.toMatchObject({
      outcome: 'replay',
      scope: 'private_historical_receipt',
      current_head_unchanged: true,
    });
    expect((await state(f.id)).events).toHaveLength(1);
  });

  it('does not publish an unapplied cancelled run even if its old lease had time remaining', async () => {
    const f = await fixture();
    await cancel({ pool, request: { run_id: f.run.run_id } });
    await expect(publish({ pool, request: f.request })).rejects.toBeDefined();
    await expectNoWrite(f);
  });

  it('serializes identical concurrent requests into one apply and one historical replay', async () => {
    const f = await fixture();
    const outcomes = await Promise.all([
      publish({ pool, request: f.request }),
      publish({ pool, request: f.request }),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(['apply', 'replay']);
    const actual = await state(f.id);
    expect(actual.versions).toHaveLength(2);
    expect(actual.events).toHaveLength(1);
    expect(actual.receipts).toHaveLength(1);
  });

  it('does not double-publish competing distinct requests for the same Signal revision', async () => {
    const f = await fixture();
    const outcomes = await Promise.all([
      settle(publish({ pool, request: f.request })),
      settle(
        publish({ pool, request: { ...f.request, request_key: `competitor:${randomUUID()}` } }),
      ),
    ]);
    expect(outcomes.filter((result) => result.value?.outcome === 'apply')).toHaveLength(1);
    expect(outcomes.filter((result) => result.error)).toHaveLength(1);
    const actual = await state(f.id);
    expect(actual.versions).toHaveLength(2);
    expect(actual.events).toHaveLength(1);
    expect(actual.receipts).toHaveLength(1);
  });

  it.each(dependencies.slice(0, 5))(
    'waits for a competing %s invalidation and re-reads its committed value',
    async (_label, sql, suffix) => {
      const f = await fixture();
      const blocker = await pool.connect();
      let operation;
      try {
        await blocker.query('BEGIN');
        await blocker.query(sql, [`${f.id}${suffix}`]);
        operation = await startObserved(f.request);
        await observeBlocked(blocker, operation.pid);
        await blocker.query('COMMIT');
        expect((await operation.pending).error).toBeDefined();
        await expectNoWrite(f);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        if (operation) await operation.pending;
      }
    },
  );

  it.each(dependencies.slice(0, 5))(
    'holds the locked %s qualification through the complete publication transaction',
    async (_label, sql, suffix) => {
      const f = await fixture();
      const barrier = await pool.connect();
      const updater = await pool.connect();
      let operation;
      let update;
      try {
        await barrier.query('BEGIN');
        await barrier.query(
          'LOCK TABLE public.signal_qualified_publication_receipts IN SHARE MODE',
        );
        operation = await startObserved(f.request);
        await observeBlocked(barrier, operation.pid);
        const updaterPid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        update = settle(updater.query(sql, [`${f.id}${suffix}`]));
        await observeBlocked(barrier, updaterPid);
        await barrier.query('ROLLBACK');
        expect((await operation.pending).value).toMatchObject({ outcome: 'apply' });
        expect((await update).error).toBeUndefined();
        expect((await state(f.id)).events).toHaveLength(1);
        // Later invalidation is deliberately NOT called a continuously valid
        // public read: coordinated invalidation/withdrawal is a future boundary.
      } finally {
        await barrier.query('ROLLBACK');
        if (operation) await operation.pending;
        if (update) await update;
        barrier.release();
        updater.release();
      }
    },
  );

  it('rechecks lease after a dependency lock wait and leaves no target version on expiry', async () => {
    const f = await fixture({ leaseSeconds: 1 });
    const blocker = await pool.connect();
    let operation;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM public.entities WHERE id=$1 FOR UPDATE', [
        `${f.id}-person`,
      ]);
      operation = await startObserved(f.request);
      await observeBlocked(blocker, operation.pid);
      await observeExpired(blocker, f.run.run_id);
      await blocker.query('ROLLBACK');
      expect((await operation.pending).error).toBeDefined();
      await expectNoWrite(f);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (operation) await operation.pending;
    }
  });

  it('rolls back cloned version, Outbox and head when lease expires during a post-write receipt wait', async () => {
    const f = await fixture({ leaseSeconds: 1 });
    const blocker = await pool.connect();
    let operation;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE public.signal_qualified_publication_receipts IN SHARE MODE');
      operation = await startObserved(f.request);
      await observeBlocked(blocker, operation.pid);
      await observeExpired(blocker, f.run.run_id);
      await blocker.query('ROLLBACK');
      expect((await operation.pending).error).toBeDefined();
      await expectNoWrite(f);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (operation) await operation.pending;
    }
  });

  it.each([
    'UPDATE public.signal_qualified_publication_receipts SET fencing_token=fencing_token WHERE request_key=$1',
    'DELETE FROM public.signal_qualified_publication_receipts WHERE request_key=$1',
    'TRUNCATE public.signal_qualified_publication_receipts',
  ])('protects permanent qualified receipts from direct SQL mutation: %s', async (sql) => {
    const f = await fixture();
    await publish({ pool, request: f.request });
    await expect(
      pool.query(sql, sql.includes('$1') ? [f.request.request_key] : []),
    ).rejects.toMatchObject({ code: '55000' });
    expect((await state(f.id)).receipts).toHaveLength(1);
  });
});
