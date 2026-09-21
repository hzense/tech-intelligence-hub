import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { saveCandidateReview, readCandidateReviews } from '../src/candidate-review-store.mjs';
import { fixture } from './candidate-review.test.mjs';
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
suite('review PostgreSQL persistence and concurrency', () => {
  let admin,
    pool,
    created = false;
  const db = `hzense_review_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${db}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await pool.query(
      'CREATE TABLE public.signal_generation_runs(id uuid PRIMARY KEY,owner_id text,status text,deleted_at timestamptz,snapshot jsonb,source_hash text,result jsonb); CREATE TABLE public.signals(id text PRIMARY KEY); CREATE TABLE public.signal_versions(signal_id text,version int,PRIMARY KEY(signal_id,version));',
    );
    await pool.query(
      await readFile(
        new URL('../../../db/migrations/0020_candidate_reviews.sql', import.meta.url),
        'utf8',
      ),
    );
    await pool.query(
      await readFile(
        new URL('../../../db/migrations/0021_candidate_review_attestations.sql', import.meta.url),
        'utf8',
      ),
    );
  });
  afterAll(async () => {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    await admin?.end();
  });
  it('persists append-only revisions, exact retries and owner isolation', async () => {
    const { run, request } = fixture();
    await pool.query('INSERT INTO signal_generation_runs VALUES($1,$2,$3,NULL,$4,$5,$6)', [
      run.id,
      run.owner_id,
      run.status,
      run.snapshot,
      run.source_hash,
      run.result,
    ]);
    const args = { pool, owner: 'owner', request, materialHash: request.materialHash };
    const first = await saveCandidateReview(args);
    expect(first.revision).toBe(1);
    await expect(
      pool.query('UPDATE candidate_reviews SET note=$1 WHERE id=$2', ['tamper', first.id]),
    ).rejects.toThrow('append-only');
    await expect(pool.query('TRUNCATE candidate_reviews CASCADE')).rejects.toThrow('append-only');
    expect((await saveCandidateReview(args)).id).toBe(first.id);
    await expect(saveCandidateReview({ ...args, owner: 'other' })).rejects.toThrow('not_found');
    expect(
      await readCandidateReviews({ pool, owner: 'other', runId: run.id, candidateIndex: 0 }),
    ).toEqual([]);
    await expect(
      saveCandidateReview({ ...args, request: { ...request, note: 'changed' } }),
    ).rejects.toThrow('request_id_conflict');
    const racing = await Promise.allSettled(
      [1, 2].map(() =>
        saveCandidateReview({
          ...args,
          request: { ...request, requestId: randomUUID(), expectedRevision: 1 },
        }),
      ),
    );
    expect(racing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await readCandidateReviews({ pool, owner: 'owner', runId: run.id, candidateIndex: 0 })).map(
        (r) => r.revision,
      ),
    ).toEqual([2, 1]);
    await pool.query('UPDATE signal_generation_runs SET deleted_at=now() WHERE id=$1', [run.id]);
    expect(
      await readCandidateReviews({ pool, owner: 'owner', runId: run.id, candidateIndex: 0 }),
    ).toEqual([]);
  });
});
