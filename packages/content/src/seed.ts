import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const seedDate = z.iso.date();
const seedDateTime = z.iso.datetime({ offset: true });
const httpsUrl = z.url({ protocol: /^https$/ });

function toUtcDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

const entitySchema = z.object({
  id,
  type: z.enum([
    'person',
    'company',
    'institution',
    'technology',
    'product',
    'model',
    'dataset',
    'standard_protocol',
    'paper',
    'event',
  ]),
  name: z.string().min(1),
  status: z.string().min(1),
});

const sourceSchema = z.object({
  id,
  name: z.string().min(1),
  type: z.enum([
    'website',
    'rss',
    'paper',
    'company_blog',
    'research_lab',
    'news_media',
    'newsletter',
    'github',
    'social',
    'regulator',
    'patent_database',
  ]),
  trust_score: z.number().int().min(0).max(100),
  active: z.boolean(),
  allowed_hosts: z.array(z.hostname()).min(1),
});

const signalSchema = z.object({
  id,
  event_key: id.optional(),
  title: z.string().min(1),
  type: z.enum([
    'research',
    'product',
    'funding',
    'acquisition',
    'hiring',
    'policy',
    'technology',
    'market',
    'people',
    'open_source',
    'security',
    'patent',
    'partnership',
    'regulation',
    'supply_chain',
  ]),
  occurred_at: seedDateTime,
  captured_at: seedDateTime,
  status: z.enum(['inbox', 'reviewed', 'accepted', 'rejected', 'archived']),
  source_id: id,
  source_url: httpsUrl,
  summary: z.string().min(1),
  importance: z.number().int().min(1).max(5),
  strength: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  topics: z.array(id).default([]),
  entities: z.array(id).default([]),
});

const relationSchema = z.object({
  id,
  source: id,
  relation_type: z.string().min(1),
  target: id,
  confidence: z.number().min(0).max(1),
});

const topicSchema = z.object({
  id,
  title: z.string().min(1),
  status: z.enum(['watching', 'active', 'strategic', 'archived']),
});

const radarSchema = z.object({
  id,
  topic: id,
  date: seedDate,
  domain: z.enum(['artificial_intelligence', 'infrastructure', 'security', 'robotics']),
  attention: z.number().int().min(0).max(100),
  trend: z.enum(['rapid_growth', 'growth', 'stable', 'decline', 'rapid_decline']),
  maturity: z.enum(['research', 'early', 'emerging', 'growth', 'mature']),
  strategic_value: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  evidence_signals: z.array(id).min(1),
  reasoning: z.string().trim().min(1),
});

export type SeedEntity = z.infer<typeof entitySchema>;
export type SeedRelation = z.infer<typeof relationSchema>;
export type SeedRadarSnapshot = z.infer<typeof radarSchema>;
export type SeedSignal = z.infer<typeof signalSchema>;
export type SeedSource = z.infer<typeof sourceSchema>;
export type SeedTopic = z.infer<typeof topicSchema>;

export interface SeedCatalog {
  entities: SeedEntity[];
  radar: SeedRadarSnapshot[];
  relations: SeedRelation[];
  signals: SeedSignal[];
  sources: SeedSource[];
  topics: SeedTopic[];
}

async function loadSeedFile<T>(seedRoot: string, name: string, schema: z.ZodType<T>): Promise<T[]> {
  const input: unknown = parse(await readFile(join(seedRoot, name), 'utf8'));
  return z.array(schema).parse(input);
}

export function validateSeedCatalog(catalog: SeedCatalog): SeedCatalog {
  const ids = new Set<string>();
  const entries = [
    ...catalog.topics,
    ...catalog.entities,
    ...catalog.sources,
    ...catalog.relations,
    ...catalog.signals,
    ...catalog.radar,
  ];

  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate id: ${entry.id}`);
    ids.add(entry.id);
  }

  const topicIds = new Set(catalog.topics.map((topic) => topic.id));
  const entityIds = new Set(catalog.entities.map((entity) => entity.id));
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));
  const signalById = new Map(catalog.signals.map((signal) => [signal.id, signal]));
  const radarTopicDates = new Set<string>();

  for (const snapshot of catalog.radar) {
    if (!topicIds.has(snapshot.topic)) {
      throw new Error(`Unknown topic ${snapshot.topic} in ${snapshot.id}`);
    }
    const topicDate = `${snapshot.topic}:${snapshot.date}`;
    if (radarTopicDates.has(topicDate)) {
      throw new Error(`Duplicate Radar topic/date: ${topicDate}`);
    }
    radarTopicDates.add(topicDate);

    const evidenceIds = new Set<string>();
    for (const signalId of snapshot.evidence_signals) {
      if (evidenceIds.has(signalId)) {
        throw new Error(`Duplicate Radar evidence signal ${signalId} in ${snapshot.id}`);
      }
      evidenceIds.add(signalId);

      const signal = signalById.get(signalId);
      if (!signal) {
        throw new Error(`Unknown Radar evidence signal ${signalId} in ${snapshot.id}`);
      }
      if (signal.status !== 'reviewed' && signal.status !== 'accepted') {
        throw new Error(`Ineligible Radar evidence signal ${signalId} in ${snapshot.id}`);
      }
      if (!signal.topics.includes(snapshot.topic)) {
        throw new Error(
          `Radar evidence signal ${signalId} does not reference ${snapshot.topic} in ${snapshot.id}`,
        );
      }
      if (toUtcDate(signal.occurred_at) > snapshot.date) {
        throw new Error(`Future Radar evidence occurrence ${signalId} in ${snapshot.id}`);
      }
      if (toUtcDate(signal.captured_at) > snapshot.date) {
        throw new Error(`Future Radar evidence capture ${signalId} in ${snapshot.id}`);
      }
    }
  }

  for (const relation of catalog.relations) {
    if (!entityIds.has(relation.source) || !entityIds.has(relation.target)) {
      throw new Error(`Broken relation: ${relation.id}`);
    }
  }

  for (const signal of catalog.signals) {
    const source = sourceById.get(signal.source_id);
    if (!source) {
      throw new Error(`Unknown source: ${signal.id}`);
    }
    const sourceHostname = new URL(signal.source_url).hostname.toLowerCase();
    if (
      !source.allowed_hosts.some(
        (allowedHost) =>
          sourceHostname === allowedHost || sourceHostname.endsWith(`.${allowedHost}`),
      )
    ) {
      throw new Error(`Unexpected source URL host ${sourceHostname} in ${signal.id}`);
    }
    for (const topic of signal.topics) {
      if (!topicIds.has(topic)) throw new Error(`Unknown topic ${topic} in ${signal.id}`);
    }
    for (const entity of signal.entities) {
      if (!entityIds.has(entity)) throw new Error(`Unknown entity ${entity} in ${signal.id}`);
    }
  }

  return catalog;
}

export async function loadSeedCatalog(seedRoot: string): Promise<SeedCatalog> {
  const [entities, radar, relations, signals, sources, topics] = await Promise.all([
    loadSeedFile(seedRoot, 'entities.yaml', entitySchema),
    loadSeedFile(seedRoot, 'radar.yaml', radarSchema),
    loadSeedFile(seedRoot, 'relations.yaml', relationSchema),
    loadSeedFile(seedRoot, 'signals.yaml', signalSchema),
    loadSeedFile(seedRoot, 'sources.yaml', sourceSchema),
    loadSeedFile(seedRoot, 'topics.yaml', topicSchema),
  ]);
  return validateSeedCatalog({ entities, radar, relations, signals, sources, topics });
}
