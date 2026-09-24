import {
  MaterialRegistrationError,
  normalizeMaterialPlan,
} from './material-registration-contract.mjs';

const fail = (code = 'material_registration_conflict') => {
  throw new MaterialRegistrationError(code);
};
const sorted = (items) => [...items].sort();
const equalSet = (a, b) =>
  Array.isArray(a) && JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const normalizedName = (value) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

async function topics(client, plan) {
  const result = await client.query(
    "SELECT id FROM public.topics WHERE id=ANY($1::text[]) AND runtime_enabled IS TRUE AND status<>'archived' ORDER BY id",
    [plan.topicIds],
  );
  if (
    !equalSet(
      result.rows.map((row) => row.id),
      plan.topicIds,
    )
  )
    fail('material_topic_invalid');
}

async function sources(client, plan, allowInsert) {
  for (const source of plan.sources) {
    const current = (
      await client.query(
        'SELECT id,name,url,allowed_hosts,active FROM public.sources WHERE id=$1',
        [source.id],
      )
    ).rows[0];
    if (current) {
      if (
        current.name !== source.name ||
        current.url !== source.url ||
        current.active !== true ||
        !equalSet(current.allowed_hosts, source.allowedHosts)
      )
        fail();
    } else {
      if (!allowInsert) fail('material_registration_missing');
      // Neutral registry metadata, never an inferred reputation score.
      await client.query(
        "INSERT INTO public.sources(id,name,type,url,trust_score,active,allowed_hosts) VALUES($1,$2,'website',$3,0,true,$4::text[])",
        [source.id, source.name, source.url, source.allowedHosts],
      );
    }
  }
}

async function entities(client, plan, allowInsert) {
  for (const entity of plan.entities) {
    const names = [...new Set([entity.name, ...entity.aliases].map(normalizedName))];
    const matches = await client.query(
      `SELECT id,type,name,status,aliases FROM public.entities WHERE id=$1 OR
        lower(btrim(normalize(name,NFKC)))=ANY($2::text[]) OR
        EXISTS(SELECT 1 FROM unnest(aliases) alias WHERE lower(btrim(normalize(alias,NFKC)))=ANY($2::text[])) ORDER BY id`,
      [entity.id, names],
    );
    if (matches.rows.some((row) => row.id !== entity.id)) fail('material_entity_ambiguous');
    const current = matches.rows[0];
    if (current) {
      if (
        current.type !== entity.type ||
        current.name !== entity.name ||
        current.status !== 'active' ||
        !equalSet(current.aliases, entity.aliases)
      )
        fail();
    } else {
      if (!allowInsert) fail('material_registration_missing');
      await client.query(
        "INSERT INTO public.entities(id,type,name,status,aliases) VALUES($1,$2,$3,'active',$4::text[])",
        [entity.id, entity.type, entity.name, entity.aliases],
      );
    }
    const table = entity.type === 'person' ? 'person_profiles' : 'organization_profiles';
    const profile = (
      await client.query(`SELECT entity_id,entity_type FROM public.${table} WHERE entity_id=$1`, [
        entity.id,
      ])
    ).rows[0];
    if (profile) {
      if (profile.entity_type !== entity.type) fail();
    } else {
      if (!allowInsert) fail('material_registration_missing');
      await client.query(`INSERT INTO public.${table}(entity_id,entity_type) VALUES($1,$2)`, [
        entity.id,
        entity.type,
      ]);
    }
  }
}

function exactEvidence(current, evidence) {
  if (
    current.source_id !== evidence.sourceId ||
    current.source_url !== evidence.sourceUrl ||
    current.locator !== evidence.locator ||
    current.excerpt !== evidence.excerpt ||
    current.content_hash !== evidence.contentHash ||
    iso(current.captured_at) !== evidence.capturedAt ||
    iso(current.source_published_at) !== evidence.sourcePublishedAt
  )
    fail();
  if (current.verification_status === 'rejected') fail('material_evidence_rejected');
  if (!['pending', 'verified'].includes(current.verification_status)) fail();
}

async function evidenceRows(client, plan, allowInsert) {
  for (const evidence of plan.evidence) {
    const current = (
      await client.query(
        'SELECT id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at,verification_status FROM public.public_source_evidence WHERE id=$1',
        [evidence.id],
      )
    ).rows[0];
    if (current) {
      exactEvidence(current, evidence);
      if (!allowInsert && current.verification_status === 'pending') {
        const changed = await client.query(
          "UPDATE public.public_source_evidence SET verification_status='verified' WHERE id=$1 AND verification_status='pending' RETURNING id",
          [evidence.id],
        );
        if (changed.rows.length !== 1 || changed.rows[0].id !== evidence.id) fail();
      }
    } else {
      if (!allowInsert) fail('material_registration_missing');
      // Deliberately omits verification_status: the restricted registrar cannot set it.
      await client.query(
        'INSERT INTO public.public_source_evidence(id,source_id,source_url,locator,excerpt,content_hash,captured_at,source_published_at) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)',
        [
          evidence.id,
          evidence.sourceId,
          evidence.sourceUrl,
          evidence.locator,
          evidence.excerpt,
          evidence.contentHash,
          evidence.capturedAt,
          evidence.sourcePublishedAt,
        ],
      );
    }
  }
}

async function execute(client, value, allowInsert) {
  const plan = normalizeMaterialPlan(value);
  await topics(client, plan);
  await sources(client, plan, allowInsert);
  await entities(client, plan, allowInsert);
  await evidenceRows(client, plan, allowInsert);
  return {
    entityIds: plan.entities.map((row) => row.id),
    evidenceIds: plan.evidence.map((row) => row.id),
    topicIds: plan.topicIds,
  };
}

/** Caller owns transaction, serialization locks, role validation, signed admission and receipt. */
export async function registerMaterialPlan({ client, plan }) {
  return execute(client, plan, true);
}

/** Independent verifier transaction only; rechecks the entire signed plan before verification. */
export async function verifyRegisteredMaterialPlan({ client, plan }) {
  return execute(client, plan, false);
}
