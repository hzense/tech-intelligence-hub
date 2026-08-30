import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../src/seed.js';
import { buildTopicDatabaseProjection, validateTaxonomy } from '../src/taxonomy.js';

function projectionTaxonomy() {
  return validateTaxonomy({
    version: '1.0',
    project: 'HZense',
    root_topics: [
      {
        id: 'topic-zeta',
        name: 'Zeta',
        children: [
          { id: 'topic-watching', name: 'Watching' },
          { id: 'topic-archived', name: 'Archived' },
        ],
      },
      {
        id: 'topic-alpha',
        name: 'Alpha',
        children: [
          { id: 'topic-strategic', name: 'Strategic' },
          { id: 'topic-active', name: 'Active' },
        ],
      },
    ],
    cross_domain_relations: [
      { source: 'topic-active', relation: 'related_to', target: 'topic-watching' },
    ],
  });
}

describe('Topic database projection', () => {
  it('projects the complete real repository authority chain', async () => {
    const seed = await loadSeedCatalog(
      resolve(process.cwd(), '../../data/seed'),
      resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml'),
    );
    const projection = buildTopicDatabaseProjection(seed.taxonomy, seed.topics);

    expect(seed.taxonomy.topics).toHaveLength(62);
    expect(seed.topics).toHaveLength(5);
    expect(projection).toHaveLength(seed.taxonomy.topics.length);
    expect(projection.filter((topic) => topic.runtimeEnabled)).toHaveLength(5);
    expect(new Set(projection.map((topic) => topic.id))).toEqual(seed.taxonomy.topicIds);
  });

  it('projects the complete Taxonomy in deterministic id order with Seed runtime state', () => {
    const projection = buildTopicDatabaseProjection(projectionTaxonomy(), [
      { id: 'topic-strategic', title: 'Strategic', status: 'strategic' },
      { id: 'topic-archived', title: 'Archived', status: 'archived' },
      { id: 'topic-watching', title: 'Watching', status: 'watching' },
      { id: 'topic-active', title: 'Active', status: 'active' },
    ]);

    expect(projection).toEqual([
      {
        id: 'topic-active',
        title: 'Active',
        parentId: 'topic-alpha',
        status: 'active',
        runtimeEnabled: true,
      },
      {
        id: 'topic-alpha',
        title: 'Alpha',
        parentId: null,
        status: 'watching',
        runtimeEnabled: false,
      },
      {
        id: 'topic-archived',
        title: 'Archived',
        parentId: 'topic-zeta',
        status: 'archived',
        runtimeEnabled: false,
      },
      {
        id: 'topic-strategic',
        title: 'Strategic',
        parentId: 'topic-alpha',
        status: 'strategic',
        runtimeEnabled: true,
      },
      {
        id: 'topic-watching',
        title: 'Watching',
        parentId: 'topic-zeta',
        status: 'watching',
        runtimeEnabled: true,
      },
      {
        id: 'topic-zeta',
        title: 'Zeta',
        parentId: null,
        status: 'watching',
        runtimeEnabled: false,
      },
    ]);
  });

  it('rejects duplicate Seed Topic IDs before building the projection', () => {
    expect(() =>
      buildTopicDatabaseProjection(projectionTaxonomy(), [
        { id: 'topic-active', title: 'Active', status: 'active' },
        { id: 'topic-active', title: 'Active', status: 'archived' },
      ]),
    ).toThrow('Duplicate Seed Topic id: topic-active');
  });

  it('applies the existing Seed-to-Taxonomy authority validation', () => {
    const taxonomy = projectionTaxonomy();

    expect(() =>
      buildTopicDatabaseProjection(taxonomy, [
        { id: 'topic-missing', title: 'Missing', status: 'active' },
      ]),
    ).toThrow('Seed Topic topic-missing is not defined in Taxonomy');

    expect(() =>
      buildTopicDatabaseProjection(taxonomy, [
        { id: 'topic-active', title: 'Wrong title', status: 'active' },
      ]),
    ).toThrow(
      'Seed Topic title mismatch for topic-active: expected "Active", received "Wrong title"',
    );
  });
});
