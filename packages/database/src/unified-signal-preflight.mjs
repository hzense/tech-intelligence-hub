import { createHash } from 'node:crypto';
import {
  assertLegacySignalArchivePlan,
  canonicalLegacyArchiveJson,
  legacySignalArchiveReadQuery,
} from './legacy-signal-archive.mjs';
import { buildUnifiedSignalPlan, previewUnifiedPublicSignals } from './unified-signal-plan.mjs';

export const unifiedEditorialHistoryQuery = `SELECT request_id,run_id,owner_id,candidate_index,
  revision,material_hash,action,content,request_hash,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
FROM public.editorial_signal_revisions ORDER BY run_id,candidate_index,revision`;
export const unifiedCoreInventoryQuery = `SELECT
  (SELECT count(*)::text FROM public.signals) AS signal_count,
  (SELECT count(*)::text FROM public.signal_versions) AS version_count`;
export const unifiedSourcePublicIdsQuery = `SELECT signal_id FROM public.legacy_public_signals
UNION ALL SELECT signal_id FROM public.editorial_public_signals`;

/** Borrow the caller's snapshot; never start/commit a transaction here. */
export async function readUnifiedSignalSources(client) {
  const archive = (await client.query(legacySignalArchiveReadQuery)).rows;
  const payload = { schema_version: '1.0.0', rows: archive, count: archive.length };
  const archivePlan = assertLegacySignalArchivePlan({
    ...payload,
    plan_hash: createHash('sha256').update(canonicalLegacyArchiveJson(payload)).digest('hex'),
  });
  const editorialRevisions = (await client.query(unifiedEditorialHistoryQuery)).rows;
  return { archivePlan, editorialRevisions };
}

export async function assertUnifiedSourcePublicSet(client, visible) {
  const publicIds = (await client.query(unifiedSourcePublicIdsQuery)).rows.map(
    (row) => row.signal_id,
  );
  const projectedIds = visible.map((row) => row.id).sort();
  if (
    publicIds.some((id) => typeof id !== 'string') ||
    new Set(publicIds).size !== publicIds.length ||
    canonicalLegacyArchiveJson(publicIds.sort()) !== canonicalLegacyArchiveJson(projectedIds)
  )
    throw new Error('unified_source_public_set_mismatch');
  return createHash('sha256').update(canonicalLegacyArchiveJson(projectedIds)).digest('hex');
}

/**
 * Maintenance-only read adapter. Requires an exclusively borrowed client with
 * no active transaction. Opens no connection, accepts no credentials, emits no
 * logs, performs no DDL/DML and never authorizes a subsequent write.
 * Full private plans must not be published or returned through a public API.
 */
export async function inspectUnifiedSignalMigration(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='30s'");
    const sources = await readUnifiedSignalSources(client);
    const inventory = (await client.query(unifiedCoreInventoryQuery)).rows[0];
    if (
      !inventory ||
      !/^\d+$/.test(inventory.signal_count) ||
      !/^\d+$/.test(inventory.version_count)
    ) {
      throw new Error('unified_inventory_unavailable');
    }
    const plan = buildUnifiedSignalPlan(sources);
    const visible = previewUnifiedPublicSignals(plan, sources);
    const publicIdFingerprint = await assertUnifiedSourcePublicSet(client, visible);
    const latest = new Map(plan.signal_versions.map((row) => [row.signal_id, row.status]));
    const lifecycle = { draft: 0, published: 0, withdrawn: 0 };
    for (const status of latest.values()) lifecycle[status] += 1;
    const blockers = [
      'protected_apply_verify_approval_required',
      'application_cutover_and_public_comparison_required',
    ];
    if (BigInt(inventory.signal_count) !== 0n || BigInt(inventory.version_count) !== 0n) {
      blockers.push('existing_core_signals_require_reconciliation');
    }
    await client.query('COMMIT');
    return {
      summary: {
        status: 'preview_only',
        cutover_ready: false,
        source_counts: plan.source_counts,
        signals: plan.signals.length,
        versions: plan.signal_versions.length,
        public_preview: visible.length,
        public_id_fingerprint: publicIdFingerprint,
        lifecycle,
        existing_core: inventory,
        source_fingerprint: plan.source_fingerprint,
        plan_hash: plan.plan_hash,
        blockers,
      },
      plan,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
