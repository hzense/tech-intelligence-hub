import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSeedCatalog, type SeedCatalog, type SeedSignal } from '../src/seed.js';

const root = new URL('../../../', import.meta.url);
const originalPath = 'insights/2026-09-29-daily-signal-review/';
const completionPath = 'insights/2026-09-29-pending-signal-completion/signals.candidates.yaml';
const acceptancePath = 'insights/2026-09-30-signal-acceptance/publication.json';
const originalNames = ['july-august-candidates.yaml', 'september-candidates.yaml'];
const revisedIds = [
  'signal-20260727-cxmt-star-listing',
  'signal-20260819-unitree-star-listing',
  'signal-20260908-us-agencies-ai-distillation-advisory',
  'signal-20260917-anthropic-rd-automation-index',
  'signal-20260920-openai-agent-dns-egress',
];
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

interface Bundle {
  signals: SeedCatalog['signals'];
  entities: SeedCatalog['entities'];
  sources: SeedCatalog['sources'];
}

interface Acceptance {
  schema: string;
  confirmed_at: string;
  authorization: string;
  scope: string;
  accepted_count: number;
  formal_seed_before: number;
  formal_seed_after: number;
  accepted: {
    signal_id: string;
    event_key: string;
    input_file: string;
    input_sha256: string;
    accepted_snapshot_sha256: string;
  }[];
  registered_entities: string[];
  registered_sources: string[];
  registered_topics: string[];
}

function mergeById<T extends { id: string }>(groups: T[][]): T[] {
  const entries = new Map<string, T>();
  for (const group of groups) {
    for (const entry of group) {
      const previous = entries.get(entry.id);
      if (previous) expect(entry, `Conflicting catalog identity ${entry.id}`).toEqual(previous);
      else entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}

async function loadAcceptance() {
  // Immutable research snapshots define this historical acceptance. Neither the
  // current Seed count nor today's editorial revisions are frozen by this test.
  const context = parse(
    await readFile(new URL(`${originalPath}catalog-context.yaml`, root), 'utf8'),
  ) as Pick<SeedCatalog, 'entities' | 'sources' | 'topics'>;
  const originals = await Promise.all(
    originalNames.map(async (name) => ({
      file: `${originalPath}${name}`,
      bundle: parse(await readFile(new URL(`${originalPath}${name}`, root), 'utf8')) as Bundle,
    })),
  );
  const revised = parse(await readFile(new URL(completionPath, root), 'utf8')) as Bundle;
  const previousRaw = await readFile(new URL(`${originalPath}publication.json`, root));
  const previous = JSON.parse(previousRaw.toString('utf8')) as {
    accepted_count: number;
    deferred_count: number;
    accepted: { signal_id: string }[];
    deferred: { signal_id: string }[];
  };
  const acceptance = JSON.parse(
    await readFile(new URL(acceptancePath, root), 'utf8'),
  ) as Acceptance;
  const inputs = new Map<string, { file: string; signal: SeedSignal }>();
  for (const { file, bundle } of originals) {
    for (const signal of bundle.signals) inputs.set(signal.id, { file, signal });
  }
  for (const signal of revised.signals) {
    inputs.set(signal.id, { file: completionPath, signal });
  }
  const snapshots = acceptance.accepted.map((entry) => {
    const input = inputs.get(entry.signal_id);
    expect(input, entry.signal_id).toBeDefined();
    return { ...input!.signal, status: 'accepted' as const };
  });
  const proposed = parseSeedCatalog({
    signals: snapshots,
    entities: mergeById([
      context.entities,
      ...originals.map(({ bundle }) => bundle.entities),
      revised.entities,
    ]),
    sources: mergeById([
      context.sources,
      ...originals.map(({ bundle }) => bundle.sources),
      revised.sources,
    ]),
    topics: context.topics,
    relations: [],
    radar: [],
  });
  return { acceptance, previous, previousRaw, originals, revised, inputs, snapshots, proposed };
}

describe('2026-09-30 remaining Signal acceptance archive', () => {
  it('summarizes both acceptance ledgers and the five revised candidates without rewriting snapshots', async () => {
    const script = fileURLToPath(new URL(`${originalPath}analysis/summarize.mjs`, root));
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, [script]);
    const result = JSON.parse(stdout);
    expect(result.candidates.count).toBe(39);
    expect(result.candidates.confirmed_for_seed).toBe(39);
    expect(result.candidates.pending).toBe(0);
    const { stdout: markdown } = await run(process.execPath, [script, 'markdown']);
    expect(markdown).toContain('39 条已获用户确认，0 条未确认');
    expect(markdown).toContain('Marina Favaro、Phillie Wright');
    expect(markdown).toContain('美国三机构就针对前沿 AI 模型的蒸馏活动发布安全公告');
    expect(markdown).not.toContain('11 条待补');
  });

  it('accepts exactly the original 11 deferred candidates without rewriting the earlier decision', async () => {
    const { acceptance, previous, previousRaw, originals } = await loadAcceptance();
    expect(acceptance.schema).toBe('hzense-signal-acceptance-v1');
    expect(acceptance.authorization).toBe('user_approved_all_11_reviewed_candidates');
    expect(acceptance.scope).toBe('local_seed_acceptance');
    expect(acceptance.confirmed_at).toMatch(/^2026-09-30T/);
    expect(Number.isNaN(Date.parse(acceptance.confirmed_at))).toBe(false);
    expect(acceptance.accepted_count).toBe(11);
    expect(acceptance.accepted).toHaveLength(acceptance.accepted_count);
    // These are historical ledger totals, not constraints on the live catalog.
    expect(acceptance.formal_seed_before).toBe(99);
    expect(acceptance.formal_seed_after).toBe(
      acceptance.formal_seed_before + acceptance.accepted_count,
    );
    const ids = acceptance.accepted.map((entry) => entry.signal_id);
    const previouslyAccepted = previous.accepted.map((entry) => entry.signal_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(previous.deferred.map((entry) => entry.signal_id).sort());
    expect(ids.filter((id) => previouslyAccepted.includes(id))).toEqual([]);
    expect([...ids, ...previouslyAccepted].sort()).toEqual(
      originals.flatMap(({ bundle }) => bundle.signals.map((signal) => signal.id)).sort(),
    );
    expect(previous.accepted_count).toBe(28);
    expect(previous.deferred_count).toBe(11);
    // The old ledger remains an honest record of its original partial approval.
    expect(digest(previousRaw)).toBe(
      'f57ca2316f64366a7babcf856b841f625afbfd0ab27829f61e8266ac30261c72',
    );
  });

  it('accepts the five completed revisions and the six unchanged candidates with traceable hashes', async () => {
    const { acceptance, inputs, originals, revised } = await loadAcceptance();
    expect(revised.signals.map((signal) => signal.id).sort()).toEqual([...revisedIds].sort());
    expect(acceptance.accepted.filter((entry) => entry.input_file === completionPath)).toHaveLength(
      5,
    );
    for (const entry of acceptance.accepted) {
      const input = inputs.get(entry.signal_id)!;
      expect(entry.input_file).toBe(input.file);
      expect(entry.input_file === completionPath).toBe(revisedIds.includes(entry.signal_id));
      expect(input.signal.status).toBe('inbox');
      expect(entry.event_key).toBe(input.signal.event_key);
      expect(entry.input_sha256).toBe(digest(JSON.stringify(input.signal)));
      expect(entry.accepted_snapshot_sha256).toBe(
        digest(JSON.stringify({ ...input.signal, status: 'accepted' })),
      );
      expect(entry.accepted_snapshot_sha256).not.toBe(entry.input_sha256);
    }
    for (const signal of originals.flatMap(({ bundle }) => bundle.signals)) {
      expect(signal.status).toBe('inbox');
    }
  });

  it('validates accepted snapshots against the frozen reference catalog without inventing required people', async () => {
    const { proposed, snapshots, acceptance } = await loadAcceptance();
    expect(proposed.signals).toEqual(snapshots);
    expect(new Set(proposed.signals.map((signal) => signal.event_key)).size).toBe(11);
    const topics = new Map(proposed.topics.map((topic) => [topic.id, topic]));
    for (const signal of proposed.signals) {
      expect(signal.status).toBe('accepted');
      expect(typeof signal.type).toBe('string');
      expect([...signal.title].length).toBeLessThanOrEqual(80);
      expect([...signal.summary].length).toBeLessThanOrEqual(500);
      expect(signal.topics.length).toBeGreaterThanOrEqual(1);
      expect(signal.topics.length).toBeLessThanOrEqual(5);
      expect(new Set(signal.topics).size).toBe(signal.topics.length);
      for (const id of signal.topics) expect(topics.get(id)!.status, id).not.toBe('archived');
      expect(Date.parse(signal.occurred_at)).toBeLessThanOrEqual(Date.parse(signal.captured_at));
      expect(new Set(signal.entities).size).toBe(signal.entities.length);
      expect(Object.keys(signal.entity_roles ?? {}).sort()).toEqual([...signal.entities].sort());
      expect(signal).not.toHaveProperty('strength');
    }
    const catalogs = [
      [
        acceptance.registered_entities,
        proposed.entities,
        snapshots.flatMap((item) => item.entities),
      ],
      [acceptance.registered_sources, proposed.sources, snapshots.map((item) => item.source_id)],
      [acceptance.registered_topics, proposed.topics, snapshots.flatMap((item) => item.topics)],
    ] as const;
    for (const [registered, catalog, referenced] of catalogs) {
      expect(new Set(registered).size).toBe(registered.length);
      const known = new Set(catalog.map((entry) => entry.id));
      for (const id of registered) {
        expect(known.has(id), id).toBe(true);
        expect(referenced, id).toContain(id);
      }
    }
  });

  it('preserves all 27 CXMT organizations rather than trimming to the separate manual API limit', async () => {
    const { proposed, revised } = await loadAcceptance();
    const id = 'signal-20260727-cxmt-star-listing';
    const signal = proposed.signals.find((entry) => entry.id === id)!;
    const input = revised.signals.find((entry) => entry.id === id)!;
    const entities = new Map(proposed.entities.map((entity) => [entity.id, entity]));
    expect(signal.entities).toEqual(input.entities);
    expect(signal.entities).toHaveLength(27);
    expect(signal.entity_roles).toEqual(input.entity_roles);
    for (const entityId of signal.entities) {
      expect(['company', 'institution']).toContain(entities.get(entityId)!.type);
      expect(signal.entity_roles![entityId]!.trim().length).toBeGreaterThan(0);
    }
  });
});
