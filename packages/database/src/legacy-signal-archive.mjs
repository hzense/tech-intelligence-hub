import { createHash } from 'node:crypto';
import {
  legacyArchiveCount,
  legacyArchivePlanHash,
  legacyArchiveProjectionHashes,
} from './legacy-signal-archive-manifest.mjs';

/** Object keys are ordered; arrays, Unicode, timestamps and absent fields are retained. */
export function canonicalLegacyArchiveJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLegacyArchiveJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalLegacyArchiveJson(value[key])}`)
      .join(',')}}`;
  throw new Error('legacy_archive_non_json_value');
}

const hash = (value) =>
  createHash('sha256').update(canonicalLegacyArchiveJson(value), 'utf8').digest('hex');
const same = (left, right) =>
  canonicalLegacyArchiveJson(left) === canonicalLegacyArchiveJson(right);
const fail = (message) => {
  throw new Error(message);
};
const eligible = (signal) =>
  ['accepted', 'reviewed'].includes(signal.status) && !signal.id.startsWith('editorial-');
function index(rows) {
  if (!Array.isArray(rows)) return fail('legacy_archive_invalid_catalog');
  const result = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) ||
      result.has(row.id)
    )
      return fail('legacy_archive_invalid_identity');
    result.set(row.id, row);
  }
  return result;
}
function referenced(values, catalog) {
  if (!Array.isArray(values) || new Set(values).size !== values.length)
    return fail('legacy_archive_invalid_references');
  return values.map((id) => catalog.get(id) ?? fail('legacy_archive_missing_reference'));
}

/**
 * The application supplies its existing historical projection, avoiding a second
 * implementation of presentation policy. The frozen plan authorizes one exact
 * catalog only; building a preview grants no permission to write it.
 */
export function buildLegacySignalArchivePlan(catalog, projections) {
  const signals = index(catalog.signals);
  const entities = index(catalog.entities);
  const sources = index(catalog.sources);
  const topics = index(catalog.topics);
  const projected = index(projections);
  const rows = [...signals.values()]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((signal) => {
      if (Object.hasOwn(signal, 'strength')) return fail('legacy_archive_removed_strength');
      const source = sources.get(signal.source_id) ?? fail('legacy_archive_missing_reference');
      const references = {
        source,
        entities: referenced(signal.entities, entities),
        topics: referenced(signal.topics, topics),
      };
      const projection = projected.get(signal.id) ?? null;
      if (eligible(signal) !== (projection !== null))
        return fail('legacy_archive_projection_set_mismatch');
      if (projection) {
        // These original fields must never be normalized, truncated or defaulted.
        for (const [key, value] of Object.entries(signal)) {
          if (key !== 'entities' && key !== 'entity_roles' && !same(value, projection[key]))
            return fail('legacy_archive_projection_content_mismatch');
        }
        for (const key of ['public_version', 'publication_revision', 'publication_basis'])
          if (Object.hasOwn(projection, key)) return fail('legacy_archive_publication_promotion');
        if (Object.hasOwn(projection, 'strength')) return fail('legacy_archive_removed_strength');
        if (
          !same(projection.public_sources, [
            { id: source.id, name: source.name, url: signal.source_url },
          ]) ||
          !same(
            projection.public_topics,
            references.topics.map((topic) => ({ id: topic.id, title: topic.title })),
          )
        )
          return fail('legacy_archive_projection_reference_mismatch');
      }
      const record = { signal_id: signal.id, signal, references, projection };
      return { ...record, content_hash: hash(projection), record_hash: hash(record) };
    });
  if (projected.size !== rows.filter((row) => row.projection !== null).length)
    return fail('legacy_archive_projection_set_mismatch');
  const payload = { schema_version: '1.0.0', rows, count: rows.length };
  // Break aliases to caller data, so subsequent catalog mutation cannot change a plan.
  return JSON.parse(canonicalLegacyArchiveJson({ ...payload, plan_hash: hash(payload) }));
}

export function assertLegacySignalArchivePlan(plan) {
  if (
    !plan ||
    plan.schema_version !== '1.0.0' ||
    !Array.isArray(plan.rows) ||
    plan.count !== legacyArchiveCount ||
    plan.rows.length !== legacyArchiveCount ||
    plan.plan_hash !== legacyArchivePlanHash ||
    hash({ schema_version: plan.schema_version, rows: plan.rows, count: plan.count }) !==
      legacyArchivePlanHash
  )
    return fail('legacy_archive_frozen_plan_mismatch');
  for (const row of plan.rows) {
    const record = {
      signal_id: row.signal_id,
      signal: row.signal,
      references: row.references,
      projection: row.projection,
    };
    if (
      hash(record) !== row.record_hash ||
      hash(row.projection) !== row.content_hash ||
      (row.projection !== null && legacyArchiveProjectionHashes[row.signal_id] !== row.content_hash)
    )
      return fail('legacy_archive_frozen_plan_mismatch');
  }
  return plan;
}

export const legacySignalArchiveReadQuery =
  'SELECT signal_id,signal,"references",projection,content_hash,record_hash FROM public.legacy_signal_archive ORDER BY signal_id';

/** Read-only full-set reconciliation; both hash and actual JSON are compared. */
export async function reconcileLegacySignalArchive(client, input) {
  const plan = assertLegacySignalArchivePlan(input);
  const current = (await client.query(legacySignalArchiveReadQuery)).rows;
  const expected = new Map(plan.rows.map((row) => [row.signal_id, row]));
  const seen = new Set();
  for (const row of current) {
    const target = expected.get(row.signal_id);
    if (!target || seen.has(row.signal_id) || !same(target, row))
      return fail('legacy_archive_existing_content_conflict');
    seen.add(row.signal_id);
  }
  return {
    existing: seen.size,
    missing: plan.rows.filter((row) => !seen.has(row.signal_id)).map((row) => row.signal_id),
    count: plan.count,
    plan_hash: plan.plan_hash,
  };
}

/**
 * Caller MUST own the transaction encompassing schema, import, grants and ledger.
 * LOCK TABLE requires a transaction and rejects accidental autocommit use. No
 * commit, rollback or production connection is created by this helper.
 */
export async function applyLegacySignalArchive(client, input) {
  const plan = assertLegacySignalArchivePlan(input);
  await client.query('LOCK TABLE public.legacy_signal_archive IN EXCLUSIVE MODE');
  const before = await reconcileLegacySignalArchive(client, plan);
  const missing = new Set(before.missing);
  for (const row of plan.rows) {
    if (!missing.has(row.signal_id)) continue;
    await client.query(
      'INSERT INTO public.legacy_signal_archive(signal_id,signal,"references",projection,content_hash,record_hash) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6)',
      [
        row.signal_id,
        canonicalLegacyArchiveJson(row.signal),
        canonicalLegacyArchiveJson(row.references),
        canonicalLegacyArchiveJson(row.projection),
        row.content_hash,
        row.record_hash,
      ],
    );
  }
  const after = await reconcileLegacySignalArchive(client, plan);
  if (after.missing.length) return fail('legacy_archive_incomplete_import');
  return {
    inserted: before.missing.length,
    existing: before.existing,
    count: after.count,
    plan_hash: after.plan_hash,
  };
}
