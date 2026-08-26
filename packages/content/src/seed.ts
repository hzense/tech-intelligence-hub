import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const seedDateTime = z.iso.datetime({ offset: true });

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
});

const signalSchema = z.object({
  id,
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

export type SeedEntity = z.infer<typeof entitySchema>;
export type SeedRelation = z.infer<typeof relationSchema>;
export type SeedSignal = z.infer<typeof signalSchema>;
export type SeedSource = z.infer<typeof sourceSchema>;
export type SeedTopic = z.infer<typeof topicSchema>;

export interface SeedCatalog {
  entities: SeedEntity[];
  relations: SeedRelation[];
  signals: SeedSignal[];
  sources: SeedSource[];
  topics: SeedTopic[];
}

async function loadSeedFile<T>(
  seedRoot: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const input: unknown = parse(await readFile(join(seedRoot, name), 'utf8'));
  return z.array(schema).parse(input);
}

export async function loadSeedCatalog(seedRoot: string): Promise<SeedCatalog> {
  const [entities, relations, signals, sources, topics] = await Promise.all([
    loadSeedFile(seedRoot, 'entities.yaml', entitySchema),
    loadSeedFile(seedRoot, 'relations.yaml', relationSchema),
    loadSeedFile(seedRoot, 'signals.yaml', signalSchema),
    loadSeedFile(seedRoot, 'sources.yaml', sourceSchema),
    loadSeedFile(seedRoot, 'topics.yaml', topicSchema),
  ]);
  return { entities, relations, signals, sources, topics };
}
