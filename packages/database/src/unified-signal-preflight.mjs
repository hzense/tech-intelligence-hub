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
    const archive = (await client.query(legacySignalArchiveReadQuery)).rows;
    const payload = { schema_version: '1.0.0', rows: archive, count: archive.length };
    const archivePlan = assertLegacySignalArchivePlan({
      ...payload,
      plan_hash: createHash('sha256').update(canonicalLegacyArchiveJson(payload)).digest('hex'),
    });
    const editorialRevisions = (await client.query(unifiedEditorialHistoryQuery)).rows;
    const inventory = (await client.query(unifiedCoreInventoryQuery)).rows[0];
    if (
      !inventory ||
      !/^\d+$/.test(inventory.signal_count) ||
      !/^\d+$/.test(inventory.version_count)
    ) {
      throw new Error('unified_inventory_unavailable');
    }
    const sources = { archivePlan, editorialRevisions };
    const plan = buildUnifiedSignalPlan(sources);
    const visible = previewUnifiedPublicSignals(plan, sources);
    const blockers = [
      'physical_schema_and_writer_not_implemented',
      'protected_apply_verify_not_implemented',
      'public_reader_cutover_not_implemented',
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
