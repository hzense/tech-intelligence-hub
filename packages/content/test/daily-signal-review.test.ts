import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSeedCatalog, type SeedCatalog, type SeedSignal } from '../src/seed.js';

const root = new URL('../../../', import.meta.url);
const batch = new URL('insights/2026-09-29-daily-signal-review/', root);
const readYaml = async (name: string) => parse(await readFile(new URL(name, batch), 'utf8'));

interface Review {
  signal_id: string;
  local_refs: string[];
  evidence_urls: string[];
  date_basis: string;
  limitations: string;
  scores_reason: string;
  readiness: { missing_person: boolean; missing_organization: boolean; publishable_now: boolean };
}
interface Bundle {
  signals: SeedCatalog['signals'];
  entities: SeedCatalog['entities'];
  sources: SeedCatalog['sources'];
  reviews: Review[];
}
interface ManifestFile {
  file: string;
  sha256: string;
  bytes: number;
  lines: number;
}

function mergeById<T extends { id: string }>(groups: T[][]): T[] {
  const items = new Map<string, T>();
  for (const group of groups) {
    for (const item of group) {
      const existing = items.get(item.id);
      if (existing) expect(item, `Conflicting catalog identity ${item.id}`).toEqual(existing);
      else items.set(item.id, item);
    }
  }
  return [...items.values()];
}

async function loadBatch() {
  // Frozen references let candidates be promoted and live records corrected later.
  // Archive tests must not lock the current production catalog to this review date.
  const context = (await readYaml('catalog-context.yaml')) as Pick<
    SeedCatalog,
    'entities' | 'sources' | 'topics'
  >;
  const bundles = await Promise.all(
    ['july-august-candidates.yaml', 'september-candidates.yaml'].map(
      async (name) => (await readYaml(name)) as Bundle,
    ),
  );
  const signals = bundles.flatMap((bundle) => bundle.signals);
  const reviews = bundles.flatMap((bundle) => bundle.reviews);
  // Candidate-only registrations never write to the live Seed or a database.
  const proposed = parseSeedCatalog({
    signals,
    entities: mergeById([context.entities, ...bundles.map((bundle) => bundle.entities)]),
    sources: mergeById([context.sources, ...bundles.map((bundle) => bundle.sources)]),
    topics: context.topics,
    relations: [],
    radar: [],
  });
  return { signals, reviews, proposed };
}

describe('2026-09-29 daily document Signal review', () => {
  it('records confirmation of exactly the 28 complete candidates without changing the research snapshot', async () => {
    const { signals, reviews } = await loadBatch();
    const publication = JSON.parse(await readFile(new URL('publication.json', batch), 'utf8')) as {
      accepted_count: number;
      deferred_count: number;
      accepted: { signal_id: string; event_key: string; accepted_snapshot_sha256: string }[];
      deferred: { signal_id: string; reason: string }[];
    };
    const readyIds = reviews
      .filter(
        (review) => !review.readiness.missing_person && !review.readiness.missing_organization,
      )
      .map((review) => review.signal_id)
      .sort();
    const acceptedIds = publication.accepted.map((entry) => entry.signal_id).sort();
    expect(acceptedIds).toEqual(readyIds);
    expect(acceptedIds).toHaveLength(28);
    expect(publication.accepted_count).toBe(28);
    expect(publication.deferred_count).toBe(11);
    expect(publication.deferred.map((entry) => entry.signal_id).sort()).toEqual(
      signals
        .filter((signal) => !acceptedIds.includes(signal.id))
        .map((signal) => signal.id)
        .sort(),
    );
    for (const accepted of publication.accepted) {
      const original = signals.find((signal) => signal.id === accepted.signal_id)!;
      expect(original.status).toBe('inbox');
      expect(accepted.event_key).toBe(original.event_key);
      expect(original.topics.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(original.occurred_at))).toBe(false);
      const digest = createHash('sha256')
        .update(JSON.stringify({ ...original, status: 'accepted' }))
        .digest('hex');
      expect(accepted.accepted_snapshot_sha256).toBe(digest);
    }
    for (const deferred of publication.deferred) {
      const review = reviews.find((entry) => entry.signal_id === deferred.signal_id)!;
      expect(deferred.reason).toBe(
        review.readiness.missing_person ? 'missing_person' : 'missing_organization',
      );
    }
  });

  it('records all 67 input fingerprints without depending on private local files in CI', async () => {
    const manifest = JSON.parse(await readFile(new URL('input-manifest.json', batch), 'utf8')) as {
      files: ManifestFile[];
      file_count: number;
      total_bytes: number;
      total_lines: number;
      unsupported_files: string[];
    };
    expect(manifest.file_count).toBe(67);
    expect(manifest.files).toHaveLength(manifest.file_count);
    expect(new Set(manifest.files.map((file) => file.file)).size).toBe(manifest.file_count);
    expect(manifest.files.reduce((sum, file) => sum + file.bytes, 0)).toBe(manifest.total_bytes);
    expect(manifest.files.reduce((sum, file) => sum + file.lines, 0)).toBe(manifest.total_lines);
    expect(manifest.unsupported_files).toEqual([]);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.lines).toBeGreaterThan(0);
    }
  });

  it('records a canonical topic decision for every Signal in the captured baseline', async () => {
    const { proposed } = await loadBatch();
    const before = JSON.parse(
      await readFile(new URL('existing-before.json', batch), 'utf8'),
    ) as SeedSignal[];
    const classifications = (await readYaml('classifications.yaml')) as Record<string, string[]>;
    const topicIds = new Set(proposed.topics.map((topic) => topic.id));
    expect(before).toHaveLength(71);
    expect(Object.keys(classifications).sort()).toEqual(before.map((signal) => signal.id).sort());
    for (const old of before) {
      const topics = classifications[old.id]!;
      expect(typeof old.type).toBe('string');
      expect(topics.length).toBeGreaterThan(0);
      expect(new Set(topics).size).toBe(topics.length);
      for (const id of topics) expect(topicIds.has(id)).toBe(true);
    }
  });

  it('keeps candidate contracts valid, bounded and private with full evidence and date provenance', async () => {
    const { signals, reviews, proposed } = await loadBatch();
    const before = JSON.parse(
      await readFile(new URL('existing-before.json', batch), 'utf8'),
    ) as SeedSignal[];
    const manifest = JSON.parse(await readFile(new URL('input-manifest.json', batch), 'utf8')) as {
      files: ManifestFile[];
    };
    const files = new Map(manifest.files.map((file) => [file.file, file]));
    const entities = new Map(proposed.entities.map((entity) => [entity.id, entity]));
    expect(signals.length).toBeGreaterThan(0);
    expect(reviews.map((review) => review.signal_id).sort()).toEqual(
      signals.map((signal) => signal.id).sort(),
    );
    expect(new Set(proposed.signals.map((signal) => signal.event_key)).size).toBe(
      proposed.signals.length,
    );
    for (const signal of signals) {
      expect(before.some((existing) => existing.id === signal.id)).toBe(false);
      expect(signal.status).toBe('inbox');
      expect(typeof signal.type).toBe('string');
      expect([...signal.title].length).toBeLessThanOrEqual(80);
      expect([...signal.summary].length).toBeLessThanOrEqual(500);
      expect(signal.title).not.toContain('SemiAnalysis');
      expect(signal).not.toHaveProperty('strength');
      expect(signal.topics.length).toBeGreaterThan(0);
      expect(new Set(signal.topics).size).toBe(signal.topics.length);
      expect(new Set(signal.entities).size).toBe(signal.entities.length);
      expect(Date.parse(signal.occurred_at)).toBeLessThanOrEqual(Date.parse(signal.captured_at));
      expect(signal.occurred_at).toMatch(/^2026-\d{2}-\d{2}T00:00:00Z$/);
      expect(signal.entities).not.toContain('company-semianalysis');
      for (const id of signal.entities) {
        if (['person', 'company', 'institution'].includes(entities.get(id)!.type)) {
          expect(signal.entity_roles?.[id]?.trim().length, `${signal.id}: ${id}`).toBeGreaterThan(
            0,
          );
        }
      }
      const review = reviews.find((entry) => entry.signal_id === signal.id)!;
      expect(review.evidence_urls).toContain(signal.source_url);
      expect(review.local_refs.length).toBeGreaterThan(0);
      for (const ref of review.local_refs) {
        const [file, line] = ref.split(':');
        expect(files.has(file!), ref).toBe(true);
        expect(Number(line), ref).toBeGreaterThan(0);
        expect(Number(line), ref).toBeLessThanOrEqual(files.get(file!)!.lines);
      }
      for (const key of ['date_basis', 'limitations', 'scores_reason'] as const) {
        expect(review[key]?.trim().length, `${signal.id}: ${key}`).toBeGreaterThan(0);
      }
      expect(review.readiness.publishable_now).toBe(false);
      expect(review.readiness.missing_person).toBe(
        !signal.entities.some((id) => entities.get(id)!.type === 'person'),
      );
      expect(review.readiness.missing_organization).toBe(
        !signal.entities.some((id) => ['company', 'institution'].includes(entities.get(id)!.type)),
      );
    }
  });
});
