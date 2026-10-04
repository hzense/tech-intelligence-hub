import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  applyLegacySignalArchive,
  canonicalLegacyArchiveJson,
  reconcileLegacySignalArchive,
} from '../src/legacy-signal-archive.mjs';
import {
  legacyArchiveChecks,
  legacyArchiveFunctionHashes,
  legacyPublicSignalViewHashes,
} from '../src/legacy-signal-archive-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { archiveFixture } from './legacy-signal-archive.test.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;

suite('historical Signal archive PostgreSQL persistence', () => {
  const database = `hzense_legacy_archive_${process.pid}_${Date.now()}`;
  let admin,
    client,
    plan,
    created = false;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const target = new URL(adminUrl);
    target.pathname = `/${database}`;
    client = new pg.Client({ connectionString: target.toString() });
    await client.connect();
    await client.query(
      await readFile(
        new URL('../../../db/migrations/0028_legacy_signal_archive.sql', import.meta.url),
        'utf8',
      ),
    );
    ({ plan } = await archiveFixture());
  });
  afterAll(async () => {
    await client?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin?.end();
  });

  it('matches independently reviewed PostgreSQL checks, view and immutable function', async () => {
    const checks = (
      await client.query(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.legacy_signal_archive'::regclass AND contype='c'",
      )
    ).rows.map((row) => canonicalPublicationControlCheck(row.definition));
    expect(checks).toHaveLength(legacyArchiveChecks.legacy_signal_archive.length);
    for (const forms of legacyArchiveChecks.legacy_signal_archive)
      expect(checks.some((check) => forms.includes(check))).toBe(true);
    const view = (
      await client.query(
        "SELECT pg_get_viewdef('public.legacy_public_signals'::regclass,true) AS definition",
      )
    ).rows[0].definition;
    expect(
      legacyPublicSignalViewHashes.has(createHash('sha256').update(view.trim()).digest('hex')),
    ).toBe(true);
    const guard = (
      await client.query(
        "SELECT prosrc FROM pg_proc WHERE proname='hzense_guard_legacy_signal_archive'",
      )
    ).rows[0].prosrc;
    expect(createHash('sha256').update(guard.trim()).digest('hex')).toBe(
      legacyArchiveFunctionHashes.hzense_guard_legacy_signal_archive,
    );
    const acl = (
      await client.query(
        "SELECT count(*)::int AS count FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relname IN ('legacy_signal_archive','legacy_public_signals') AND a.grantee<>c.relowner",
      )
    ).rows[0].count;
    expect(acl).toBe(0);
  });

  it('imports atomically with exact JSONB readback and retains stable public IDs', async () => {
    await client.query('BEGIN');
    const imported = await applyLegacySignalArchive(client, plan);
    expect(imported.inserted).toBe(110);
    await client.query('ROLLBACK');
    expect((await reconcileLegacySignalArchive(client, plan)).existing).toBe(0);
    await client.query('BEGIN');
    expect((await applyLegacySignalArchive(client, plan)).inserted).toBe(110);
    await client.query('COMMIT');
    const publicRows = (
      await client.query(
        'SELECT signal_id,content,content_hash FROM public.legacy_public_signals ORDER BY signal_id',
      )
    ).rows;
    expect(publicRows.map((row) => row.signal_id)).toEqual(plan.rows.map((row) => row.signal_id));
    for (const row of publicRows) {
      const original = plan.rows.find((item) => item.signal_id === row.signal_id);
      expect(row.content).toEqual(original.projection);
      expect(
        createHash('sha256').update(canonicalLegacyArchiveJson(row.content)).digest('hex'),
      ).toBe(row.content_hash);
    }
    await client.query('BEGIN');
    expect((await applyLegacySignalArchive(client, plan)).inserted).toBe(0);
    await client.query('COMMIT');
  });

  it('rejects accidental autocommit and all destructive row operations', async () => {
    await expect(applyLegacySignalArchive(client, plan)).rejects.toMatchObject({ code: '25P01' });
    for (const sql of [
      'UPDATE public.legacy_signal_archive SET signal=signal || \'{"title":"changed"}\'::jsonb',
      'DELETE FROM public.legacy_signal_archive',
      'TRUNCATE public.legacy_signal_archive',
    ])
      await expect(client.query(sql)).rejects.toMatchObject({ code: '55000' });
    expect((await reconcileLegacySignalArchive(client, plan)).existing).toBe(110);
  });

  it('does not expose internal or reserved editorial records and detects unexpected rows', async () => {
    await client.query('BEGIN');
    for (const [id, status] of [
      ['signal-internal-test', 'inbox'],
      ['editorial-reserved-test', 'accepted'],
    ]) {
      await client.query(
        'INSERT INTO public.legacy_signal_archive(signal_id,signal,"references",projection,content_hash,record_hash) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6)',
        [
          id,
          JSON.stringify({ ...plan.rows[0].signal, id, status }),
          JSON.stringify(plan.rows[0].references),
          JSON.stringify({ ...plan.rows[0].projection, id, status }),
          plan.rows[0].content_hash,
          plan.rows[0].record_hash,
        ],
      );
    }
    expect(
      (await client.query('SELECT count(*)::int AS count FROM public.legacy_public_signals'))
        .rows[0].count,
    ).toBe(110);
    await expect(reconcileLegacySignalArchive(client, plan)).rejects.toThrow(
      'legacy_archive_existing_content_conflict',
    );
    await client.query('ROLLBACK');
  });
});
