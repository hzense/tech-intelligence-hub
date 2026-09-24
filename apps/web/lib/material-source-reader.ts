import { URL } from 'node:url';
import type { PoolClient } from 'pg';
import { buildGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';
import { importOwner, importUuid } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';

function fail(): never {
  throw Object.assign(new Error('source_unavailable'), { code: 'source_unavailable' });
}
/** One read-only snapshot: owner, deletion, cancellation, fence and content are read together. */
export async function readMaterialSupplement(
  pool: { connect(): Promise<Pick<PoolClient, 'query' | 'release'>> },
  owner: string,
  batchId: string,
  itemId: string,
) {
  importOwner(owner);
  importUuid(batchId);
  importUuid(itemId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL statement_timeout='15s'");
    const row = (
      await client.query(
        `SELECT b.id AS batch_id,i.id AS item_id,i.fence,i.kind,i.declaration->>'url' AS url,o.content
      FROM public.import_batches b JOIN public.import_items i ON i.batch_id=b.id
      JOIN public.import_outputs o ON o.item_id=i.id AND o.fence=i.fence
      WHERE b.owner_id=$1 AND b.id=$2 AND i.id=$3 AND NOT b.cancelled AND b.deleted_at IS NULL
        AND i.status='completed' AND i.kind='url'`,
        [owner, batchId, itemId],
      )
    ).rows[0];
    if (
      !row ||
      row.kind !== 'url' ||
      typeof row.url !== 'string' ||
      !Number.isSafeInteger(row.fence) ||
      row.fence < 1
    )
      fail();
    // A parsed URL declaration is still private evidence, never a verified public source.
    const url = (() => {
      try {
        return new URL(row.url);
      } catch {
        return fail();
      }
    })();
    if (url.protocol !== 'https:' || url.username || url.password || row.url.includes('#')) fail();
    const checked = validateImportManifest(
      { urlLines: row.url },
      { capabilities: { urlFetch: true, parsers: ['html'] } },
    );
    const sourceUrl = checked.urls[0]?.canonicalUrl;
    if (!checked.valid || checked.urls.length !== 1 || !sourceUrl) fail();
    const source = buildGenerationSource(row.content);
    await client.query('COMMIT');
    return {
      batchId,
      itemId,
      fence: row.fence,
      source,
      contentHash: signalGenerationSourceHash(source),
      sourceUrl,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
