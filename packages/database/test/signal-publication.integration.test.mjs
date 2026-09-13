import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { waitForDatabaseDisconnects } from './database-disconnect.mjs';
import { collectSignalImmutabilityProblems } from '../src/signal-immutability-catalog.mjs';

const { Client, Pool } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const databaseName = `hzense_publication_test_${suffix}`;
const ownerRole = `hzense_publication_owner_${suffix}`;
const ownerPassword = 'test-only-private-publication';

function identifier(value) {
  if (!/^hzense_publication_(?:test|owner)_[0-9]+_[0-9]+$/.test(value)) {
    throw new Error('Unsafe private-publication fixture identifier');
  }
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

async function withClient(callback) {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

function request(signalId, requestKey, overrides = {}) {
  return {
    signal_id: signalId,
    request_key: requestKey,
    action: 'publish',
    target_version: 1,
    expected_revision: 0,
    reason_code: 'initial_publication',
    ...overrides,
  };
}

// Deliberately NOT eligible public content: no Person edge, pending evidence,
// legacy inbox and no task, authorization, policy or lease records. These tests
// exercise a private persistence primitive, never a production publish service.
async function seedPrivateSignal(prefix, withIdentity = true) {
  if (!/^[a-z][a-z0-9-]+$/.test(prefix)) throw new Error('Unsafe fixture Signal prefix');
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO sources(id,name,type,trust_score,allowed_hosts)
          VALUES ('${prefix}-source','Private fixture source','website',80,ARRAY['example.com']);
        INSERT INTO signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty)
          VALUES ('${prefix}','Private fixture','research','2026-01-01T00:00:00Z','2026-09-13T00:00:00Z',
            '${prefix}-source','https://example.com/event','Private fixture summary',3,3,0.8,0.6);
        INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,
          importance,strength,confidence,novelty,revision_reason,origin,content_hash)
          SELECT '${prefix}',version,'Private fixture','research','2026-01-01T00:00:00Z','day','Fixture event date',
            '2026-09-13T00:00:00Z','Private fixture summary',3,3,0.8,0.6,'Fixture revision','manual',repeat('a',64)
          FROM generate_series(1,3) AS version;
        INSERT INTO public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at)
          VALUES ('${prefix}-evidence','${prefix}-source','https://example.com/event','paragraph 1','Fixture excerpt',repeat('b',64),'2026-09-13T00:00:00Z');
        INSERT INTO signal_version_evidence(signal_id,version,evidence_id,claim,relation)
          SELECT '${prefix}',version,'${prefix}-evidence','Fixture claim','supports' FROM generate_series(1,3) AS version;
      `);
      if (withIdentity) {
        await client.query(`INSERT INTO signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis)
          VALUES ('${prefix}','${prefix}-event',1,'${prefix}-evidence','Private fixture identity')`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  return prefix;
}

async function readPair(signalId) {
  return withClient(async (client) => ({
    heads: (
      await client.query('SELECT * FROM public.signal_publication_state WHERE signal_id=$1', [
        signalId,
      ])
    ).rows,
    events: (
      await client.query(
        'SELECT * FROM public.signal_publication_outbox WHERE signal_id=$1 ORDER BY publication_revision',
        [signalId],
      )
    ).rows,
  }));
}

function receipt(signalId, revision = 1, overrides = {}) {
  return {
    event_id: randomUUID(),
    request_key: `direct:${signalId}:${revision}`,
    request_fingerprint: 'c'.repeat(64),
    signal_id: signalId,
    expected_revision: revision - 1,
    publication_revision: revision,
    content_version: 1,
    status: revision === 1 ? 'published' : 'withdrawn',
    reason_code: revision === 1 ? 'initial_publication' : 'operator_request',
    occurred_at: new Date('2026-09-13T00:00:00.000Z'),
    ...overrides,
  };
}

async function insertReceipt(client, event) {
  await client.query(
    `INSERT INTO public.signal_publication_outbox
    (event_id,request_key,request_fingerprint,signal_id,expected_revision,publication_revision,content_version,status,reason_code,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      event.event_id,
      event.request_key,
      event.request_fingerprint,
      event.signal_id,
      event.expected_revision,
      event.publication_revision,
      event.content_version,
      event.status,
      event.reason_code,
      event.occurred_at,
    ],
  );
}

async function writeHead(client, event) {
  await client.query(
    `INSERT INTO public.signal_publication_state
    (signal_id,publication_revision,content_version,status,event_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT(signal_id) DO UPDATE SET publication_revision=EXCLUDED.publication_revision,
      content_version=EXCLUDED.content_version,status=EXCLUDED.status,event_id=EXCLUDED.event_id,occurred_at=EXCLUDED.occurred_at`,
    [
      event.signal_id,
      event.publication_revision,
      event.content_version,
      event.status,
      event.event_id,
      event.occurred_at,
    ],
  );
}

async function rejected(client, callback, codes = ['23514']) {
  await client.query('SAVEPOINT invalid_publication_pair');
  try {
    let failure;
    try {
      await callback();
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(codes).toContain(failure?.code);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT invalid_publication_pair');
    await client.query('RELEASE SAVEPOINT invalid_publication_pair');
  }
}

suite('PostgreSQL private Signal publication state and permanent Outbox receipts', () => {
  let administrator;
  let pool;
  let record;
  let roleCreated = false;
  let databaseCreated = false;

  beforeAll(async () => {
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
    pool = new Pool({ connectionString: databaseUrl(), max: 4 });
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

  it('atomically records only private metadata without upgrading missing eligibility or legacy status', async () => {
    const signalId = await seedPrivateSignal('private-boundary');
    const result = await record({ pool, request: request(signalId, 'private-boundary:publish') });
    expect(result.outcome).toBe('apply');
    const pair = await readPair(signalId);
    expect(pair.heads).toHaveLength(1);
    expect(pair.events).toHaveLength(1);
    expect(pair.heads[0]).toMatchObject({
      signal_id: signalId,
      publication_revision: 1,
      content_version: 1,
      status: 'published',
      event_id: pair.events[0].event_id,
    });
    expect(pair.heads[0].occurred_at).toEqual(pair.events[0].occurred_at);
    await withClient(async (client) => {
      expect(
        (await client.query('SELECT status FROM signals WHERE id=$1', [signalId])).rows,
      ).toEqual([{ status: 'inbox' }]);
      expect(
        (
          await client.query('SELECT verification_status FROM public_source_evidence WHERE id=$1', [
            `${signalId}-evidence`,
          ])
        ).rows,
      ).toEqual([{ verification_status: 'pending' }]);
      expect(
        (
          await client.query(
            'SELECT count(*)::integer AS count FROM signal_version_people WHERE signal_id=$1',
            [signalId],
          )
        ).rows[0].count,
      ).toBe(0);
      const access =
        await client.query(`SELECT bool_or(has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) AS allowed
        FROM pg_class WHERE oid IN ('public.signal_publication_state'::regclass,'public.signal_publication_outbox'::regclass)`);
      expect(access.rows[0].allowed).toBe(false);
      expect(await collectSignalImmutabilityProblems(client, ownerRole)).toEqual([]);
    });
    expect(Object.keys(pair.events[0]).sort()).toEqual([
      'content_version',
      'event_id',
      'expected_revision',
      'occurred_at',
      'publication_revision',
      'reason_code',
      'request_fingerprint',
      'request_key',
      'signal_id',
      'status',
    ]);
  });

  it('orders publish, withdrawal and republication by publication revision rather than content version', async () => {
    const signalId = await seedPrivateSignal('ordered-transitions');
    for (const command of [
      request(signalId, 'ordered:publish'),
      request(signalId, 'ordered:withdraw', {
        action: 'withdraw',
        expected_revision: 1,
        reason_code: 'privacy',
      }),
      request(signalId, 'ordered:republish', {
        target_version: 2,
        expected_revision: 2,
        reason_code: 'republication',
      }),
    ])
      expect((await record({ pool, request: command })).outcome).toBe('apply');
    const pair = await readPair(signalId);
    expect(
      pair.events.map(({ publication_revision, content_version, status }) => ({
        publication_revision,
        content_version,
        status,
      })),
    ).toEqual([
      { publication_revision: 1, content_version: 1, status: 'published' },
      { publication_revision: 2, content_version: 1, status: 'withdrawn' },
      { publication_revision: 3, content_version: 2, status: 'published' },
    ]);
    expect(pair.heads[0]).toMatchObject({
      publication_revision: 3,
      content_version: 2,
      status: 'published',
      event_id: pair.events[2].event_id,
    });
  });

  it('replays the original receipt after withdrawal without reviving the old head or duplicating an event', async () => {
    const signalId = await seedPrivateSignal('permanent-receipt');
    const publish = request(signalId, 'receipt:publish');
    const withdraw = request(signalId, 'receipt:withdraw', {
      action: 'withdraw',
      expected_revision: 1,
      reason_code: 'evidence_revoked',
    });
    await record({ pool, request: publish });
    await record({ pool, request: withdraw });
    const before = await readPair(signalId);
    expect(await record({ pool, request: publish })).toMatchObject({
      outcome: 'replay',
      current_head_unchanged: true,
      current_head: { publication_revision: 2, status: 'withdrawn' },
      receipt: { publication_revision: 1, status: 'published' },
    });
    expect((await record({ pool, request: withdraw })).outcome).toBe('replay');
    expect(await readPair(signalId)).toEqual(before);
    expect(await record({ pool, request: { ...publish, target_version: 2 } })).toMatchObject({
      outcome: 'conflict',
      reason: 'request_key_reused',
    });
    expect(await readPair(signalId)).toEqual(before);
  });

  it('rejects stale revisions and invalid transitions without creating a receipt', async () => {
    const signalId = await seedPrivateSignal('rejected-transition');
    expect(
      (
        await record({
          pool,
          request: request(signalId, 'reject:first-withdraw', {
            action: 'withdraw',
            reason_code: 'operator_request',
          }),
        })
      ).outcome,
    ).toBe('rejected');
    expect(await readPair(signalId)).toEqual({ heads: [], events: [] });
    await record({ pool, request: request(signalId, 'reject:publish') });
    const before = await readPair(signalId);
    expect(
      await record({
        pool,
        request: request(signalId, 'reject:stale', {
          target_version: 2,
          reason_code: 'content_correction',
        }),
      }),
    ).toMatchObject({ outcome: 'conflict', reason: 'stale_revision' });
    expect(
      (
        await record({
          pool,
          request: request(signalId, 'reject:same-version', {
            expected_revision: 1,
            reason_code: 'content_correction',
          }),
        })
      ).outcome,
    ).toBe('rejected');
    expect(await readPair(signalId)).toEqual(before);
  });

  it('rejects missing Signals, versions and event identities without leaving either side of the pair', async () => {
    await expect(
      record({ pool, request: request('missing-publication-signal', 'missing:signal') }),
    ).rejects.toThrow('missing Signal');
    for (const [signalId, withIdentity, targetVersion] of [
      ['missing-version', true, 9],
      ['missing-identity', false, 1],
    ]) {
      await seedPrivateSignal(signalId, withIdentity);
      await expect(
        record({
          pool,
          request: request(signalId, `${signalId}:request`, { target_version: targetVersion }),
        }),
      ).rejects.toMatchObject({ code: '23503' });
      expect(await readPair(signalId)).toEqual({ heads: [], events: [] });
    }
  });

  for (const stage of ['before-head', 'before-commit']) {
    it(`rolls back the event and head after an injected ${stage} database-client failure`, async () => {
      const signalId = await seedPrivateSignal(`rollback-${stage}`);
      let injected = false;
      const faultPool = {
        connect: async () => {
          const borrowed = await pool.connect();
          return {
            release: (error) => borrowed.release(error),
            query: async (sql, values) => {
              const match =
                stage === 'before-head'
                  ? /INSERT\s+INTO\s+public\.signal_publication_state/i.test(sql)
                  : /^COMMIT$/i.test(sql);
              if (!injected && match) {
                injected = true;
                throw new Error(`fixture ${stage} failure`);
              }
              return borrowed.query(sql, values);
            },
          };
        },
      };
      const command = request(signalId, `rollback:${stage}`);
      await expect(record({ pool: faultPool, request: command })).rejects.toThrow(
        `fixture ${stage} failure`,
      );
      expect(injected).toBe(true);
      expect(await readPair(signalId)).toEqual({ heads: [], events: [] });
      expect((await record({ pool, request: command })).outcome).toBe('apply');
    });
  }

  it('retries an ambiguous successful COMMIT with the same key without duplicating the receipt', async () => {
    const signalId = await seedPrivateSignal('lost-commit-response');
    let committed = false;
    const faultPool = {
      connect: async () => {
        const borrowed = await pool.connect();
        return {
          release: (error) => borrowed.release(error),
          query: async (sql, values) => {
            const result = await borrowed.query(sql, values);
            if (/^COMMIT$/i.test(sql) && !committed) {
              committed = true;
              throw new Error('fixture lost COMMIT response');
            }
            return result;
          },
        };
      },
    };
    const command = request(signalId, 'ambiguous:commit');
    await expect(record({ pool: faultPool, request: command })).rejects.toThrow(
      'lost COMMIT response',
    );
    expect(committed).toBe(true);
    const before = await readPair(signalId);
    expect(before.events).toHaveLength(1);
    expect((await record({ pool, request: command })).outcome).toBe('replay');
    expect(await readPair(signalId)).toEqual(before);
  });

  it('rejects orphan receipts at actual COMMIT and allows multiple events paired to the final head in one transaction', async () => {
    const signalId = await seedPrivateSignal('deferred-pair');
    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await insertReceipt(client, receipt(signalId));
        await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(await readPair(signalId)).toEqual({ heads: [], events: [] });
    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const first = receipt(signalId);
        const second = receipt(signalId, 2);
        await insertReceipt(client, first);
        await writeHead(client, first);
        await insertReceipt(client, second);
        await writeHead(client, second);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    const pair = await readPair(signalId);
    expect(pair.events).toHaveLength(2);
    expect(pair.heads[0]).toMatchObject({ publication_revision: 2, status: 'withdrawn' });
  });

  it('rejects direct orphan, mismatched, stale and deleted state without weakening the deferred pair guard', async () => {
    const signalId = await seedPrivateSignal('direct-state');
    await record({ pool, request: request(signalId, 'direct-state:publish') });
    const before = await readPair(signalId);
    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await rejected(client, () =>
          client.query('DELETE FROM signal_publication_state WHERE signal_id=$1', [signalId]),
        );
        await rejected(client, () => writeHead(client, receipt(signalId, 2)), ['23503', '23514']);
        await rejected(
          client,
          () =>
            client.query(
              "UPDATE signal_publication_state SET status='withdrawn' WHERE signal_id=$1",
              [signalId],
            ),
          ['23503', '23514'],
        );
        await rejected(client, () => insertReceipt(client, receipt(signalId, 2)));
        await rejected(client, async () => {
          const newer = receipt(signalId, 2);
          await insertReceipt(client, newer);
          await writeHead(client, newer);
          await writeHead(client, before.events[0]);
        });
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(await readPair(signalId)).toEqual(before);
  });

  it('keeps permanent receipts immutable and refuses TRUNCATE on both tables', async () => {
    const signalId = await seedPrivateSignal('immutable-receipt');
    await record({ pool, request: request(signalId, 'immutable:publish') });
    const before = await readPair(signalId);
    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const sql of [
          'UPDATE signal_publication_outbox SET request_fingerprint=request_fingerprint WHERE signal_id=$1',
          "UPDATE signal_publication_outbox SET reason_code='content_correction' WHERE signal_id=$1",
          'DELETE FROM signal_publication_outbox WHERE signal_id=$1',
        ])
          await rejected(client, () => client.query(sql, [signalId]), ['55000']);
        for (const table of ['signal_publication_state', 'signal_publication_outbox'])
          await rejected(client, () => client.query(`TRUNCATE ${table} CASCADE`), ['55000']);
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(await readPair(signalId)).toEqual(before);
  });

  const invalidReceiptInputs = [
    ['empty request key', { request_key: '' }],
    ['noncanonical request key character', { request_key: 'request/key' }],
    ['201-character request key', { request_key: 'a'.repeat(201) }],
    ['request key trailing newline', { request_key: 'request-key\n' }],
    ['non-hex fingerprint', { request_fingerprint: 'g'.repeat(64) }],
    ['short fingerprint', { request_fingerprint: 'a'.repeat(63) }],
    ['uppercase fingerprint', { request_fingerprint: 'A'.repeat(64) }],
    ['negative expected revision', { expected_revision: -1 }],
    ['zero publication revision', { expected_revision: 0, publication_revision: 0 }],
    ['nonconsecutive revision', { expected_revision: 0, publication_revision: 2 }],
    // The CHECK casts before addition, so this is a constraint violation,
    // not an integer-overflow error from evaluating expected_revision + 1.
    [
      'int32 revision overflow boundary',
      { expected_revision: 2_147_483_647, publication_revision: 1 },
    ],
    ['zero content version', { content_version: 0 }],
    ['unknown publication state', { status: 'pending' }],
    ['reason belonging to another action', { status: 'published', reason_code: 'privacy' }],
    ['infinite event time', { occurred_at: 'infinity' }],
    // Local year 0001 is not sufficient: this offset places the instant before
    // UTC year 0001. Likewise the second offset crosses into UTC year 10000.
    ['UTC year below 0001', { occurred_at: '0001-01-01T00:30:00+01:00' }],
    ['UTC year above 9999', { occurred_at: '9999-12-31T23:30:00-01:00' }],
    ['submillisecond event time', { occurred_at: '2026-09-13T00:00:00.000001Z' }],
  ];
  for (const [index, [label, changes]] of invalidReceiptInputs.entries()) {
    it(`rejects the actual PostgreSQL CHECK boundary: ${label}`, async () => {
      const signalId = await seedPrivateSignal(`sql-check-${index}`);
      await record({ pool, request: request(signalId, `sql-check:${index}:publish`) });
      const before = await readPair(signalId);
      await withClient(async (client) => {
        await client.query('BEGIN');
        try {
          // A valid committed pair already exists. Demand that INSERT itself
          // fails, before the deferred pair guard can reject an orphan event.
          await expect(insertReceipt(client, receipt(signalId, 2, changes))).rejects.toMatchObject({
            code: '23514',
          });
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(await readPair(signalId)).toEqual(before);
    });
  }

  it('detects an extra user trigger in the shared exact catalog and restores the intact contract', async () => {
    await withClient(async (client) => {
      expect(await collectSignalImmutabilityProblems(client, ownerRole)).toEqual([]);
      await client.query('BEGIN');
      try {
        await client.query(`CREATE TRIGGER publication_unexpected BEFORE INSERT ON public.signal_publication_outbox
          FOR EACH ROW EXECUTE FUNCTION public.hzense_guard_publication_receipt()`);
        expect(
          (await collectSignalImmutabilityProblems(client, ownerRole)).some((problem) =>
            /unexpected user trigger/.test(problem),
          ),
        ).toBe(true);
      } finally {
        await client.query('ROLLBACK');
      }
      expect(await collectSignalImmutabilityProblems(client, ownerRole)).toEqual([]);
    });
  });

  async function race(firstRequest, secondRequest) {
    const firstPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const secondPool = new Pool({ connectionString: databaseUrl(), max: 1 });
    const blocker = await pool.connect();
    const pending = [];
    try {
      const firstPid = (await firstPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const secondPid = (await secondPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect(firstPid).not.toBe(secondPid);
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM signals WHERE id=$1 FOR UPDATE', [
        firstRequest.signal_id,
      ]);
      const observeBlocked = async (pid) => {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const result = await blocker.query(
            'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
            [pid],
          );
          if (result.rows[0].blocked) return;
          await delay(20);
        }
        throw new Error('Expected a real blocked PostgreSQL backend');
      };
      const settle = (promise) =>
        promise.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      pending.push(settle(record({ pool: firstPool, request: firstRequest })));
      await observeBlocked(firstPid);
      pending.push(settle(record({ pool: secondPool, request: secondRequest })));
      await observeBlocked(secondPid);
      await blocker.query('COMMIT');
      const results = await Promise.all(pending);
      for (const result of results) expect(result.error).toBeUndefined();
      return results.map((result) => result.value);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      await Promise.all(pending);
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  }

  it('serializes two different requests for one Signal so the stale revision cannot win', async () => {
    const signalId = await seedPrivateSignal('race-revision');
    const results = await race(request(signalId, 'race:first'), request(signalId, 'race:second'));
    expect(results.map(({ outcome }) => outcome)).toEqual(['apply', 'conflict']);
    expect(results[1]).toMatchObject({ reason: 'stale_revision' });
    expect((await readPair(signalId)).events).toHaveLength(1);
  }, 15_000);

  it('serializes simultaneous exact retries into one write and one permanent receipt replay', async () => {
    const signalId = await seedPrivateSignal('race-replay');
    const command = request(signalId, 'race:exact-retry');
    expect((await race(command, command)).map(({ outcome }) => outcome)).toEqual([
      'apply',
      'replay',
    ]);
    expect((await readPair(signalId)).events).toHaveLength(1);
  }, 15_000);

  it('classifies a concurrent cross-Signal request-key collision without leaking a unique violation', async () => {
    const firstId = await seedPrivateSignal('race-global-first');
    const secondId = await seedPrivateSignal('race-global-second');
    const results = await race(
      request(firstId, 'race:global-key'),
      request(secondId, 'race:global-key'),
    );
    expect(results[0].outcome).toBe('apply');
    expect(results[1]).toMatchObject({ outcome: 'conflict', reason: 'request_key_reused' });
    expect((await readPair(firstId)).events).toHaveLength(1);
    expect(await readPair(secondId)).toEqual({ heads: [], events: [] });
  }, 15_000);
});
