import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../../content/src/seed.ts';
import { projectLegacySignalEntries } from '../../../apps/web/lib/legacy-signal-projection.ts';
import { buildLegacySignalArchivePlan } from '../src/legacy-signal-archive.mjs';
import {
  assertUnifiedSignalContent,
  unifiedSignalReadiness,
} from '../src/unified-signal-contract.mjs';
import {
  assertUnifiedSignalPlan,
  buildUnifiedSignalPlan,
  previewUnifiedPublicSignals,
} from '../src/unified-signal-plan.mjs';

let archivePlan;
beforeAll(async () => {
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
    fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  );
  archivePlan = buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog));
});
const run = '55a4e895-0fd2-46eb-bb42-67c02e779bbe';
const content = {
  title: '公司发布研究成果',
  summary: '研究内容摘要。',
  eventDate: '2026-10-01',
  persons: ['研究负责人'],
  organizations: ['研究组织'],
  topics: [{ id: 'ai-safety', title: 'AI 安全' }],
  sourceUrls: ['https://example.com/research'],
  signalType: 'research',
};
function revisions(actions = ['draft', 'publish', 'withdraw']) {
  return actions.map((action, i) => ({
    request_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    run_id: run,
    owner_id: 'private-owner',
    candidate_index: 0,
    revision: i + 1,
    action,
    content: JSON.parse(JSON.stringify(content)),
    created_at: `2026-10-0${i + 1}T12:00:00.000Z`,
    material_hash: 'a'.repeat(64),
    request_hash: 'b'.repeat(64),
  }));
}
const sources = (rows = revisions()) => ({ archivePlan, editorialRevisions: rows });

describe('Signal 4.0 unified storage preview', () => {
  it('maps all 110 frozen archive rows into signals and signal_versions without fake strength', () => {
    const plan = buildUnifiedSignalPlan(sources([]));
    expect(plan.signals).toHaveLength(110);
    expect(plan.signal_versions).toHaveLength(110);
    expect(plan.source_counts).toEqual({ legacy: 110, editorial_revisions: 0 });
    for (const row of plan.signal_versions) {
      const old = archivePlan.rows.find((entry) => entry.signal_id === row.signal_id);
      expect(row.content.title).toBe(old.signal.title);
      expect(row.content.summary).toBe(old.signal.summary);
      expect(row.content.occurred_at).toBe(old.signal.occurred_at);
      expect(row.content.captured_at).toBe(old.signal.captured_at);
      expect(row.content.confidence).toBe(old.signal.confidence);
      expect(row.content.topics.map((topic) => topic.id)).toEqual(old.signal.topics);
      expect(row.content.sources[0].url).toBe(old.signal.source_url);
      expect(row.content.people.map((person) => person.id)).toEqual(
        old.projection.public_people.map((person) => person.id),
      );
      expect(row.content.organizations.map((org) => org.id)).toEqual(
        old.projection.public_organizations.map((org) => org.id),
      );
      expect(row.publication_basis).toBe('legacy_import');
      expect(row.recorded_at).toBeNull();
      expect(row.content).not.toHaveProperty('strength');
      expect(row.source_record_hash).toBe(old.record_hash);
    }
  });
  it('preserves original editorial URL IDs, all revisions and a final withdrawal', () => {
    const input = sources();
    const plan = buildUnifiedSignalPlan(input);
    const id = `editorial-${createHash('md5').update(`${run}:0`).digest('hex')}`;
    const history = plan.signal_versions.filter((row) => row.signal_id === id);
    expect(history.map((row) => row.status)).toEqual(['draft', 'published', 'withdrawn']);
    expect(history.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(plan.signals.find((row) => row.id === id).latest_version).toBe(3);
    expect(previewUnifiedPublicSignals(plan, input).some((row) => row.id === id)).toBe(false);
    expect(history[1].content).toMatchObject({
      captured_at: null,
      importance: null,
      confidence: null,
      novelty: null,
      people: [{ id: null, kind: 'person', name: '研究负责人' }],
      organizations: [{ id: null, kind: null, name: '研究组织' }],
    });
    expect(history.map((row) => row.publication_basis)).toEqual([
      null,
      'manual_confirmation',
      'manual_confirmation',
    ]);
  });
  it('keeps a republication and hides subsequent drafts, without falling back to older publication', () => {
    for (const [actions, count] of [
      [['publish'], 111],
      [['publish', 'withdraw'], 110],
      [['publish', 'withdraw', 'draft'], 110],
      [['publish', 'withdraw', 'publish'], 111],
    ]) {
      const input = sources(revisions(actions));
      expect(previewUnifiedPublicSignals(buildUnifiedSignalPlan(input), input)).toHaveLength(count);
    }
  });
  it('is deterministic across database row order and detached from mutable inputs', () => {
    const input = sources();
    const plan = buildUnifiedSignalPlan(input);
    expect(buildUnifiedSignalPlan(sources([...input.editorialRevisions].reverse()))).toEqual(plan);
    input.editorialRevisions[0].content.title = '修改';
    expect(plan.signal_versions.find((row) => row.origin === 'ai_generation').content.title).toBe(
      content.title,
    );
    expect(() => assertUnifiedSignalPlan(plan, input)).toThrow('unified_plan_source_mismatch');
  });
  it('preserves sub-millisecond revision timestamps', () => {
    const row = revisions(['publish'])[0];
    row.created_at = '2026-10-01T12:00:00.123456Z';
    const p = buildUnifiedSignalPlan(sources([row]));
    expect(p.signal_versions.find((r) => r.origin === 'ai_generation').recorded_at).toBe(
      row.created_at,
    );
  });
  it.each([
    ['only latest row', (rows) => rows.slice(-1), 'incomplete_editorial_history'],
    ['missing middle revision', (rows) => [rows[0], rows[2]], 'incomplete_editorial_history'],
    [
      'duplicate revision',
      (rows) => [{ ...rows[1], revision: 1 }, rows[0]],
      'incomplete_editorial_history',
    ],
    [
      'duplicate request',
      (rows) => [rows[0], { ...rows[1], request_id: rows[0].request_id }],
      'invalid_editorial_history',
    ],
    [
      'owner changed',
      (rows) => [rows[0], { ...rows[1], owner_id: 'other' }],
      'incomplete_editorial_history',
    ],
    [
      'withdraw without publish',
      (rows) => [{ ...rows[0], action: 'withdraw' }],
      'invalid_editorial_transition',
    ],
    [
      'draft after publish',
      (rows) => [
        { ...rows[0], action: 'publish' },
        { ...rows[1], action: 'draft' },
      ],
      'invalid_editorial_transition',
    ],
    [
      'withdraw changed content',
      (rows) => [...rows.slice(0, 2), { ...rows[2], content: { ...content, title: 'changed' } }],
      'invalid_editorial_transition',
    ],
  ])('rejects %s instead of fabricating or resurrecting history', (_, mutate, code) => {
    expect(() => buildUnifiedSignalPlan(sources(mutate(revisions())))).toThrow(code);
  });
  it('rejects altered plan hashes, deleted withdrawals, extra versions and unknown fields', () => {
    const input = sources();
    for (const mutate of [
      (p) => {
        p.plan_hash = '0'.repeat(64);
      },
      (p) => {
        p.signal_versions = p.signal_versions.filter((row) => row.status !== 'withdrawn');
      },
      (p) => {
        p.signal_versions.push(p.signal_versions[0]);
      },
      (p) => {
        p.signals[0].published = true;
      },
    ]) {
      const plan = buildUnifiedSignalPlan(input);
      mutate(plan);
      expect(() => previewUnifiedPublicSignals(plan, input)).toThrow(
        'unified_plan_source_mismatch',
      );
    }
  });
  it('public previews contain no private owner, request IDs or source hashes', () => {
    const input = sources(revisions(['publish']));
    const result = previewUnifiedPublicSignals(buildUnifiedSignalPlan(input), input);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-owner');
    expect(serialized).not.toContain('source_record');
    expect(serialized).not.toContain('material_hash');
    expect(serialized).not.toContain(run);
  });
  it('maps incomplete original metadata to explicit nulls without promoting draft to publication', () => {
    const row = revisions(['draft'])[0];
    row.content = {
      ...content,
      eventDate: null,
      signalType: null,
      persons: [],
      organizations: [],
      topics: [],
    };
    const input = sources([row]);
    const plan = buildUnifiedSignalPlan(input);
    const record = plan.signal_versions.find((r) => r.origin === 'ai_generation');
    expect(record.content.type).toBeNull();
    expect(unifiedSignalReadiness(record.content)).toEqual({
      ready: false,
      missing: ['occurred_at', 'people', 'organizations', 'topics', 'type'],
    });
    expect(previewUnifiedPublicSignals(plan, input)).toHaveLength(110);
  });
  it('preserves canonical resource identities and bounded event roles, not private quotes', () => {
    const row = revisions(['publish'])[0];
    row.content.resources = [
      {
        entity_id: 'person-researcher',
        type: 'person',
        name: content.persons[0],
        introduction: '研究负责人',
        event_role: '成果作者',
        source_urls: content.sourceUrls,
        evidence: [{ fragment_id: 'f1', quote: 'private quote' }],
      },
      {
        entity_id: 'organization-research',
        type: 'institution',
        name: content.organizations[0],
        introduction: null,
        event_role: null,
        evidence: [{ fragment_id: 'f1', quote: 'private quote' }],
      },
    ];
    const plan = buildUnifiedSignalPlan(sources([row]));
    const c = plan.signal_versions.find((r) => r.origin === 'ai_generation').content;
    expect(c.people[0]).toMatchObject({ id: 'person-researcher', event_role: '成果作者' });
    expect(c.people[0].source_urls).toEqual(content.sourceUrls);
    expect(c.organizations[0]).toMatchObject({ id: 'organization-research', kind: 'institution' });
    expect(JSON.stringify(c)).not.toContain('private quote');
  });
  it('enforces 80/500, a unique type, multiple topics and no strength on new content', () => {
    const c = buildUnifiedSignalPlan(sources(revisions(['publish']))).signal_versions.find(
      (r) => r.origin === 'ai_generation',
    ).content;
    expect(unifiedSignalReadiness(c).ready).toBe(true);
    const boundary = { ...c, title: '字'.repeat(80), summary: '字'.repeat(500) };
    expect(assertUnifiedSignalContent(boundary)).toEqual(boundary);
    for (const bad of [
      { ...c, title: '字'.repeat(81) },
      { ...c, summary: '字'.repeat(501) },
      { ...c, type: ['research', 'product'] },
      { ...c, strength: 5 },
      { ...c, confidence: 2 },
      { ...c, confidence: NaN },
      { ...c, occurred_at: '2026-02-30' },
      { ...c, topics: [c.topics[0], c.topics[0]] },
    ])
      expect(() => assertUnifiedSignalContent(bad)).toThrow();
    expect(
      assertUnifiedSignalContent({
        ...c,
        topics: [...c.topics, { id: 'robotics', title: '机器人' }],
      }).topics,
    ).toHaveLength(2);
  });
});
