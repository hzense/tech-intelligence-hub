import { canonicalLegacyArchiveJson as canonical } from './legacy-signal-archive.mjs';
import { buildUnifiedSignalPlan, previewUnifiedPublicSignals } from './unified-signal-plan.mjs';
import {
  readUnifiedSignalSources,
  assertUnifiedSourcePublicSet,
} from './unified-signal-preflight.mjs';

export const unifiedMasterReadQuery = `SELECT id,storage_schema,origin,latest_version
FROM public.signals ORDER BY id COLLATE "C"`;
export const unifiedVersionReadQuery = `SELECT signal_id,version,schema_version,origin,
publication_basis,lifecycle_status AS status,
to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
source_record,source_record_hash,content,content_hash
FROM public.signal_versions ORDER BY signal_id COLLATE "C",version`;
// Owner-only migration preview, NOT a publicly granted authorization view.
export const unifiedBackfillPublicPreviewQuery = `SELECT s.id,v.version,v.origin,
v.publication_basis,v.content FROM public.signals s JOIN public.signal_versions v
ON v.signal_id=s.id AND v.version=s.latest_version
WHERE s.storage_schema='4.0.0' AND v.schema_version='4.0.0' AND v.lifecycle_status='published'
ORDER BY s.id COLLATE "C"`;
export const unifiedMasterInsertQuery = `INSERT INTO public.signals
(id,storage_schema,origin,latest_version,status,captured_at,metadata)
VALUES($1,'4.0.0',$2,$3,NULL,NULL,NULL)`;
export const unifiedVersionInsertQuery = `INSERT INTO public.signal_versions
(signal_id,version,schema_version,origin,content,publication_basis,lifecycle_status,
recorded_at,source_record,source_record_hash,content_hash,revision_reason)
VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,'Unified Signal source backfill')`;
export const unifiedBackfillLockQuery = `LOCK TABLE public.legacy_signal_archive,
public.editorial_signal_revisions,public.signals,public.signal_versions IN EXCLUSIVE MODE`;

export class UnifiedSignalBackfillError extends Error {
  constructor(code, { phase = 'validation', mayHaveCommitted = false, cause } = {}) {
    super(code, { cause });
    this.name = 'UnifiedSignalBackfillError';
    this.code = code;
    this.phase = phase;
    this.mayHaveCommitted = mayHaveCommitted;
  }
}
const fail = (code) => {
  throw new UnifiedSignalBackfillError(code);
};
const same = (a, b) => canonical(a) === canonical(b);

function expectedFingerprint(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('unified_backfill_plan_required');
}

async function sourceSnapshot(client, expectedPlanHash) {
  const sources = await readUnifiedSignalSources(client);
  const plan = buildUnifiedSignalPlan(sources);
  if (plan.plan_hash !== expectedPlanHash) fail('unified_backfill_plan_changed');
  const visible = previewUnifiedPublicSignals(plan, sources);
  const publicIdFingerprint = await assertUnifiedSourcePublicSet(client, visible);
  return { plan, visible, publicIdFingerprint, publicCount: visible.length };
}

/** Compare actual JSON and metadata, not just stored hashes or counts. */
async function reconcile(client, { plan, visible }) {
  const masters = (await client.query(unifiedMasterReadQuery)).rows;
  const versions = (await client.query(unifiedVersionReadQuery)).rows;
  if (masters.length === 0 && versions.length === 0) return 'empty';
  const expectedMasters = plan.signals.map((row) => ({ ...row, storage_schema: '4.0.0' }));
  if (!same(masters, expectedMasters) || !same(versions, plan.signal_versions))
    fail('unified_backfill_target_conflict');
  // Compare actual latest-public rows, including full display content. No old
  // published version may reappear when the latest version is withdrawn/draft.
  const projected = (await client.query(unifiedBackfillPublicPreviewQuery)).rows;
  if (!same(projected, visible)) fail('unified_backfill_public_conflict');
  return 'complete';
}

function receipt(snapshot, inserted) {
  return {
    signalCount: snapshot.plan.signals.length,
    versionCount: snapshot.plan.signal_versions.length,
    publicCount: snapshot.publicCount,
    sourceFingerprint: snapshot.plan.source_fingerprint,
    planFingerprint: snapshot.plan.plan_hash,
    publicIdFingerprint: snapshot.publicIdFingerprint,
    inserted,
    cutoverReady: false,
  };
}

function stopped(error, phase, mayHaveCommitted) {
  return new UnifiedSignalBackfillError(
    mayHaveCommitted
      ? 'unified_backfill_commit_unknown'
      : error instanceof UnifiedSignalBackfillError
        ? error.code
        : 'unified_backfill_failed',
    { phase, mayHaveCommitted, cause: error },
  );
}

/**
 * Internal owner-only backfill kernel, NOT a production entry point or approval.
 * Caller must borrow a fresh idle client exclusively, validate target/TLS/schema,
 * obtain current protected approval/backup/ACL/main-CI gates and freeze publishers.
 * checkBeforeCommit must revalidate that same approval/freshness; it is mandatory.
 * No connections, credentials, grants, source edits, retries or public cutover.
 */
export async function applyUnifiedSignalBackfill(
  client,
  { expectedPlanHash, checkBeforeCommit } = {},
) {
  expectedFingerprint(expectedPlanHash);
  if (typeof checkBeforeCommit !== 'function') fail('unified_backfill_gate_required');
  let phase = 'begin';
  let mayHaveCommitted = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='90s'");
    phase = 'snapshot';
    // Lock sources AND targets before the first data snapshot. Concurrent source
    // revisions cannot slip between plan approval, inserts and COMMIT.
    await client.query(unifiedBackfillLockQuery);
    const snapshot = await sourceSnapshot(client, expectedPlanHash);
    const state = await reconcile(client, snapshot);
    if (state === 'complete') {
      // Read back an uncertain prior commit without replaying any INSERT.
      await client.query('ROLLBACK');
      return { ...receipt(snapshot, 0), alreadyPresent: true, committed: false };
    }
    phase = 'insert';
    for (const row of snapshot.plan.signals)
      await client.query(unifiedMasterInsertQuery, [row.id, row.origin, row.latest_version]);
    for (const row of snapshot.plan.signal_versions)
      await client.query(unifiedVersionInsertQuery, [
        row.signal_id,
        row.version,
        row.schema_version,
        row.origin,
        canonical(row.content),
        row.publication_basis,
        row.status,
        row.recorded_at,
        canonical(row.source_record),
        row.source_record_hash,
        row.content_hash,
      ]);
    phase = 'reconcile';
    // Force deferred head/history constraints before declaring a successful write.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    if ((await reconcile(client, snapshot)) !== 'complete') fail('unified_backfill_incomplete');
    phase = 'authorization';
    await checkBeforeCommit();
    phase = 'commit';
    mayHaveCommitted = true;
    await client.query('COMMIT');
    return {
      ...receipt(snapshot, snapshot.plan.signals.length),
      alreadyPresent: false,
      committed: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never reconnect/retry. A lost COMMIT reply needs a separate read-only verify.
    throw stopped(error, phase, mayHaveCommitted);
  }
}

/** Independent fresh connection required after apply; no lock or write is taken. */
export async function verifyUnifiedSignalBackfill(client, { expectedPlanHash } = {}) {
  expectedFingerprint(expectedPlanHash);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    const snapshot = await sourceSnapshot(client, expectedPlanHash);
    if ((await reconcile(client, snapshot)) !== 'complete') fail('unified_backfill_incomplete');
    await client.query('COMMIT');
    return { ...receipt(snapshot, 0), verificationCompleted: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw stopped(error, 'verify', false);
  }
}
