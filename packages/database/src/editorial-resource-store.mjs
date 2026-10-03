import { createHash } from 'node:crypto';
import { isExcludedPublicPerson } from '@hzense/ingestion/person-resource-policy';
import {
  editorialFail as fail,
  editorialResourceName,
  normalizeEditorialResources,
} from './editorial-signal-contract.mjs';

const supportedTypes = new Set(['person', 'company', 'institution']);
const key = (row) => `${row.type}:${editorialResourceName(row.name)}`;
const stableId = (row, identity) =>
  `${row.type}-generated-${createHash('sha256')
    .update(JSON.stringify([identity.runId, identity.candidateIndex, key(row)]))
    .digest('hex')
    .slice(0, 32)}`;
const isExcluded = (row) =>
  row.type === 'person' &&
  (isExcludedPublicPerson(row) || [row.name, ...(row.aliases ?? [])].some(isExcludedPublicPerson));

async function catalogEntries(client, catalog) {
  // A hard failure at the bound is safer than resolving against a truncated
  // catalog and accidentally allocating another identity.
  const database = (
    await client.query(
      'SELECT id,name,type,status,aliases FROM public.entities ORDER BY id LIMIT 10001',
    )
  ).rows;
  if (database.length > 10000) fail('resource_catalog_unavailable');
  const entries = new Map(database.map((row) => [row.id, { ...row, inDatabase: true }]));
  for (const row of catalog ?? []) {
    if (!supportedTypes.has(row.type)) continue;
    if (
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      (row.aliases !== undefined &&
        (!Array.isArray(row.aliases) || row.aliases.some((alias) => typeof alias !== 'string')))
    )
      fail('entity_reference_invalid');
    const existing = entries.get(row.id);
    if (existing) {
      if (existing.type !== row.type) fail('entity_reference_invalid');
      // DB status and canonical name remain authoritative. A matching trusted
      // seed alias can still identify that same record without changing it.
      existing.aliases = [
        ...new Set([...(existing.aliases ?? []), row.name, ...(row.aliases ?? [])]),
      ];
    } else entries.set(row.id, { ...row, aliases: row.aliases ?? [], inDatabase: false });
  }
  return entries;
}
function resolveResource(resource, entries) {
  const name = editorialResourceName(resource.name);
  // Company/institution disagreement is ambiguity, never an excuse to create
  // a duplicate organization. Only an explicit selection may correct its type.
  const sameKind = (row) =>
    resource.type === 'person'
      ? row.type === 'person'
      : ['company', 'institution'].includes(row.type);
  const named = [...entries.values()].filter(
    (row) =>
      sameKind(row) &&
      [row.name, ...(row.aliases ?? [])].some((alias) => editorialResourceName(alias) === name),
  );
  const matches = named
    .filter((row) => row.status === 'active' && !isExcluded(row))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { matches, blocked: named.length > 0 && matches.length === 0 };
}
export async function previewEditorialResources({ pool, resources, catalog }) {
  const rows = normalizeEditorialResources(resources, { generated: true });
  const client = await pool.connect();
  let discard = false;
  try {
    const entries = await catalogEntries(client, catalog);
    return rows.map((resource) => {
      const { matches, blocked } = resolveResource(resource, entries);
      return {
        name: resource.name,
        type: resource.type,
        matches: matches.map(({ id, name, type }) => ({ id, name, type })),
        status:
          blocked ||
          matches.length > 1 ||
          (matches.length === 1 && matches[0].type !== resource.type)
            ? 'ambiguous'
            : matches.length
              ? 'reuse'
              : 'new',
      };
    });
  } catch (error) {
    discard = error?.name !== 'EditorialSignalError';
    if (error?.name === 'EditorialSignalError') throw error;
    fail('database_unavailable');
  } finally {
    client.release(discard);
  }
}

/** Caller owns the publication transaction and all rollback/replay handling. */
export async function registerEditorialResources({
  client,
  resources,
  catalog,
  sourceOptions,
  sourceUrls,
  priorResources,
  runId,
  candidateIndex,
}) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    'material-registration:catalog',
  ]);
  const entries = await catalogEntries(client, catalog);
  const result = [];
  for (const resource of resources) {
    if (resource.type === 'person' && isExcludedPublicPerson(resource)) fail('excluded_person');
    const { matches, blocked } = resolveResource(resource, entries);
    const provenance = sourceOptions?.find(
      (row) =>
        editorialResourceName(row.name) === editorialResourceName(resource.name) &&
        (row.type === 'person') === (resource.type === 'person'),
    );
    let selected;
    if (resource.entity_id !== null && resource.entity_id !== '__new__') {
      selected = matches.find((row) => row.id === resource.entity_id);
      if (!selected) fail('entity_reference_invalid');
    } else if (resource.entity_id === null) {
      // A preview of no match is not consent to reuse a person discovered by
      // another concurrent publication. Require an explicit identity choice.
      if (blocked || matches.length) fail('resource_identity_ambiguous');
    }
    if (!selected) {
      const id = stableId(resource, { runId, candidateIndex });
      const old = entries.get(id);
      if (
        old &&
        (old.type !== resource.type ||
          editorialResourceName(old.name) !== editorialResourceName(resource.name) ||
          old.status !== 'active')
      )
        fail('entity_reference_invalid');
      selected = old ?? {
        id,
        name: resource.name,
        type: resource.type,
        status: 'active',
        aliases: [],
        inDatabase: false,
      };
    }
    if (
      typeof selected.id !== 'string' ||
      selected.id.length > 200 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected.id)
    )
      fail('entity_reference_invalid');
    // These are only resources from the locked latest published/withdrawn
    // revision, never client fields or a draft. A source whose import later
    // becomes unavailable may survive for exactly the same canonical identity
    // and resource evidence; changing a profile cannot borrow its old sources.
    const prior = priorResources?.find(
      (row) =>
        row.entity_id === selected.id &&
        row.type === selected.type &&
        row.name === resource.name &&
        row.introduction === resource.introduction &&
        row.event_role === resource.event_role &&
        row.evidence?.length === resource.evidence.length &&
        row.evidence.every(
          (entry, index) =>
            entry.fragment_id === resource.evidence[index].fragment_id &&
            entry.quote === resource.evidence[index].quote,
        ),
    );
    const resourceUrls = sourceUrls.filter(
      (url) => provenance?.sourceUrls.includes(url) || prior?.source_urls?.includes(url),
    );
    if (!resourceUrls.length) fail('resource_source_required');
    if (!selected.inDatabase) {
      await client.query(
        "INSERT INTO public.entities(id,type,name,status,aliases) VALUES($1,$2,$3,'active',$4::text[])",
        [selected.id, selected.type, selected.name, selected.aliases ?? []],
      );
      selected.inDatabase = true;
      entries.set(selected.id, selected);
    }
    const table = selected.type === 'person' ? 'person_profiles' : 'organization_profiles';
    const profile = (
      await client.query(`SELECT entity_id,entity_type FROM public.${table} WHERE entity_id=$1`, [
        selected.id,
      ])
    ).rows[0];
    if (profile && profile.entity_type !== selected.type) fail('entity_reference_invalid');
    if (!profile)
      await client.query(`INSERT INTO public.${table}(entity_id,entity_type) VALUES($1,$2)`, [
        selected.id,
        selected.type,
      ]);
    result.push({
      ...resource,
      type: selected.type,
      entity_id: selected.id,
      source_urls: resourceUrls,
    });
  }
  if (new Set(result.map((row) => row.entity_id)).size !== result.length)
    fail('entity_reference_invalid');
  return result;
}
