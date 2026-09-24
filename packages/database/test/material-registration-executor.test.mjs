import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  registerMaterialPlan,
  verifyRegisteredMaterialPlan,
} from '../src/material-registration-executor.mjs';

const fixture = () => {
  const excerpt = 'Ada is a researcher at Lab.';
  return {
    version: 'material-registration-v1',
    owner: 'owner',
    runId: '11111111-1111-4111-8111-111111111111',
    candidateIndex: 0,
    baseMaterialHash: 'a'.repeat(64),
    sourceBundleHash: 'b'.repeat(64),
    entities: [
      { id: 'ada', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['e'] },
      { id: 'lab', type: 'institution', name: 'Lab', aliases: [], evidenceIds: ['e'] },
    ],
    sources: [
      { id: 's', name: 'Source', url: 'https://example.com/', allowedHosts: ['example.com'] },
    ],
    evidence: [
      {
        id: 'e',
        sourceId: 's',
        sourceUrl: 'https://example.com/post',
        locator: 'p1',
        excerpt,
        contentHash: createHash('sha256').update(excerpt).digest('hex'),
        capturedAt: '2026-09-24T10:00:00.000Z',
        sourcePublishedAt: null,
      },
    ],
    topicIds: ['topic-ai'],
    candidate: {
      title: 'Title',
      summary: 'Summary',
      eventDate: '2026-09-24',
      persons: [{ entityId: 'ada', role: 'researcher', organizationId: 'lab', evidenceIds: ['e'] }],
      organizationIds: ['lab'],
      claims: [{ text: 'Ada works at Lab.', evidenceId: 'e' }],
    },
  };
};
const norm = (value) => value.normalize('NFKC').trim().toLowerCase();
function clientFixture() {
  const state = {
    sources: [],
    entities: [],
    profiles: [],
    evidence: [],
    topics: ['topic-ai'],
    queries: [],
    dropUpdate: false,
  };
  const client = {
    async query(sql, p = []) {
      state.queries.push({ sql, p });
      if (sql.startsWith('SELECT id FROM public.topics'))
        return { rows: state.topics.filter((id) => p[0].includes(id)).map((id) => ({ id })) };
      if (sql.startsWith('SELECT id,name,url'))
        return { rows: state.sources.filter((row) => row.id === p[0]) };
      if (sql.startsWith('INSERT INTO public.sources'))
        state.sources.push({ id: p[0], name: p[1], url: p[2], allowed_hosts: p[3], active: true });
      else if (sql.startsWith('SELECT id,type,name'))
        return {
          rows: state.entities.filter(
            (row) =>
              row.id === p[0] ||
              [row.name, ...row.aliases].some((name) => p[1].includes(norm(name))),
          ),
        };
      else if (sql.startsWith('INSERT INTO public.entities'))
        state.entities.push({ id: p[0], type: p[1], name: p[2], aliases: p[3], status: 'active' });
      else if (sql.startsWith('SELECT entity_id'))
        return { rows: state.profiles.filter((row) => row.entity_id === p[0]) };
      else if (/^INSERT INTO public\.(person_profiles|organization_profiles)/.test(sql))
        state.profiles.push({ entity_id: p[0], entity_type: p[1] });
      else if (sql.startsWith('SELECT id,source_id'))
        return { rows: state.evidence.filter((row) => row.id === p[0]) };
      else if (sql.startsWith('INSERT INTO public.public_source_evidence'))
        state.evidence.push({
          id: p[0],
          source_id: p[1],
          source_url: p[2],
          locator: p[3],
          excerpt: p[4],
          content_hash: p[5],
          captured_at: p[6],
          source_published_at: p[7],
          verification_status: 'pending',
        });
      else if (sql.startsWith('UPDATE public.public_source_evidence')) {
        if (state.dropUpdate) return { rows: [] };
        const row = state.evidence.find(
          (item) => item.id === p[0] && item.verification_status === 'pending',
        );
        if (row) row.verification_status = 'verified';
        return { rows: row ? [{ id: row.id }] : [] };
      } else throw new Error(`Unexpected query ${sql}`);
      return { rows: [] };
    },
  };
  return { client, state };
}
async function registered() {
  const db = clientFixture(),
    plan = fixture();
  await registerMaterialPlan({ client: db.client, plan });
  db.state.queries = [];
  return { ...db, plan };
}

describe('restricted material registration executor', () => {
  it('creates entities, typed profiles, neutral sources and pending evidence without transaction ownership', async () => {
    const { client, state } = clientFixture();
    expect(await registerMaterialPlan({ client, plan: fixture() })).toEqual({
      entityIds: ['ada', 'lab'],
      evidenceIds: ['e'],
      topicIds: ['topic-ai'],
    });
    expect(state.profiles).toEqual([
      { entity_id: 'ada', entity_type: 'person' },
      { entity_id: 'lab', entity_type: 'institution' },
    ]);
    expect(state.evidence[0].verification_status).toBe('pending');
    const writes = state.queries.filter(({ sql }) => sql.startsWith('INSERT'));
    expect(writes).toHaveLength(6);
    expect(writes.find(({ sql }) => sql.includes('public_source_evidence')).sql).not.toContain(
      'verification_status',
    );
    expect(
      state.queries.some(({ sql }) => /^(BEGIN|COMMIT|ROLLBACK|UPDATE|DELETE)/.test(sql)),
    ).toBe(false);
  });
  it('reuses exact existing rows idempotently and repairs only a missing typed profile', async () => {
    const { client, state, plan } = await registered();
    await registerMaterialPlan({ client, plan });
    expect(state.queries.every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
    state.profiles.pop();
    state.queries = [];
    await registerMaterialPlan({ client, plan });
    expect(
      state.queries.filter(({ sql }) => sql.startsWith('INSERT')).map(({ sql }) => sql),
    ).toEqual(['INSERT INTO public.organization_profiles(entity_id,entity_type) VALUES($1,$2)']);
  });
  it.each([
    (s) => {
      s.topics = [];
    },
    (s) => {
      s.sources[0].active = false;
    },
    (s) => {
      s.sources[0].allowed_hosts = ['other.example.com'];
    },
    (s) => {
      s.sources[0].name = 'Changed';
    },
    (s) => {
      s.entities[0].name = 'Different';
    },
    (s) => {
      s.entities[0].type = 'company';
    },
    (s) => {
      s.entities[0].status = 'archived';
    },
    (s) => {
      s.entities[0].aliases = ['Ada Lovelace'];
    },
    (s) => {
      s.profiles[0].entity_type = 'company';
    },
    (s) => {
      s.evidence[0].excerpt = 'Other';
    },
    (s) => {
      s.evidence[0].content_hash = 'f'.repeat(64);
    },
    (s) => {
      s.evidence[0].source_url = 'https://example.com/other';
    },
    (s) => {
      s.evidence[0].locator = 'p2';
    },
    (s) => {
      s.evidence[0].source_id = 'other';
    },
    (s) => {
      s.evidence[0].captured_at = '2026-09-25T10:00:00.000Z';
    },
    (s) => {
      s.evidence[0].source_published_at = '2026-09-25T10:00:00.000Z';
    },
    (s) => {
      s.evidence[0].verification_status = 'rejected';
    },
  ])('rejects registry conflict without overwriting material %#', async (mutate) => {
    const { client, state, plan } = await registered();
    mutate(state);
    await expect(registerMaterialPlan({ client, plan })).rejects.toThrow();
    expect(state.queries.every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('rejects name and alias ambiguity after NFKC normalization', async () => {
    for (const entity of [
      { name: 'Ａｄａ', aliases: [] },
      { name: 'Other', aliases: [' ADA '] },
    ]) {
      const { client, state } = clientFixture();
      state.entities.push({ id: 'other', type: 'person', status: 'active', ...entity });
      await expect(registerMaterialPlan({ client, plan: fixture() })).rejects.toThrow(
        'material_entity_ambiguous',
      );
    }
  });
});

describe('independent registered material verification executor', () => {
  it('rechecks the complete plan before updating only pending status and is idempotent', async () => {
    const { client, state, plan } = await registered();
    state.evidence[0].captured_at = new Date(state.evidence[0].captured_at);
    await verifyRegisteredMaterialPlan({ client, plan });
    expect(state.evidence[0].verification_status).toBe('verified');
    expect(
      state.queries.filter(({ sql }) => !sql.startsWith('SELECT')).map(({ sql }) => sql),
    ).toEqual([
      "UPDATE public.public_source_evidence SET verification_status='verified' WHERE id=$1 AND verification_status='pending' RETURNING id",
    ]);
    state.queries = [];
    await verifyRegisteredMaterialPlan({ client, plan });
    expect(state.queries.every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
  });
  it.each(['sources', 'entities', 'profiles', 'evidence', 'topics'])(
    'never inserts missing %s during verification',
    async (table) => {
      const { client, state, plan } = await registered();
      state[table] = [];
      await expect(verifyRegisteredMaterialPlan({ client, plan })).rejects.toThrow();
      expect(state.queries.every(({ sql }) => sql.startsWith('SELECT'))).toBe(true);
    },
  );
  it('cannot resurrect rejected evidence and rejects a concurrent status change', async () => {
    const { client, state, plan } = await registered();
    state.evidence[0].verification_status = 'rejected';
    await expect(verifyRegisteredMaterialPlan({ client, plan })).rejects.toThrow(
      'material_evidence_rejected',
    );
    state.evidence[0].verification_status = 'pending';
    state.dropUpdate = true;
    await expect(verifyRegisteredMaterialPlan({ client, plan })).rejects.toThrow(
      'material_registration_conflict',
    );
  });
});
