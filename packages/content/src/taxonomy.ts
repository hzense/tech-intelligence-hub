import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import type { ContentDocument } from './references.js';

const topicId = z.string().regex(/^topic-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const taxonomyRelationType = z.enum(['related_to']);

export interface TaxonomyNode {
  id: string;
  name: string;
  children?: TaxonomyNode[] | undefined;
}

export interface TaxonomyCrossDomainRelation {
  source: string;
  relation: z.infer<typeof taxonomyRelationType>;
  target: string;
}

export interface TaxonomyDocument {
  version: '1.0';
  project: 'HZense';
  root_topics: TaxonomyNode[];
  cross_domain_relations: TaxonomyCrossDomainRelation[];
}

export interface TaxonomyTopic {
  id: string;
  name: string;
  parentId: string | null;
}

export interface TaxonomyCatalog {
  version: TaxonomyDocument['version'];
  project: TaxonomyDocument['project'];
  topics: readonly TaxonomyTopic[];
  crossDomainRelations: readonly TaxonomyCrossDomainRelation[];
  topicIds: ReadonlySet<string>;
  topicById: ReadonlyMap<string, TaxonomyTopic>;
}

export type TopicProjectionStatus = 'watching' | 'active' | 'strategic' | 'archived';

export interface TopicDatabaseProjection {
  id: string;
  title: string;
  parentId: string | null;
  status: TopicProjectionStatus;
  runtimeEnabled: boolean;
}

interface SeedTopicProjection {
  id: string;
  title: string;
  status: TopicProjectionStatus;
}

const taxonomyNodeSchema: z.ZodType<TaxonomyNode> = z.lazy(() =>
  z
    .object({
      id: topicId,
      name: z.string().trim().min(1),
      children: z.array(taxonomyNodeSchema).min(1).optional(),
    })
    .strict(),
);

const taxonomyRelationSchema: z.ZodType<TaxonomyCrossDomainRelation> = z
  .object({
    source: topicId,
    relation: taxonomyRelationType,
    target: topicId,
  })
  .strict();

const taxonomyDocumentSchema: z.ZodType<TaxonomyDocument> = z
  .object({
    version: z.literal('1.0'),
    project: z.literal('HZense'),
    root_topics: z.array(taxonomyNodeSchema).min(1),
    cross_domain_relations: z.array(taxonomyRelationSchema),
  })
  .strict();

export function validateTaxonomy(input: unknown): TaxonomyCatalog {
  const document = taxonomyDocumentSchema.parse(input);
  const topics: TaxonomyTopic[] = [];
  const topicById = new Map<string, TaxonomyTopic>();

  const visit = (node: TaxonomyNode, parentId: string | null) => {
    if (topicById.has(node.id)) {
      throw new Error(`Duplicate Taxonomy Topic id: ${node.id}`);
    }

    const topic = { id: node.id, name: node.name, parentId };
    topics.push(topic);
    topicById.set(topic.id, topic);
    for (const child of node.children ?? []) visit(child, topic.id);
  };

  for (const rootTopic of document.root_topics) visit(rootTopic, null);

  const relationKeys = new Set<string>();
  for (const relation of document.cross_domain_relations) {
    if (!topicById.has(relation.source)) {
      throw new Error(
        `Unknown Taxonomy relation source ${relation.source} in ${relation.source} ${relation.relation} ${relation.target}`,
      );
    }
    if (!topicById.has(relation.target)) {
      throw new Error(
        `Unknown Taxonomy relation target ${relation.target} in ${relation.source} ${relation.relation} ${relation.target}`,
      );
    }
    if (relation.source === relation.target) {
      throw new Error(
        `Self-referencing Taxonomy relation: ${relation.source} ${relation.relation}`,
      );
    }

    const relationKey = `${relation.source}\0${relation.relation}\0${relation.target}`;
    if (relationKeys.has(relationKey)) {
      throw new Error(
        `Duplicate Taxonomy relation: ${relation.source} ${relation.relation} ${relation.target}`,
      );
    }
    relationKeys.add(relationKey);
  }

  return {
    version: document.version,
    project: document.project,
    topics,
    crossDomainRelations: document.cross_domain_relations,
    topicIds: new Set(topicById.keys()),
    topicById,
  };
}

export async function loadTaxonomy(taxonomyFile: string): Promise<TaxonomyCatalog> {
  const input: unknown = parse(await readFile(taxonomyFile, 'utf8'));
  return validateTaxonomy(input);
}

export function validateSeedTopicProjection(
  seedTopics: readonly SeedTopicProjection[],
  taxonomy: TaxonomyCatalog,
): void {
  const seedTopicIds = new Set<string>();

  for (const seedTopic of seedTopics) {
    if (seedTopicIds.has(seedTopic.id)) {
      throw new Error(`Duplicate Seed Topic id: ${seedTopic.id}`);
    }
    seedTopicIds.add(seedTopic.id);

    const taxonomyTopic = taxonomy.topicById.get(seedTopic.id);
    if (!taxonomyTopic) {
      throw new Error(`Seed Topic ${seedTopic.id} is not defined in Taxonomy`);
    }
    if (seedTopic.title !== taxonomyTopic.name) {
      throw new Error(
        `Seed Topic title mismatch for ${seedTopic.id}: expected "${taxonomyTopic.name}", received "${seedTopic.title}"`,
      );
    }
  }
}

export function buildTopicDatabaseProjection(
  taxonomy: TaxonomyCatalog,
  seedTopics: readonly SeedTopicProjection[],
): TopicDatabaseProjection[] {
  validateSeedTopicProjection(seedTopics, taxonomy);
  const seedTopicById = new Map(seedTopics.map((topic) => [topic.id, topic]));

  return taxonomy.topics
    .map((taxonomyTopic): TopicDatabaseProjection => {
      const seedTopic = seedTopicById.get(taxonomyTopic.id);

      return {
        id: taxonomyTopic.id,
        title: taxonomyTopic.name,
        parentId: taxonomyTopic.parentId,
        status: seedTopic?.status ?? 'watching',
        runtimeEnabled: seedTopic !== undefined && seedTopic.status !== 'archived',
      };
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function validateTopicContentProjection(
  documents: readonly ContentDocument[],
  seedTopics: readonly SeedTopicProjection[],
  taxonomy: TaxonomyCatalog,
): void {
  const seedTopicById = new Map(seedTopics.map((topic) => [topic.id, topic]));
  const contentTopicCounts = new Map<string, number>();

  for (const document of documents) {
    if (document.frontMatter.type !== 'topic') continue;

    if (!/^topics[\\/].+\.mdx?$/.test(document.file)) {
      throw new Error(`${document.file}: Topic content must be stored under content/topics/`);
    }

    const { id, parent, status } = document.frontMatter;
    contentTopicCounts.set(id, (contentTopicCounts.get(id) ?? 0) + 1);

    const seedTopic = seedTopicById.get(id);
    if (!seedTopic) {
      throw new Error(`${document.file}: Topic ${id} is not enabled in data/seed/topics.yaml`);
    }
    if (status !== seedTopic.status) {
      throw new Error(
        `${document.file}: Topic ${id} status mismatch; expected "${seedTopic.status}", received "${status}"`,
      );
    }

    if (parent !== undefined) {
      const expectedParent = taxonomy.topicById.get(id)?.parentId ?? null;
      if (parent !== expectedParent) {
        throw new Error(
          `${document.file}: Topic ${id} parent mismatch; expected "${expectedParent ?? 'root'}", received "${parent}"`,
        );
      }
    }
  }

  for (const seedTopic of seedTopics) {
    const contentCount = contentTopicCounts.get(seedTopic.id) ?? 0;
    if (seedTopic.status !== 'archived' && contentCount === 0) {
      throw new Error(`Enabled Seed Topic ${seedTopic.id} has no content/topics page`);
    }
    if (contentCount > 1) {
      throw new Error(`Seed Topic ${seedTopic.id} has ${contentCount} content/topics pages`);
    }
  }
}
