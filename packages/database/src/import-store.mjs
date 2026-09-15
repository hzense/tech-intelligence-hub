import { randomUUID } from 'node:crypto';
import {
  ImportTaskError,
  importFail,
  importUuid,
  importOwner,
  parseImportCreate,
  parseImportOutput,
  importBatchStatus,
} from '../../ingestion/src/import-task-contract.mjs';

async function transaction(pool, operation, readOnly = false) {
  let client,
    committing = false,
    discard;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result = await operation(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    discard = error;
    await client?.query('ROLLBACK').catch(() => undefined);
    if (committing) throw new ImportTaskError('commit_unknown');
    throw error instanceof ImportTaskError ? error : new ImportTaskError('database_unavailable');
  } finally {
    client?.release(discard);
  }
}
async function audit(client, batch, item, event) {
  await client.query(
    'INSERT INTO public.import_audit(id,batch_id,item_id,event) VALUES($1,$2,$3,$4)',
    [randomUUID(), batch, item, event],
  );
}
async function batch(client, id, owner, lock = false) {
  const row = (
    await client.query(
      `SELECT * FROM public.import_batches WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [importUuid(id), importOwner(owner)],
    )
  ).rows[0];
  if (!row) importFail('not_found');
  return row;
}
async function item(client, batchId, id) {
  const row = (
    await client.query('SELECT * FROM public.import_items WHERE id=$1 AND batch_id=$2 FOR UPDATE', [
      importUuid(id),
      batchId,
    ])
  ).rows[0];
  if (!row) importFail('not_found');
  return row;
}
async function detail(client, row) {
  const items = (
    await client.query(
      `SELECT i.*, d.sha256,d.byte_size,d.format, a.error_code,a.lease_until
    FROM public.import_items i LEFT JOIN public.import_documents d ON d.item_id=i.id
    LEFT JOIN public.import_attempts a ON a.item_id=i.id AND a.fence=i.fence
    WHERE i.batch_id=$1 ORDER BY i.position`,
      [row.id],
    )
  ).rows;
  return { ...row, status: importBatchStatus(row, items), items };
}
export async function createImportBatch({ pool, owner, request, capabilities, configuration }) {
  importOwner(owner);
  if (
    !configuration ||
    typeof configuration !== 'object' ||
    Array.isArray(configuration) ||
    Object.keys(configuration).some(
      (key) => !['parserVersion', 'batchLimitMicrousd'].includes(key),
    ) ||
    typeof configuration.parserVersion !== 'string' ||
    configuration.parserVersion.match(/^[a-zA-Z0-9._/-]{1,100}$/)?.[0] !==
      configuration.parserVersion
  )
    importFail('invalid_configuration');
  money(configuration.batchLimitMicrousd);
  const parsed = parseImportCreate(request, capabilities);
  const snapshot = {
    parserVersion: configuration.parserVersion,
    batchLimitMicrousd: configuration.batchLimitMicrousd,
    capabilities: {
      parsers: [...(capabilities?.parsers ?? [])],
      ocr: capabilities?.ocr === true,
      urlFetch: capabilities?.urlFetch === true,
    },
  };
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `import:create:${owner}`,
    ]);
    const old = (await client.query('SELECT * FROM public.import_batches WHERE id=$1', [parsed.id]))
      .rows[0];
    if (old) {
      if (old.owner_id !== owner || old.fingerprint !== parsed.fingerprint)
        importFail('request_id_conflict');
      return detail(client, old);
    }
    const count = (
      await client.query(
        "SELECT count(*)::integer AS n FROM public.import_batches WHERE owner_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [owner],
      )
    ).rows[0].n;
    if (count >= 100) importFail('daily_batch_limit');
    const row = (
      await client.query(
        'INSERT INTO public.import_batches(id,owner_id,fingerprint,intent,configuration) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *',
        [parsed.id, owner, parsed.fingerprint, parsed.intent, JSON.stringify(snapshot)],
      )
    ).rows[0];
    for (const [position, value] of parsed.items.entries()) {
      await client.query(
        'INSERT INTO public.import_items(id,batch_id,position,kind,declaration,status) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
        [
          randomUUID(),
          parsed.id,
          position,
          value.kind,
          JSON.stringify(value.declaration),
          value.kind === 'file' ? 'awaiting_upload' : 'queued',
        ],
      );
    }
    await audit(client, parsed.id, null, 'created');
    return detail(client, row);
  });
}
export async function getImportBatch({ pool, owner, id }) {
  return transaction(pool, async (client) => detail(client, await batch(client, id, owner)), true);
}
export async function listImportBatches({ pool, owner, before }) {
  importOwner(owner);
  return transaction(
    pool,
    async (client) => {
      const cursor = before === undefined ? null : await batch(client, before, owner);
      const rows = (
        await client.query(
          'SELECT * FROM public.import_batches WHERE owner_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT c.created_at,c.id FROM public.import_batches c WHERE c.id=$2::uuid AND c.owner_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 50',
          [owner, cursor?.id ?? null],
        )
      ).rows;
      const result = [];
      for (const row of rows) result.push(await detail(client, row));
      return result;
    },
    true,
  );
}
/** Trusted storage adapter only: never expose these facts as a browser POST payload. */
export async function confirmImportDocument({ pool, owner, batchId, itemId, document, fence }) {
  if (
    !document ||
    typeof document.object_key !== 'string' ||
    document.object_key !== `imports/${batchId}/${itemId}` ||
    typeof document.object_version !== 'string' ||
    !document.object_version ||
    document.object_version.length > 200 ||
    typeof document.sha256 !== 'string' ||
    document.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(document.sha256) ||
    !Number.isInteger(document.byte_size) ||
    document.byte_size < 1 ||
    document.byte_size > 26214400 ||
    !['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx', 'png', 'jpeg'].includes(
      document.format,
    )
  )
    importFail('invalid_document');
  return transaction(pool, async (client) => {
    const b = await batch(client, batchId, owner, true);
    const i = await item(client, b.id, itemId);
    if (b.cancelled) importFail('cancelled');
    if (i.kind === 'url') {
      if (i.status !== 'running' || i.fence !== fence) importFail('stale_attempt');
      await liveAttempt(client, i);
    }
    const old = (
      await client.query('SELECT * FROM public.import_documents WHERE item_id=$1', [i.id])
    ).rows[0];
    if (old) {
      if (
        ['object_key', 'object_version', 'sha256', 'byte_size', 'format'].some(
          (key) => old[key] !== document[key],
        )
      )
        importFail('document_conflict');
      return { item_id: i.id, received: true };
    }
    if (
      i.kind === 'file' &&
      (i.status !== 'awaiting_upload' ||
        i.declaration.size !== document.byte_size ||
        i.declaration.format !== document.format)
    )
      importFail('document_conflict');
    const bytes = (
      await client.query(
        'SELECT COALESCE(sum(d.byte_size),0)::text AS n FROM public.import_documents d JOIN public.import_items i ON i.id=d.item_id WHERE i.batch_id=$1',
        [b.id],
      )
    ).rows[0].n;
    if (BigInt(bytes) + BigInt(document.byte_size) > 209715200n) importFail('limit_exceeded');
    await client.query(
      'INSERT INTO public.import_documents(item_id,object_key,object_version,sha256,byte_size,format,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        i.id,
        document.object_key,
        document.object_version,
        document.sha256,
        document.byte_size,
        document.format,
        JSON.stringify({ verified_by: 'storage-adapter-v1' }),
      ],
    );
    if (i.kind === 'file')
      await client.query("UPDATE public.import_items SET status='queued' WHERE id=$1", [i.id]);
    await audit(client, b.id, i.id, 'received');
    return { item_id: i.id, received: true };
  });
}
async function liveAttempt(client, i) {
  const attempt = (
    await client.query(
      'SELECT *,lease_until>now() AS live FROM public.import_attempts WHERE item_id=$1 AND fence=$2 FOR UPDATE',
      [i.id, i.fence],
    )
  ).rows[0];
  if (!attempt || attempt.status !== 'running' || !attempt.live) importFail('stale_attempt');
  return attempt;
}
function money(value) {
  if (!Number.isSafeInteger(value) || value < 0) importFail('invalid_budget');
  return value;
}
/** One short transaction per claim. No network/parse work while holding locks. */
export async function claimImportItem({
  pool,
  owner,
  batchId,
  itemId,
  parserVersion,
  reserveMicrousd = 0,
  dailyLimitMicrousd = 0,
}) {
  if (
    typeof parserVersion !== 'string' ||
    parserVersion.match(/^[a-zA-Z0-9._/-]{1,100}$/)?.[0] !== parserVersion
  )
    importFail('invalid_parser');
  [reserveMicrousd, dailyLimitMicrousd].forEach(money);
  return transaction(pool, async (client) => {
    const b = await batch(client, batchId, owner, true),
      i = await item(client, b.id, itemId);
    if (b.cancelled) importFail('cancelled');
    if (i.status !== 'queued' || i.fence >= 5) importFail('not_claimable');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('import:worker-capacity',0))",
    );
    const active = (
      await client.query(
        "SELECT count(*)::integer AS n FROM public.import_attempts WHERE status IN ('running','cancelled','unknown') AND lease_until>now()",
      )
    ).rows[0].n;
    if (active >= 1) importFail('worker_busy');
    if (b.configuration.parserVersion !== parserVersion) importFail('configuration_conflict');
    const batchLimitMicrousd = money(b.configuration.batchLimitMicrousd);
    const total = (
      await client.query(
        'SELECT COALESCE(sum(greatest(a.reserved_microusd,a.charged_microusd)),0)::text AS n FROM public.import_attempts a JOIN public.import_items i ON i.id=a.item_id WHERE i.batch_id=$1',
        [b.id],
      )
    ).rows[0].n;
    if (BigInt(total) + BigInt(reserveMicrousd) > BigInt(batchLimitMicrousd))
      importFail('budget_exceeded');
    const day = (await client.query("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day")).rows[0]
      .day;
    await client.query(
      'INSERT INTO public.import_daily_usage(day) VALUES($1) ON CONFLICT DO NOTHING',
      [day],
    );
    const reserved = await client.query(
      'UPDATE public.import_daily_usage SET reserved_microusd=reserved_microusd+$2 WHERE day=$1 AND reserved_microusd+charged_microusd+$2<=$3 RETURNING day',
      [day, reserveMicrousd, dailyLimitMicrousd],
    );
    if (!reserved.rows.length) importFail('budget_exceeded');
    const next = i.fence + 1;
    await client.query("UPDATE public.import_items SET status='running',fence=$2 WHERE id=$1", [
      i.id,
      next,
    ]);
    const attempt = (
      await client.query(
        // Seven minutes cover the 240s request lifetime plus a late-created 120s Sandbox.
        "INSERT INTO public.import_attempts(item_id,fence,parser_version,status,lease_until,budget_day,reserved_microusd) VALUES($1,$2,$3,'running',now()+interval '7 minutes',$4,$5) RETURNING *",
        [i.id, next, parserVersion, day, reserveMicrousd],
      )
    ).rows[0];
    const document =
      (await client.query('SELECT * FROM public.import_documents WHERE item_id=$1', [i.id]))
        .rows[0] ?? null;
    if (i.kind === 'file' && !document) importFail('document_missing');
    await audit(client, b.id, i.id, 'claimed');
    return { item: { ...i, fence: next }, attempt, document };
  });
}
export async function finishImportAttempt({
  pool,
  owner,
  batchId,
  itemId,
  fence,
  outcome,
  output,
  chargedMicrousd = 0,
  errorCode = null,
}) {
  money(chargedMicrousd);
  if (
    !['completed', 'failed', 'unknown'].includes(outcome) ||
    !Number.isSafeInteger(fence) ||
    fence < 1 ||
    (errorCode !== null &&
      ![
        'parse_failed',
        'fetch_failed',
        'unsupported_content',
        'limit_exceeded',
        'worker_unavailable',
        'outcome_unknown',
        'ocr_required',
        'source_unavailable',
      ].includes(errorCode))
  )
    importFail();
  const content = outcome === 'completed' ? parseImportOutput(output) : null;
  return transaction(pool, async (client) => {
    const b = await batch(client, batchId, owner, true),
      i = await item(client, b.id, itemId);
    if (b.cancelled || i.status !== 'running' || i.fence !== fence) importFail('stale_attempt');
    const a = await liveAttempt(client, i);
    // Unknown outcomes keep at least the reserved charge and require reconciliation.
    const charge =
      BigInt(chargedMicrousd) > BigInt(a.reserved_microusd)
        ? BigInt(chargedMicrousd)
        : BigInt(a.reserved_microusd);
    await client.query(
      'UPDATE public.import_daily_usage SET reserved_microusd=reserved_microusd-$2,charged_microusd=charged_microusd+$3 WHERE day=$1',
      [a.budget_day, a.reserved_microusd, charge.toString()],
    );
    if (content)
      await client.query(
        'INSERT INTO public.import_outputs(item_id,fence,content) VALUES($1,$2,$3::jsonb)',
        [i.id, fence, JSON.stringify(content)],
      );
    await client.query(
      'UPDATE public.import_attempts SET status=$3,error_code=$4,charged_microusd=$5,finished_at=now() WHERE item_id=$1 AND fence=$2',
      [i.id, fence, outcome, errorCode, charge.toString()],
    );
    await client.query('UPDATE public.import_items SET status=$2 WHERE id=$1', [i.id, outcome]);
    await audit(client, b.id, i.id, outcome);
    return { item_id: i.id, status: outcome };
  });
}

/** Service-only queue metadata; never exposed through an unauthenticated API. */
export async function getImportQueue({ pool, parserVersion, reserveMicrousd = 0 }) {
  if (typeof parserVersion !== 'string' || !/^[a-zA-Z0-9._/-]{1,100}$/.test(parserVersion))
    importFail('invalid_parser');
  money(reserveMicrousd);
  return transaction(
    pool,
    async (client) =>
      (
        await client.query(
          `SELECT b.owner_id AS owner,b.id AS "batchId",i.id AS "itemId",i.status
    FROM public.import_items i JOIN public.import_batches b ON b.id=i.batch_id
    WHERE NOT b.cancelled AND ((i.status='queued' AND b.configuration->>'parserVersion'=$1 AND i.fence<5
      AND (SELECT COALESCE(sum(greatest(a.reserved_microusd,a.charged_microusd)),0) FROM public.import_attempts a JOIN public.import_items x ON x.id=a.item_id WHERE x.batch_id=b.id)+$2::bigint<=(b.configuration->>'batchLimitMicrousd')::bigint)
      OR (i.status='running' AND EXISTS (
      SELECT 1 FROM public.import_attempts a WHERE a.item_id=i.id AND a.fence=i.fence AND a.lease_until<=now())))
    ORDER BY CASE WHEN i.status='running' THEN 0 ELSE 1 END,i.created_at,i.id LIMIT 10`,
          [parserVersion, reserveMicrousd],
        )
      ).rows,
    true,
  );
}
export async function getImportOutput({ pool, owner, batchId, itemId }) {
  return transaction(
    pool,
    async (client) => {
      await batch(client, batchId, owner);
      const row = (
        await client.query(
          `SELECT o.content FROM public.import_outputs o JOIN public.import_items i ON i.id=o.item_id
      WHERE i.batch_id=$1 AND i.id=$2 AND i.status='completed' AND i.fence=o.fence`,
          [batchId, importUuid(itemId)],
        )
      ).rows[0];
      if (!row) importFail('not_found');
      return row.content;
    },
    true,
  );
}
export async function cancelImportBatch({ pool, owner, id }) {
  return transaction(pool, async (client) => {
    const b = await batch(client, id, owner, true);
    if (!b.cancelled) {
      await client.query('UPDATE public.import_batches SET cancelled=true WHERE id=$1', [id]);
      // A running external operation may still incur cost: retain reservations.
      await client.query(
        "UPDATE public.import_attempts a SET status='cancelled',finished_at=now() FROM public.import_items i WHERE i.batch_id=$1 AND a.item_id=i.id AND a.fence=i.fence AND a.status='running'",
        [id],
      );
      await client.query(
        "UPDATE public.import_items SET status='cancelled',fence=fence+1 WHERE batch_id=$1 AND status IN ('awaiting_upload','queued','running')",
        [id],
      );
      await audit(client, id, null, 'cancelled');
    }
    return detail(client, { ...b, cancelled: true });
  });
}
export async function retryImportItem({ pool, owner, batchId, itemId }) {
  return transaction(pool, async (client) => {
    const b = await batch(client, batchId, owner, true),
      i = await item(client, b.id, itemId);
    if (b.cancelled || i.status !== 'failed' || i.fence >= 5) importFail('retry_not_allowed');
    const previous = (
      await client.query(
        'SELECT error_code FROM public.import_attempts WHERE item_id=$1 AND fence=$2',
        [i.id, i.fence],
      )
    ).rows[0];
    if (previous?.error_code === 'source_unavailable') importFail('retry_not_allowed');
    await client.query("UPDATE public.import_items SET status='queued' WHERE id=$1", [i.id]);
    await audit(client, b.id, i.id, 'retried');
    return { item_id: i.id, status: 'queued' };
  });
}

/** Expiration is explicit and fenced. Paid/unknown work is never blindly retried. */
export async function expireImportAttempt({ pool, owner, batchId, itemId }) {
  return transaction(pool, async (client) => {
    const b = await batch(client, batchId, owner, true),
      i = await item(client, b.id, itemId);
    if (b.cancelled || i.status !== 'running') return { changed: false };
    const a = (
      await client.query(
        'SELECT *,lease_until<=now() AS expired FROM public.import_attempts WHERE item_id=$1 AND fence=$2 FOR UPDATE',
        [i.id, i.fence],
      )
    ).rows[0];
    if (!a?.expired) return { changed: false };
    const outcome = BigInt(a.reserved_microusd) === 0n ? 'failed' : 'unknown';
    await client.query(
      'UPDATE public.import_attempts SET status=$3,error_code=$4,finished_at=now() WHERE item_id=$1 AND fence=$2',
      [i.id, i.fence, outcome, 'outcome_unknown'],
    );
    await client.query('UPDATE public.import_items SET status=$2 WHERE id=$1', [i.id, outcome]);
    await audit(client, b.id, i.id, outcome);
    return { changed: true, status: outcome };
  });
}
