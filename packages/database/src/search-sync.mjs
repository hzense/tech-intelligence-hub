import { createHash } from 'node:crypto';
import pg from 'pg';
import { migrationLockKeys } from './migrate.mjs';

const { Client } = pg;
const searchTypes = new Set(['daily', 'weekly', 'insight', 'topic', 'signal', 'resource']);

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`);
  }
  return value;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  const normalized = [...new Set(value)].sort(compareOrdinal);
  if (
    normalized.length !== value.length ||
    normalized.some((entry, index) => entry !== value[index])
  ) {
    throw new Error(`${label} must be unique and ordinally sorted`);
  }
  return normalized;
}

function normalizeDocument(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} must be an object`);
  }
  const sourceId = requireText(row.sourceId, `${label}.sourceId`);
  const sourceType = requireText(row.sourceType, `${label}.sourceType`);
  if (!searchTypes.has(sourceType)) throw new Error(`${label}.sourceType is invalid`);
  const id = requireText(row.id, `${label}.id`);
  if (id !== `searchdoc-${sourceType}-${sourceId}`) {
    throw new Error(`${label}.id does not match its canonical source identity`);
  }
  if (!Number.isSafeInteger(row.importance) || row.importance < 1 || row.importance > 5) {
    throw new Error(`${label}.importance must be an integer from 1 to 5`);
  }
  if (
    row.documentDate !== null &&
    (typeof row.documentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.documentDate))
  ) {
    throw new Error(`${label}.documentDate must be a date-only value or null`);
  }
  const href = requireText(row.href, `${label}.href`);
  if (!href.startsWith('/')) throw new Error(`${label}.href must be root-relative`);
  return {
    id,
    sourceId,
    sourceType,
    title: requireText(row.title, `${label}.title`),
    summary: requireText(row.summary, `${label}.summary`),
    href,
    keywords: requireText(row.keywords, `${label}.keywords`, true),
    body: requireText(row.body, `${label}.body`, true),
    importance: row.importance,
    documentDate: row.documentDate,
    topics: normalizeStringArray(row.topics, `${label}.topics`),
    entities: normalizeStringArray(row.entities, `${label}.entities`),
    normalizedTitle: requireText(row.normalizedTitle, `${label}.normalizedTitle`),
    normalizedSummary: requireText(row.normalizedSummary, `${label}.normalizedSummary`),
    normalizedKeywords: requireText(row.normalizedKeywords, `${label}.normalizedKeywords`, true),
    normalizedBody: requireText(row.normalizedBody, `${label}.normalizedBody`, true),
  };
}

export function normalizeSearchDocuments(rows, label = 'searchDocuments') {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const documents = rows.map((row, index) => normalizeDocument(row, `${label}[${index}]`));
  documents.sort((left, right) => compareOrdinal(left.id, right.id));
  const ids = new Set();
  const identities = new Set();
  for (const document of documents) {
    if (ids.has(document.id)) throw new Error(`${label} contains duplicate id ${document.id}`);
    const identity = `${document.sourceType}:${document.sourceId}`;
    if (identities.has(identity))
      throw new Error(`${label} contains duplicate identity ${identity}`);
    ids.add(document.id);
    identities.add(identity);
  }
  return documents;
}

function canonicalRows(rows) {
  return rows.map((row) => [
    row.id,
    row.sourceId,
    row.sourceType,
    row.title,
    row.summary,
    row.href,
    row.keywords,
    row.body,
    row.importance,
    row.documentDate,
    row.topics,
    row.entities,
    row.normalizedTitle,
    row.normalizedSummary,
    row.normalizedKeywords,
    row.normalizedBody,
  ]);
}

export function searchDocumentsFingerprint(rows) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalRows(normalizeSearchDocuments(rows))))
    .digest('hex');
}

function documentsEqual(left, right) {
  return JSON.stringify(canonicalRows([left])) === JSON.stringify(canonicalRows([right]));
}

export function planSearchDocumentSync(desiredRows, existingRows) {
  const desired = normalizeSearchDocuments(desiredRows, 'desiredSearchDocuments');
  const existing = Array.isArray(existingRows)
    ? existingRows.map((row, index) => normalizeDocument(row, `existingSearchDocuments[${index}]`))
    : (() => {
        throw new Error('existingSearchDocuments must be an array');
      })();
  existing.sort((left, right) => compareOrdinal(left.id, right.id));
  const desiredById = new Map(desired.map((row) => [row.id, row]));
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const inserts = desired.filter((row) => !existingById.has(row.id));
  const updates = desired.filter((row) => {
    const current = existingById.get(row.id);
    return current !== undefined && !documentsEqual(row, current);
  });
  const unchanged = desired.filter((row) => {
    const current = existingById.get(row.id);
    return current !== undefined && documentsEqual(row, current);
  });
  const deletes = existing.filter((row) => !desiredById.has(row.id));
  const fingerprint = searchDocumentsFingerprint(desired);
  const databaseStateFingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalRows(existing)))
    .digest('hex');
  const planFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        projection: fingerprint,
        databaseState: databaseStateFingerprint,
        inserts: inserts.map((row) => row.id),
        updates: updates.map((row) => row.id),
        deletes: deletes.map((row) => row.id),
      }),
    )
    .digest('hex');
  return {
    fingerprint,
    databaseStateFingerprint,
    planFingerprint,
    desiredCount: desired.length,
    inserts,
    updates,
    deletes,
    unchanged,
    changedIds: [...inserts, ...updates, ...deletes].map((row) => row.id).sort(compareOrdinal),
  };
}

async function readSearchDocuments(client) {
  return (
    await client.query(`SELECT id,
       source_id AS "sourceId",
       source_type AS "sourceType",
       title,
       summary,
       href,
       keywords,
       body,
       importance,
       document_date::text AS "documentDate",
       topics,
       entities,
       normalized_title AS "normalizedTitle",
       normalized_summary AS "normalizedSummary",
       normalized_keywords AS "normalizedKeywords",
       normalized_body AS "normalizedBody"
FROM ONLY public.search_documents
ORDER BY id`)
  ).rows;
}

async function writeSearchDocuments(client, rows) {
  if (rows.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO public.search_documents (
       id, source_id, source_type, title, summary, href, keywords, body,
       importance, document_date, topics, entities, normalized_title,
       normalized_summary, normalized_keywords, normalized_body
     )
     SELECT input.id, input.source_id, input.source_type, input.title, input.summary,
            input.href, input.keywords, input.body, input.importance, input.document_date,
            input.topics, input.entities, input.normalized_title, input.normalized_summary,
            input.normalized_keywords, input.normalized_body
     FROM unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::text[], $8::text[], $9::integer[], $10::date[], $11::jsonb[], $12::jsonb[],
       $13::text[], $14::text[], $15::text[], $16::text[]
     ) AS input(
       id, source_id, source_type, title, summary, href, keywords, body,
       importance, document_date, topics, entities, normalized_title,
       normalized_summary, normalized_keywords, normalized_body
     )
     ON CONFLICT (id) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       source_type = EXCLUDED.source_type,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       href = EXCLUDED.href,
       keywords = EXCLUDED.keywords,
       body = EXCLUDED.body,
       importance = EXCLUDED.importance,
       document_date = EXCLUDED.document_date,
       topics = EXCLUDED.topics,
       entities = EXCLUDED.entities,
       normalized_title = EXCLUDED.normalized_title,
       normalized_summary = EXCLUDED.normalized_summary,
       normalized_keywords = EXCLUDED.normalized_keywords,
       normalized_body = EXCLUDED.normalized_body`,
    [
      rows.map((row) => row.id),
      rows.map((row) => row.sourceId),
      rows.map((row) => row.sourceType),
      rows.map((row) => row.title),
      rows.map((row) => row.summary),
      rows.map((row) => row.href),
      rows.map((row) => row.keywords),
      rows.map((row) => row.body),
      rows.map((row) => row.importance),
      rows.map((row) => row.documentDate),
      rows.map((row) => JSON.stringify(row.topics)),
      rows.map((row) => JSON.stringify(row.entities)),
      rows.map((row) => row.normalizedTitle),
      rows.map((row) => row.normalizedSummary),
      rows.map((row) => row.normalizedKeywords),
      rows.map((row) => row.normalizedBody),
    ],
  );
  return result.rowCount;
}

export async function syncSearchDocuments(
  client,
  desiredRows,
  { dryRun = true, expectedProjectionFingerprint, expectedPlanFingerprint } = {},
) {
  if (typeof dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
  for (const [label, value] of [
    ['expectedProjectionFingerprint', expectedProjectionFingerprint],
    ['expectedPlanFingerprint', expectedPlanFingerprint],
  ]) {
    if (value !== undefined && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error(`${label} must be a lowercase SHA-256 digest`);
    }
  }
  const desired = normalizeSearchDocuments(desiredRows, 'desiredSearchDocuments');
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '2min'");
    const lock = await client.query(
      'SELECT pg_try_advisory_xact_lock($1, $2) AS locked',
      migrationLockKeys,
    );
    if (lock.rows[0]?.locked !== true) {
      throw new Error('Another database migration or projection sync process holds the lock');
    }
    await client.query('LOCK TABLE public.search_documents IN SHARE ROW EXCLUSIVE MODE');
    const plan = planSearchDocumentSync(desired, await readSearchDocuments(client));
    if (expectedProjectionFingerprint && plan.fingerprint !== expectedProjectionFingerprint) {
      throw new Error('Search projection fingerprint changed inside the locked transaction');
    }
    if (expectedPlanFingerprint && plan.planFingerprint !== expectedPlanFingerprint) {
      throw new Error('Search sync plan fingerprint changed inside the locked transaction');
    }
    const written = await writeSearchDocuments(client, [...plan.inserts, ...plan.updates]);
    if (written !== plan.inserts.length + plan.updates.length) {
      throw new Error('Search sync write count differs from the reviewed plan');
    }
    const deleted = plan.deletes.length
      ? (
          await client.query('DELETE FROM public.search_documents WHERE id = ANY($1::text[])', [
            plan.deletes.map((row) => row.id),
          ])
        ).rowCount
      : 0;
    if (deleted !== plan.deletes.length) {
      throw new Error('Search sync delete count differs from the reviewed plan');
    }
    const verification = planSearchDocumentSync(desired, await readSearchDocuments(client));
    if (verification.changedIds.length > 0) {
      throw new Error(
        `Search sync verification found residual drift: ${verification.changedIds.join(', ')}`,
      );
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    transactionOpen = false;
    return {
      mode: dryRun ? 'dry-run' : 'apply',
      committed: !dryRun,
      fingerprint: plan.fingerprint,
      planFingerprint: plan.planFingerprint,
      desiredCount: plan.desiredCount,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      deleted: plan.deletes.length,
      unchanged: plan.unchanged.length,
      changedIds: plan.changedIds,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runSearchDocumentSync({
  connectionString,
  desiredDocuments,
  dryRun = true,
  connectionTimeoutMillis = 10_000,
  beforeSync,
  expectedProjectionFingerprint,
  expectedPlanFingerprint,
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new Error('Search sync database connection string is required');
  }
  const client = new Client({
    connectionString,
    application_name: 'hzense-search-sync',
    connectionTimeoutMillis,
  });
  await client.connect();
  try {
    if (beforeSync) await beforeSync(client);
    return await syncSearchDocuments(client, desiredDocuments, {
      dryRun,
      expectedProjectionFingerprint,
      expectedPlanFingerprint,
    });
  } finally {
    await client.end();
  }
}
