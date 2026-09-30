import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSeedCatalog, type SeedCatalog, type SeedSignal } from '../src/seed.js';

const root = new URL('../../../', import.meta.url);
const originalBatch = new URL('insights/2026-09-29-daily-signal-review/', root);
const completionBatch = new URL('insights/2026-09-29-pending-signal-completion/', root);
const bundleNames = ['july-august-candidates.yaml', 'september-candidates.yaml'] as const;
const expectedIds = [
  'signal-20260727-cxmt-star-listing',
  'signal-20260819-unitree-star-listing',
  'signal-20260908-us-agencies-ai-distillation-advisory',
  'signal-20260917-anthropic-rd-automation-index',
  'signal-20260920-openai-agent-dns-egress',
];
const allowedChangedFields = new Set(['title', 'summary', 'type', 'entities', 'entity_roles']);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const signalDigest = (signal: SeedSignal) => digest(JSON.stringify(signal));

interface Bundle {
  signals: SeedCatalog['signals'];
  entities: SeedCatalog['entities'];
  sources: SeedCatalog['sources'];
}

interface Completion {
  schema: string;
  rules_file: string;
  rules_sha256: string;
  status: string;
  publication_authorized: boolean;
  formal_seed_changed: boolean;
  revisions: {
    signal_id: string;
    original_bundle: string;
    original_sha256: string;
    revised_sha256: string;
    changed_fields: string[];
    content_review_status: string;
    event_date_basis: string;
    limitations: string;
    evidence: { url: string; locator: string; published_on: string | null; claim: string }[];
    resolved_items: string[];
  }[];
  financing_details: {
    signal_id: string;
    source_url: string;
    locator: string;
    organizations: {
      entity_id: string;
      legal_name: string;
      role: string;
      identity_evidence?: {
        url: string;
        locator: string;
        published_on: string | null;
        claim: string;
      }[];
    }[];
    investment_vehicles: {
      name: string;
      kind: string;
      related_entity_id?: string;
      role: string;
    }[];
  }[];
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

async function loadCompletion() {
  // These frozen inputs, not today's production Seed, define the review archive.
  const context = parse(
    await readFile(new URL('catalog-context.yaml', originalBatch), 'utf8'),
  ) as Pick<SeedCatalog, 'entities' | 'sources' | 'topics'>;
  const originals = await Promise.all(
    bundleNames.map(async (name) => ({
      name,
      bundle: parse(await readFile(new URL(name, originalBatch), 'utf8')) as Bundle,
    })),
  );
  const revised = parse(
    await readFile(new URL('signals.candidates.yaml', completionBatch), 'utf8'),
  ) as Bundle;
  const manifest = JSON.parse(
    await readFile(new URL('completion.json', completionBatch), 'utf8'),
  ) as Completion;
  const proposed = parseSeedCatalog({
    signals: revised.signals,
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
  return { originals, revised, manifest, proposed };
}

describe('2026-09-29 pending Signal completion archive', () => {
  it('revises exactly the five requested candidates without authorizing publication', async () => {
    const { manifest, revised } = await loadCompletion();
    expect(manifest.schema).toBe('hzense-pending-signal-completion-v1');
    expect(manifest.status).toBe('awaiting_admin_confirmation');
    expect(manifest.publication_authorized).toBe(false);
    expect(manifest.formal_seed_changed).toBe(false);
    expect(revised.signals.map((signal) => signal.id).sort()).toEqual([...expectedIds].sort());
    expect(manifest.revisions.map((revision) => revision.signal_id).sort()).toEqual(
      [...expectedIds].sort(),
    );
    for (const revision of manifest.revisions) {
      expect(revision.content_review_status).toBe('ready_for_confirmation');
    }
    for (const signal of revised.signals) expect(signal.status).toBe('inbox');
    const publication = JSON.parse(
      await readFile(new URL('publication.json', originalBatch), 'utf8'),
    ) as { accepted: { signal_id: string }[]; deferred: { signal_id: string }[] };
    for (const id of expectedIds) {
      expect(publication.deferred.map((entry) => entry.signal_id)).toContain(id);
      expect(publication.accepted.map((entry) => entry.signal_id)).not.toContain(id);
    }
  });

  it('pins the rule document and both versions while preserving dates, identity and scores', async () => {
    const { manifest, revised, originals } = await loadCompletion();
    expect(manifest.rules_file).toBe('insights/2026-09-29-signal-type-rules/design-doc.md');
    expect(digest(await readFile(new URL(manifest.rules_file, root)))).toBe(manifest.rules_sha256);
    for (const revision of manifest.revisions) {
      const originalBundle = originals.find(({ name }) => name === revision.original_bundle);
      expect(originalBundle, revision.signal_id).toBeDefined();
      const original = originalBundle!.bundle.signals.find(
        (signal) => signal.id === revision.signal_id,
      );
      const updated = revised.signals.find((signal) => signal.id === revision.signal_id);
      expect(original, revision.signal_id).toBeDefined();
      expect(updated, revision.signal_id).toBeDefined();
      expect(signalDigest(original!)).toBe(revision.original_sha256);
      expect(signalDigest(updated!)).toBe(revision.revised_sha256);
      expect(revision.revised_sha256).not.toBe(revision.original_sha256);
      const allKeys = new Set([...Object.keys(original!), ...Object.keys(updated!)]);
      const actualChanges = [...allKeys].filter(
        (key) =>
          JSON.stringify(original![key as keyof SeedSignal]) !==
          JSON.stringify(updated![key as keyof SeedSignal]),
      );
      expect([...revision.changed_fields].sort()).toEqual(actualChanges.sort());
      expect(actualChanges.length).toBeGreaterThan(0);
      for (const key of actualChanges) expect(allowedChangedFields.has(key), key).toBe(true);
    }
  });

  it('keeps strict Signal contracts, canonical topics and explicit entity roles', async () => {
    const { revised, proposed } = await loadCompletion();
    const topics = new Map(proposed.topics.map((topic) => [topic.id, topic]));
    expect(proposed.signals).toHaveLength(5);
    expect(new Set(proposed.signals.map((signal) => signal.event_key)).size).toBe(5);
    expect(proposed.signals).toEqual(revised.signals);
    for (const signal of proposed.signals) {
      expect(typeof signal.type).toBe('string'); // The strict parser checks all 15 allowed types.
      expect([...signal.title].length).toBeLessThanOrEqual(80);
      expect([...signal.summary].length).toBeLessThanOrEqual(500);
      expect(signal.topics.length).toBeGreaterThanOrEqual(1);
      expect(signal.topics.length).toBeLessThanOrEqual(5);
      expect(new Set(signal.topics).size).toBe(signal.topics.length);
      for (const topicId of signal.topics) {
        expect(topics.has(topicId), topicId).toBe(true);
        expect(topics.get(topicId)!.status, topicId).not.toBe('archived');
      }
      expect(Date.parse(signal.occurred_at)).toBeLessThanOrEqual(Date.parse(signal.captured_at));
      expect(new Set(signal.entities).size).toBe(signal.entities.length);
      expect(Object.keys(signal.entity_roles ?? {}).sort()).toEqual([...signal.entities].sort());
      for (const id of signal.entities) {
        expect(signal.entity_roles![id]!.trim().length, `${signal.id}: ${id}`).toBeGreaterThan(0);
      }
      expect(signal).not.toHaveProperty('strength');
    }
  });

  it('records source-level evidence, event date basis and remaining limitations for every correction', async () => {
    const { manifest } = await loadCompletion();
    for (const revision of manifest.revisions) {
      expect(revision.event_date_basis.trim().length).toBeGreaterThan(0);
      expect(revision.limitations.trim().length).toBeGreaterThan(0);
      expect(revision.resolved_items.length).toBeGreaterThan(0);
      expect(revision.resolved_items.every((item) => item.trim().length > 0)).toBe(true);
      expect(revision.evidence.length).toBeGreaterThan(0);
      for (const evidence of revision.evidence) {
        const url = new URL(evidence.url);
        expect(url.protocol).toBe('https:');
        expect(url.username).toBe('');
        expect(url.password).toBe('');
        expect(evidence.locator.trim().length).toBeGreaterThan(0);
        expect(evidence.claim.trim().length).toBeGreaterThan(0);
        // A URL date, article update date or listing date is not automatically
        // the evidence's publication date; its locator records that distinction.
        if (evidence.published_on !== null) {
          expect(evidence.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isNaN(Date.parse(evidence.published_on))).toBe(false);
        }
      }
    }
  });

  it('maps financing organizations completely without inventing people from investment vehicles', async () => {
    const { manifest, proposed, originals } = await loadCompletion();
    const entities = new Map(proposed.entities.map((entity) => [entity.id, entity]));
    expect(manifest.financing_details.map((detail) => detail.signal_id).sort()).toEqual(
      expectedIds.slice(0, 2).sort(),
    );
    for (const detail of manifest.financing_details) {
      const signal = proposed.signals.find((entry) => entry.id === detail.signal_id)!;
      expect(signal.type).toBe('funding');
      expect(new URL(detail.source_url).protocol).toBe('https:');
      expect(detail.locator.trim().length).toBeGreaterThan(0);
      const organizations = signal.entities.filter((id) =>
        ['company', 'institution'].includes(entities.get(id)!.type),
      );
      const original = originals
        .flatMap(({ bundle }) => bundle.signals)
        .find((entry) => entry.id === signal.id)!;
      // The original financing candidates contain only their respective issuers.
      // The companion roster lists the newly disclosed investment organizations,
      // not the issuer or individual investment vehicles.
      expect(detail.organizations.map((entry) => entry.entity_id).sort()).toEqual(
        organizations.filter((id) => !original.entities.includes(id)).sort(),
      );
      expect(detail.organizations.length).toBeGreaterThan(1);
      for (const organization of detail.organizations) {
        const entity = entities.get(organization.entity_id)!;
        expect(['company', 'institution']).toContain(entity.type);
        // A preserved display name can differ from the filing's full legal name.
        expect(organization.legal_name.trim().length).toBeGreaterThan(0);
        expect(organization.role).toBe(signal.entity_roles![organization.entity_id]);
        if (entity.name !== organization.legal_name) {
          expect(
            organization.identity_evidence?.length ?? 0,
            organization.entity_id,
          ).toBeGreaterThan(0);
        }
        for (const evidence of organization.identity_evidence ?? []) {
          expect(new URL(evidence.url).protocol).toBe('https:');
          expect(evidence.locator.trim().length).toBeGreaterThan(0);
          expect(evidence.claim.trim().length).toBeGreaterThan(0);
          if (evidence.published_on !== null) {
            expect(evidence.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Number.isNaN(Date.parse(evidence.published_on))).toBe(false);
          }
        }
      }
      expect(detail.investment_vehicles.length).toBeGreaterThan(0);
      expect(new Set(detail.investment_vehicles.map((vehicle) => vehicle.name)).size).toBe(
        detail.investment_vehicles.length,
      );
      for (const vehicle of detail.investment_vehicles) {
        expect(vehicle.name.trim().length).toBeGreaterThan(0);
        expect(vehicle.kind.trim().length).toBeGreaterThan(0);
        expect(vehicle.role.trim().length).toBeGreaterThan(0);
        const matchingPerson = proposed.entities.find(
          (entity) => entity.name === vehicle.name && entity.type === 'person',
        );
        expect(matchingPerson, vehicle.name).toBeUndefined();
        if (vehicle.related_entity_id) {
          const related = entities.get(vehicle.related_entity_id);
          expect(related, vehicle.related_entity_id).toBeDefined();
          expect(['company', 'institution']).toContain(related!.type);
          expect(organizations).toContain(vehicle.related_entity_id);
        }
      }
    }
  });

  it('fixes the named authors, security classification and bounded incident timeline', async () => {
    const { proposed } = await loadCompletion();
    const entities = new Map(proposed.entities.map((entity) => [entity.id, entity]));
    const byId = new Map(proposed.signals.map((signal) => [signal.id, signal]));
    const research = byId.get('signal-20260917-anthropic-rd-automation-index')!;
    expect(research.type).toBe('research');
    for (const authorId of ['person-marina-favaro', 'person-phillie-wright']) {
      expect(research.entities).toContain(authorId);
      expect(entities.get(authorId)!.type).toBe('person');
      expect(research.entity_roles![authorId]).toMatch(/作者/);
    }
    expect(research.summary).toMatch(/26\s*%/);
    expect(research.summary).toMatch(/7\s*月|七月|July/);
    expect(research.summary).toMatch(/AL4/);
    const advisory = byId.get('signal-20260908-us-agencies-ai-distillation-advisory')!;
    expect(advisory.type).toBe('security');
    expect(advisory.summary).toMatch(/称|指控/);
    const incident = byId.get('signal-20260920-openai-agent-dns-egress')!;
    expect(incident.type).toBe('security');
    expect(incident.summary).toMatch(/9\s*月\s*25\s*日|09-25|9\/25/);
    expect(incident.summary).toMatch(/人工确认/);
  });
});
