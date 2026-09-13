import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { verifyCurrentPublicSignalReaderAccess } from '../src/current-publication-reader-contract.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';
import {
  readPrivateCandidateVerificationMaterial,
  recordPrivateCandidateVerification,
  assemblePrivateVerifiedSignalCandidate,
} from '../src/signal-candidate-verification-store.mjs';
import {
  publishVerifiedSignal,
  withdrawPublicSignal,
} from '../src/signal-publication-service-store.mjs';

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
  let publisherRoleCreated = false;
  let runtimeRoleCreated = false;

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
      if (publisherRoleCreated) await administrator.query('DROP ROLE hzense_publisher');
      if (runtimeRoleCreated) await administrator.query('DROP ROLE hzense_runtime');
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

  async function pendingCandidate() {
    return fixture({
      beforeSeal: async (client, id) => {
        await client.query(
          "UPDATE public.signal_version_people SET verification_status='pending' WHERE signal_id=$1",
          [id],
        );
        await client.query(
          "UPDATE public.signal_version_organizations SET verification_status='pending' WHERE signal_id=$1",
          [id],
        );
      },
    });
  }
  async function verificationRequest(f, overrides = {}) {
    const material = await readPrivateCandidateVerificationMaterial({
      pool,
      request: { signal_id: f.id, source_version: 1 },
    });
    return {
      verification_id: randomUUID(),
      signal_id: f.id,
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
      ...overrides,
    };
  }
  const assemblyRequest = (f, verification) => ({
    request_key: `assemble:${randomUUID()}`,
    verification_id: verification.verification_id,
    signal_id: f.id,
    source_version: 1,
    target_version: 2,
  });
  async function verifyCandidate(f, overrides) {
    const request = await verificationRequest(f, overrides);
    await recordPrivateCandidateVerification({ pool, request });
    return { verification: request, request: assemblyRequest(f, request) };
  }

  async function publicCandidate(overrides) {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f, overrides);
    await assemblePrivateVerifiedSignalCandidate({ pool, request: v.request });
    return {
      ...f,
      verification: v.verification,
      request: { ...f.request, source_version: 2, target_version: 3 },
    };
  }

  const withdrawal = (f) => ({
    request_key: `withdraw:${randomUUID()}`,
    signal_id: f.id,
    target_version: 3,
    expected_revision: 1,
    reason_code: 'operator_request',
  });

  it('publishes a verified exact assembly atomically with a permit and current public view', async () => {
    const f = await publicCandidate();
    const result = await publishVerifiedSignal({ pool, request: f.request });
    expect(result).toMatchObject({
      scope: 'public_publication_receipt',
      outcome: 'apply',
      signal_id: f.id,
      content_version: 3,
      publication_revision: 1,
      status: 'published',
      current_public: true,
    });
    const permit = await pool.query(
      'SELECT verification_id FROM public.signal_publication_permits WHERE event_id=$1',
      [result.event_id],
    );
    expect(permit.rows).toEqual([{ verification_id: f.verification.verification_id }]);
    expect(
      (
        await pool.query('SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1', [
          f.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await state(f.id)).versions).toHaveLength(3);
  });

  it('publishes and withdraws using the actual least-privilege Publisher role without mutable dependency grants', async () => {
    const f = await publicCandidate();
    await administrator.query(`CREATE ROLE hzense_publisher LOGIN PASSWORD 'synthetic-publication-only'
      NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`);
    publisherRoleCreated = true;
    await pool.query(`REVOKE CREATE,TEMPORARY ON DATABASE ${identifier(databaseName)} FROM PUBLIC`);
    const grants = await readFile(
      new URL('../../../db/roles/configure_signal_publisher.sql', import.meta.url),
      'utf8',
    );
    await pool.query(grants);
    const url = new URL(databaseUrl());
    url.username = 'hzense_publisher';
    url.password = 'synthetic-publication-only';
    const restricted = new Pool({ connectionString: url.toString(), max: 1 });
    await administrator.query(`CREATE ROLE hzense_runtime LOGIN PASSWORD 'synthetic-public-reader'
      NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`);
    runtimeRoleCreated = true;
    await pool.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO hzense_runtime;
      GRANT USAGE ON SCHEMA public TO hzense_runtime`);
    await pool.query(
      await readFile(
        new URL('../../../db/roles/configure_public_signal_reader.sql', import.meta.url),
        'utf8',
      ),
    );
    const readerUrl = new URL(databaseUrl());
    readerUrl.username = 'hzense_runtime';
    readerUrl.password = 'synthetic-public-reader';
    const reader = new Pool({ connectionString: readerUrl.toString(), max: 1 });
    try {
      await expect(
        publishVerifiedSignal({ pool: restricted, request: f.request }),
      ).resolves.toMatchObject({
        outcome: 'apply',
        current_public: true,
      });
      await expect(verifyCurrentPublicSignalReaderAccess(reader)).resolves.toEqual({
        ok: true,
        problems: [],
      });
      expect(
        (
          await reader.query(
            'SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1',
            [f.id],
          )
        ).rows,
      ).toEqual([{ signal_id: f.id }]);
      for (const sql of [
        'SELECT * FROM public.signal_candidate_verifications',
        'SELECT * FROM public.signal_verification_dependency_seals',
        'SELECT * FROM public.public_source_evidence',
        "SELECT public.hzense_signal_dependency_seal('missing',1)",
        "SELECT public.hzense_lock_publication_dependencies('missing',1)",
      ])
        await expect(reader.query(sql)).rejects.toMatchObject({ code: '42501' });
      for (const sql of [
        'UPDATE public.sources SET name=name',
        'UPDATE public.entities SET name=name',
        'UPDATE public.signal_publication_control SET publication_enabled=true',
        'UPDATE public.signal_candidate_verifications SET verifier_id=verifier_id',
        'UPDATE public.signal_verification_dependency_seals SET invalidated=false',
      ])
        await expect(restricted.query(sql)).rejects.toMatchObject({ code: '42501' });
      await expect(
        withdrawPublicSignal({ pool: restricted, request: withdrawal(f) }),
      ).resolves.toMatchObject({
        outcome: 'apply',
        status: 'withdrawn',
        current_public: false,
      });
      expect(
        (
          await reader.query(
            'SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1',
            [f.id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await restricted.end();
      await reader.end();
    }
  });

  it('does not call an older public receipt current after withdrawal and a newer publication', async () => {
    const f = await publicCandidate();
    await publishVerifiedSignal({ pool, request: f.request });
    await withdrawPublicSignal({ pool, request: withdrawal(f) });
    await expect(
      publishVerifiedSignal({
        pool,
        request: {
          ...f.request,
          request_key: `republish:${randomUUID()}`,
          target_version: 4,
          expected_revision: 2,
          reason_code: 'republication',
        },
      }),
    ).resolves.toMatchObject({ current_public: true, content_version: 4, publication_revision: 3 });
    await expect(publishVerifiedSignal({ pool, request: f.request })).resolves.toMatchObject({
      outcome: 'replay',
      content_version: 3,
      publication_revision: 1,
      current_public: false,
    });
  });

  it.each([
    [
      'snapshot',
      "UPDATE public.signal_versions SET title='Tampered synthetic title' WHERE signal_id=$1 AND version=3",
      'Public target must clone',
    ],
    [
      'edges',
      'DELETE FROM public.signal_version_topics WHERE signal_id=$1 AND version=3',
      'Public target edges must exactly clone',
    ],
    [
      'controls',
      'UPDATE public.signal_publication_control SET publication_enabled=false WHERE $1::text IS NOT NULL',
      'Public publication controls or lease',
    ],
  ])(
    'enforces the permit database guard after bypassing the service %s check',
    async (_name, tamperSql, expectedMessage) => {
      const f = await publicCandidate();
      let guardError;
      // Test-only owner injection represents direct SQL bypassing the already
      // completed JS validation. The production service accepts no callbacks.
      const directSqlPool = {
        async connect() {
          const client = await pool.connect();
          return {
            release: (error) => client.release(error),
            async query(sql, args) {
              if (!sql.includes('INSERT INTO public.signal_publication_permits'))
                return client.query(sql, args);
              await client.query(tamperSql, [f.id]);
              try {
                return await client.query(sql, args);
              } catch (error) {
                guardError = error;
                throw error;
              }
            },
          };
        },
      };
      await expect(
        publishVerifiedSignal({ pool: directSqlPool, request: f.request }),
      ).rejects.toMatchObject({ code: 'database_unavailable' });
      expect(guardError).toMatchObject({ code: '23514' });
      expect(guardError.message).toContain(expectedMessage);
      expect((await state(f.id)).versions).toHaveLength(2);
      expect(
        (
          await pool.query('SELECT * FROM public.signal_publication_state WHERE signal_id=$1', [
            f.id,
          ])
        ).rows,
      ).toEqual([]);
    },
  );

  it('keeps a legacy private publication hidden and refuses to adopt its request as a public permit', async () => {
    const f = await publicCandidate();
    await publish({ pool, request: f.request });
    expect(
      (
        await pool.query('SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1', [
          f.id,
        ])
      ).rows,
    ).toEqual([]);
    await expect(publishVerifiedSignal({ pool, request: f.request })).rejects.toMatchObject({
      code: 'unbound_publication_receipt',
    });
  });

  it('requires a recorded assembly instead of trusting a writer-verified source version', async () => {
    const f = await fixture();
    await expect(publishVerifiedSignal({ pool, request: f.request })).rejects.toMatchObject({
      code: 'assembly_not_found',
    });
    await expectNoWrite(f);
  });

  it('withdraws independently of disabled publication, cancelled runs and invalid evidence, with safe replay', async () => {
    const f = await publicCandidate();
    await publishVerifiedSignal({ pool, request: f.request });
    await cancel({ pool, request: { run_id: f.run.run_id } });
    await pool.query('UPDATE public.signal_publication_control SET publication_enabled=false');
    await pool.query(
      "UPDATE public.public_source_evidence SET verification_status='rejected' WHERE id=$1",
      [`${f.id}-evidence`],
    );
    const request = withdrawal(f);
    await expect(withdrawPublicSignal({ pool, request })).resolves.toMatchObject({
      outcome: 'apply',
      status: 'withdrawn',
      publication_revision: 2,
      current_public: false,
    });
    await expect(withdrawPublicSignal({ pool, request })).resolves.toMatchObject({
      outcome: 'replay',
      current_public: false,
    });
    await expect(publishVerifiedSignal({ pool, request: f.request })).resolves.toMatchObject({
      outcome: 'replay',
      status: 'published',
      current_public: false,
    });
    expect((await state(f.id)).heads[0].status).toBe('withdrawn');
  });

  it('permanently removes current visibility when a reviewed dependency changes and is later restored', async () => {
    const f = await publicCandidate();
    await publishVerifiedSignal({ pool, request: f.request });
    await pool.query("UPDATE public.entities SET name='Changed identity' WHERE id=$1", [
      `${f.id}-person`,
    ]);
    expect(
      (
        await pool.query('SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1', [
          f.id,
        ])
      ).rowCount,
    ).toBe(0);
    await pool.query("UPDATE public.entities SET name='Synthetic Person' WHERE id=$1", [
      `${f.id}-person`,
    ]);
    expect(
      (
        await pool.query('SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1', [
          f.id,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(publishVerifiedSignal({ pool, request: f.request })).resolves.toMatchObject({
      outcome: 'replay',
      current_public: false,
    });
  });

  it('rejects changed evidence metadata between assembly and public publication without a new version', async () => {
    const f = await publicCandidate();
    await pool.query("UPDATE public.sources SET name='Changed source' WHERE id=$1", [
      `${f.id}-source`,
    ]);
    await expect(publishVerifiedSignal({ pool, request: f.request })).rejects.toMatchObject({
      code: 'verification_material_changed',
    });
    expect((await state(f.id)).versions).toHaveLength(2);
    expect((await state(f.id)).events).toHaveLength(0);
  });

  it('cannot publish an assembly whose dependency changed and was restored after verification', async () => {
    const f = await publicCandidate();
    await pool.query("UPDATE public.entities SET name='Changed identity' WHERE id=$1", [
      `${f.id}-person`,
    ]);
    await pool.query("UPDATE public.entities SET name='Synthetic Person' WHERE id=$1", [
      `${f.id}-person`,
    ]);
    await expect(publishVerifiedSignal({ pool, request: f.request })).rejects.toMatchObject({
      code: 'dependency_invalidated',
    });
    expect((await state(f.id)).versions).toHaveLength(2);
    expect((await state(f.id)).events).toHaveLength(0);
  });

  it('cannot publish a verified assembly while the current global publication switch is disabled', async () => {
    const f = await publicCandidate();
    await pool.query('UPDATE public.signal_publication_control SET publication_enabled=false');
    await expect(publishVerifiedSignal({ pool, request: f.request })).rejects.toMatchObject({
      code: 'publication_disabled',
    });
    expect((await state(f.id)).versions).toHaveLength(2);
    expect((await state(f.id)).events).toHaveLength(0);
  });

  it('serializes concurrent public requests into one committed publication and one historical replay', async () => {
    const f = await publicCandidate();
    const results = await Promise.all([
      publishVerifiedSignal({ pool, request: f.request }),
      publishVerifiedSignal({ pool, request: f.request }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['apply', 'replay']);
    expect((await state(f.id)).events).toHaveLength(1);
    expect((await state(f.id)).versions).toHaveLength(3);
  });

  it('rejects stale independent withdrawal and does not change the current public version', async () => {
    const f = await publicCandidate();
    await publishVerifiedSignal({ pool, request: f.request });
    await expect(
      withdrawPublicSignal({ pool, request: { ...withdrawal(f), expected_revision: 0 } }),
    ).rejects.toMatchObject({ code: 'stale_revision' });
    expect(
      (
        await pool.query('SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1', [
          f.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('rechecks verification TTL after a real post-write wait and rolls back publication and permit', async () => {
    const f = await publicCandidate({ valid_for_seconds: 1 });
    const blocker = await pool.connect();
    const worker = await pool.connect();
    let operation;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE public.signal_publication_permits IN SHARE MODE');
      const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      operation = settle(
        publishVerifiedSignal({
          pool: { connect: async () => ({ query: worker.query.bind(worker), release() {} }) },
          request: f.request,
        }),
      );
      await observeBlocked(blocker, pid);
      const deadline = Date.now() + 5000;
      while (
        !(
          await blocker.query(
            'SELECT expires_at<=clock_timestamp() AS expired FROM public.signal_candidate_verifications WHERE verification_id=$1',
            [f.verification.verification_id],
          )
        ).rows[0].expired
      ) {
        if (Date.now() > deadline) throw new Error('Synthetic verification failed to expire');
        await delay(10);
      }
      await blocker.query('ROLLBACK');
      expect((await operation).error).toBeDefined();
      expect((await state(f.id)).versions).toHaveLength(2);
      expect((await state(f.id)).events).toHaveLength(0);
      expect(
        (
          await pool.query(
            'SELECT signal_id FROM public.current_public_signals WHERE signal_id=$1',
            [f.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (operation) await operation;
      worker.release();
    }
  });

  it('assembles sealed pending people into a new candidate, then separately publishes it', async () => {
    const f = await pendingCandidate();
    await expect(publish({ pool, request: f.request })).rejects.toMatchObject({
      code: 'unverified_entity_link',
    });
    const v = await verifyCandidate(f);
    const result = await assemblePrivateVerifiedSignalCandidate({ pool, request: v.request });
    expect(result).toMatchObject({ scope: 'private_verified_candidate', outcome: 'assembled' });
    const people = await pool.query(
      'SELECT version,verification_status FROM public.signal_version_people WHERE signal_id=$1 ORDER BY version',
      [f.id],
    );
    expect(people.rows).toEqual([
      { version: 1, verification_status: 'pending' },
      { version: 2, verification_status: 'verified' },
    ]);
    const beforePublish = await state(f.id);
    expect(beforePublish.heads).toEqual([]);
    expect(beforePublish.events).toEqual([]);
    const original = beforePublish.versions[0];
    const candidate = beforePublish.versions[1];
    for (const key of ['title', 'summary', 'analysis', 'occurred_at', 'captured_at', 'origin'])
      expect(candidate[key]).toEqual(original[key]);
    expect(candidate.content_hash).not.toBe(original.content_hash);
    await expect(
      publish({ pool, request: { ...f.request, source_version: 2, target_version: 3 } }),
    ).resolves.toMatchObject({ scope: 'private_recorded_qualification', outcome: 'apply' });
    expect((await state(f.id)).versions).toHaveLength(3);
  });

  it('records and assembles while publishing is disabled without writing head or outbox', async () => {
    const f = await pendingCandidate();
    await pool.query('UPDATE public.signal_publication_control SET publication_enabled=false');
    const v = await verifyCandidate(f);
    await assemblePrivateVerifiedSignalCandidate({ pool, request: v.request });
    expect((await state(f.id)).heads).toEqual([]);
    await expect(
      publish({ pool, request: { ...f.request, source_version: 2, target_version: 3 } }),
    ).rejects.toBeDefined();
  });

  it('records a rejected assessment but refuses to assemble it', async () => {
    const f = await pendingCandidate();
    const request = await verificationRequest(f);
    request.decision = 'rejected';
    request.checks.people_disambiguated = false;
    await recordPrivateCandidateVerification({ pool, request });
    await expect(
      assemblePrivateVerifiedSignalCandidate({ pool, request: assemblyRequest(f, request) }),
    ).rejects.toMatchObject({ code: 'verification_not_approved' });
    await expectNoWrite(f);
  });

  it.each(['pending', 'rejected'])(
    'never upgrades global %s Evidence as a side effect',
    async (status) => {
      const f = await pendingCandidate();
      await pool.query(
        'UPDATE public.public_source_evidence SET verification_status=$1 WHERE id=$2',
        [status, `${f.id}-evidence`],
      );
      await expect(verificationRequest(f)).rejects.toMatchObject({ code: 'unverified_evidence' });
      expect(
        (
          await pool.query(
            'SELECT verification_status FROM public.public_source_evidence WHERE id=$1',
            [`${f.id}-evidence`],
          )
        ).rows[0].verification_status,
      ).toBe(status);
      await expectNoWrite(f);
    },
  );

  it('rejects material change between review reading and record ingestion', async () => {
    const f = await pendingCandidate();
    const request = await verificationRequest(f);
    await pool.query(
      "UPDATE public.sources SET allowed_hosts=ARRAY['example.com','new.example.com'] WHERE id=$1",
      [`${f.id}-source`],
    );
    await expect(recordPrivateCandidateVerification({ pool, request })).rejects.toMatchObject({
      code: 'verification_material_changed',
    });
    expect(
      (
        await pool.query(
          'SELECT verification_id FROM public.signal_candidate_verifications WHERE signal_id=$1',
          [f.id],
        )
      ).rows,
    ).toEqual([]);
  });

  it('rejects dependency drift after recording even if the changed policy would still qualify', async () => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    await pool.query(
      "UPDATE public.sources SET allowed_hosts=ARRAY['example.com','new.example.com'] WHERE id=$1",
      [`${f.id}-source`],
    );
    await expect(
      assemblePrivateVerifiedSignalCandidate({ pool, request: v.request }),
    ).rejects.toMatchObject({ code: 'verification_material_changed' });
    await expectNoWrite(f);
  });

  it('replays a verification ID only for the exact original report and duration', async () => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    await expect(
      recordPrivateCandidateVerification({ pool, request: v.verification }),
    ).resolves.toMatchObject({ outcome: 'replay', scope: 'private_historical_verification' });
    for (const patch of [{ verifier_id: randomUUID() }, { valid_for_seconds: 10 }]) {
      await expect(
        recordPrivateCandidateVerification({ pool, request: { ...v.verification, ...patch } }),
      ).rejects.toMatchObject({ code: 'verification_key_reused' });
    }
  });

  it.each([
    ["UPDATE public.entities SET name='Different Person' WHERE id=$1", '-person'],
    ["UPDATE public.entities SET aliases=ARRAY['Different Alias'] WHERE id=$1", '-person'],
    [
      'UPDATE public.entities SET metadata=\'{"identity":"different"}\'::jsonb WHERE id=$1',
      '-person',
    ],
    ["UPDATE public.sources SET name='Different Source' WHERE id=$1", '-source'],
    ["UPDATE public.sources SET type='paper' WHERE id=$1", '-source'],
    ['UPDATE public.sources SET trust_score=1 WHERE id=$1', '-source'],
  ])('invalidates reviewed identity/source details on change: %s', async (sql, suffix) => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    await pool.query(sql, [`${f.id}${suffix}`]);
    await expect(
      assemblePrivateVerifiedSignalCandidate({ pool, request: v.request }),
    ).rejects.toMatchObject({ code: 'verification_material_changed' });
    await expectNoWrite(f);
  });

  it('rejects Evidence microseconds before the pg Date decoder can truncate them', async () => {
    const f = await fixture({
      beforeSeal: async (client, id) => {
        await client.query(
          "UPDATE public.public_source_evidence SET captured_at='2026-09-13T08:10:11.678901Z' WHERE id=$1",
          [`${id}-evidence`],
        );
      },
    });
    await expect(verificationRequest(f)).rejects.toMatchObject({
      code: 'invalid_material_timestamp',
    });
    await expectNoWrite(f);
  });

  it('binds exact JSONB text even when pg decodes two metadata numerics to the same JS value', async () => {
    const f = await pendingCandidate();
    await pool.query('UPDATE public.entities SET metadata=$1::jsonb WHERE id=$2', [
      '{"identity":9007199254740992}',
      `${f.id}-person`,
    ]);
    const v = await verifyCandidate(f);
    await pool.query('UPDATE public.entities SET metadata=$1::jsonb WHERE id=$2', [
      '{"identity":9007199254740993}',
      `${f.id}-person`,
    ]);
    expect(
      (await pool.query('SELECT metadata FROM public.entities WHERE id=$1', [`${f.id}-person`]))
        .rows[0].metadata.identity,
    ).toBe(9007199254740992);
    await expect(
      assemblePrivateVerifiedSignalCandidate({ pool, request: v.request }),
    ).rejects.toMatchObject({ code: 'verification_material_changed' });
    await expectNoWrite(f);
  });

  it('permits historical assembly replay but forbids record reuse and semantic key reuse', async () => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    await assemblePrivateVerifiedSignalCandidate({ pool, request: v.request });
    await pool.query('UPDATE public.sources SET active=false WHERE id=$1', [`${f.id}-source`]);
    await expect(
      assemblePrivateVerifiedSignalCandidate({ pool, request: v.request }),
    ).resolves.toMatchObject({ outcome: 'replay', scope: 'private_historical_assembly' });
    await expect(
      assemblePrivateVerifiedSignalCandidate({
        pool,
        request: { ...v.request, target_version: 3 },
      }),
    ).rejects.toMatchObject({ code: 'assembly_key_reused' });
    await expect(
      assemblePrivateVerifiedSignalCandidate({
        pool,
        request: { ...v.request, request_key: 'another-key', target_version: 3 },
      }),
    ).rejects.toMatchObject({ code: 'verification_already_consumed' });
    expect((await state(f.id)).versions).toHaveLength(2);
  });

  it('serializes competing keys consuming the same verification into exactly one new version', async () => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    const results = await Promise.all([
      settle(assemblePrivateVerifiedSignalCandidate({ pool, request: v.request })),
      settle(
        assemblePrivateVerifiedSignalCandidate({
          pool,
          request: { ...v.request, request_key: 'concurrent-other-key', target_version: 3 },
        }),
      ),
    ]);
    expect(results.filter((r) => r.value)).toHaveLength(1);
    expect(results.find((r) => r.error).error.code).toBe('verification_already_consumed');
    expect((await state(f.id)).versions).toHaveLength(2);
  });

  it('rejects a verification record bound to a different Signal', async () => {
    const f = await pendingCandidate();
    const other = await pendingCandidate();
    const v = await verifyCandidate(f);
    await expect(
      assemblePrivateVerifiedSignalCandidate({
        pool,
        request: { ...v.request, signal_id: other.id },
      }),
    ).rejects.toMatchObject({ code: 'verification_material_changed' });
    await expectNoWrite(other);
  });

  it('rechecks expiry after a real post-write table lock wait and rolls back all assembly rows', async () => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f, { valid_for_seconds: 1 });
    const blocker = await pool.connect();
    const worker = await pool.connect();
    let operation;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE public.signal_candidate_assembly_receipts IN SHARE MODE');
      const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      // Fixture wrapper reserves a genuinely independent, idle client, not a transaction.
      operation = settle(
        assemblePrivateVerifiedSignalCandidate({
          pool: { connect: async () => ({ query: worker.query.bind(worker), release() {} }) },
          request: v.request,
        }),
      );
      await observeBlocked(blocker, pid);
      const deadline = Date.now() + 5000;
      while (
        !(
          await blocker.query(
            'SELECT expires_at<=clock_timestamp() AS expired FROM public.signal_candidate_verifications WHERE verification_id=$1',
            [v.verification.verification_id],
          )
        ).rows[0].expired
      ) {
        if (Date.now() > deadline) throw new Error('Synthetic verification failed to expire');
        await delay(10);
      }
      await blocker.query('ROLLBACK');
      expect((await operation).error).toBeDefined();
      await expectNoWrite(f);
      expect(
        (
          await pool.query(
            'SELECT request_key FROM public.signal_candidate_assembly_receipts WHERE signal_id=$1',
            [f.id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await blocker.query('ROLLBACK');
      if (operation) await operation;
      blocker.release();
      worker.release();
    }
  });

  it.each([
    'UPDATE public.signal_candidate_verifications SET verifier_id=verifier_id WHERE verification_id=$1',
    'DELETE FROM public.signal_candidate_verifications WHERE verification_id=$1',
    'TRUNCATE public.signal_candidate_verifications,public.signal_candidate_assembly_receipts,public.signal_verification_dependency_seals,public.signal_publication_permits',
    'UPDATE public.signal_candidate_assembly_receipts SET content_hash=content_hash WHERE verification_id=$1',
    'DELETE FROM public.signal_candidate_assembly_receipts WHERE verification_id=$1',
    'TRUNCATE public.signal_candidate_assembly_receipts',
  ])('keeps verification and assembly evidence immutable: %s', async (sql) => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    await assemblePrivateVerifiedSignalCandidate({ pool, request: v.request });
    await expect(
      pool.query(sql, sql.includes('$1') ? [v.verification.verification_id] : []),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it.each([
    ['source_content_hash', "repeat('0',64)"],
    ['created_xid', "'0'::xid8"],
    ['verified_at', "date_trunc('milliseconds',statement_timestamp()) - interval '1 second'"],
    ['expires_at', "date_trunc('milliseconds',statement_timestamp()) + interval '25 hours'"],
    ['checks', "'[]'::jsonb"],
  ])('rejects direct SQL forged verification %s', async (column, replacement) => {
    const f = await pendingCandidate();
    const v = await verifyCandidate(f);
    const columns = [
      'verification_id',
      'signal_id',
      'source_version',
      'source_content_hash',
      'bundle_fingerprint',
      'verifier_id',
      'policy_version',
      'report_hash',
      'decision',
      'checks',
      'verified_at',
      'expires_at',
      'created_xid',
    ];
    const expressions = columns.map((field) => {
      if (field === column) return replacement;
      if (field === 'verification_id') return '$1::uuid';
      if (field === 'verified_at') return "date_trunc('milliseconds',statement_timestamp())";
      if (field === 'expires_at')
        return "date_trunc('milliseconds',statement_timestamp()) + interval '1 hour'";
      if (field === 'created_xid') return 'pg_current_xact_id()';
      return field;
    });
    const result = await settle(
      pool.query(
        `INSERT INTO public.signal_candidate_verifications (${columns.join(',')})
       SELECT ${expressions.join(',')} FROM public.signal_candidate_verifications WHERE verification_id=$2`,
        [randomUUID(), v.verification.verification_id],
      ),
    );
    expect(['23514', '55000']).toContain(result.error?.code);
    expect(
      (
        await pool.query(
          'SELECT verification_id FROM public.signal_candidate_verifications WHERE signal_id=$1',
          [f.id],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
