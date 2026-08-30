import { describe, expect, it } from 'vitest';
import { validateFrontMatter } from '../src/schema.js';
import { validateTaxonomy, validateTopicContentProjection } from '../src/taxonomy.js';

function taxonomy(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    project: 'HZense',
    root_topics: [
      {
        id: 'topic-ai',
        name: 'Artificial Intelligence',
        children: [{ id: 'topic-models', name: 'Models' }],
      },
      { id: 'topic-security', name: 'Security' },
    ],
    cross_domain_relations: [
      { source: 'topic-models', relation: 'related_to', target: 'topic-security' },
    ],
    ...overrides,
  };
}

describe('Taxonomy validation', () => {
  it('flattens the hierarchy with canonical names and primary parents', () => {
    const catalog = validateTaxonomy(taxonomy());

    expect(catalog.topics).toEqual([
      { id: 'topic-ai', name: 'Artificial Intelligence', parentId: null },
      { id: 'topic-models', name: 'Models', parentId: 'topic-ai' },
      { id: 'topic-security', name: 'Security', parentId: null },
    ]);
    expect(catalog.crossDomainRelations).toEqual([
      { source: 'topic-models', relation: 'related_to', target: 'topic-security' },
    ]);
  });

  it('rejects a Topic ID that appears in multiple branches', () => {
    expect(() =>
      validateTaxonomy(
        taxonomy({
          root_topics: [
            {
              id: 'topic-ai',
              name: 'Artificial Intelligence',
              children: [{ id: 'topic-shared', name: 'Shared' }],
            },
            {
              id: 'topic-security',
              name: 'Security',
              children: [{ id: 'topic-shared', name: 'Shared elsewhere' }],
            },
          ],
          cross_domain_relations: [],
        }),
      ),
    ).toThrow('Duplicate Taxonomy Topic id: topic-shared');
  });

  it('rejects malformed Topic nodes and unsupported relation types', () => {
    expect(() =>
      validateTaxonomy(
        taxonomy({
          root_topics: [{ id: 'artificial-intelligence', name: 'Artificial Intelligence' }],
          cross_domain_relations: [],
        }),
      ),
    ).toThrow();
    expect(() =>
      validateTaxonomy(
        taxonomy({
          root_topics: [{ id: 'topic-ai', name: '   ' }],
          cross_domain_relations: [],
        }),
      ),
    ).toThrow();
    expect(() =>
      validateTaxonomy(
        taxonomy({
          cross_domain_relations: [
            { source: 'topic-models', relation: 'parent_of', target: 'topic-security' },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects missing and self-referencing cross-domain relation endpoints', () => {
    expect(() =>
      validateTaxonomy(
        taxonomy({
          cross_domain_relations: [
            { source: 'topic-missing', relation: 'related_to', target: 'topic-security' },
          ],
        }),
      ),
    ).toThrow('Unknown Taxonomy relation source topic-missing');

    expect(() =>
      validateTaxonomy(
        taxonomy({
          cross_domain_relations: [
            { source: 'topic-models', relation: 'related_to', target: 'topic-missing' },
          ],
        }),
      ),
    ).toThrow('Unknown Taxonomy relation target topic-missing');

    expect(() =>
      validateTaxonomy(
        taxonomy({
          cross_domain_relations: [
            { source: 'topic-models', relation: 'related_to', target: 'topic-models' },
          ],
        }),
      ),
    ).toThrow('Self-referencing Taxonomy relation: topic-models related_to');
  });

  it('rejects duplicate cross-domain relations', () => {
    const relation = {
      source: 'topic-models',
      relation: 'related_to',
      target: 'topic-security',
    };

    expect(() =>
      validateTaxonomy(taxonomy({ cross_domain_relations: [relation, relation] })),
    ).toThrow('Duplicate Taxonomy relation: topic-models related_to topic-security');
  });

  it('rejects an explicit content parent that differs from the Taxonomy parent', () => {
    const catalog = validateTaxonomy(taxonomy());
    const documents = [
      {
        file: 'topics/models.md',
        frontMatter: validateFrontMatter({
          id: 'topic-models',
          title: '模型',
          type: 'topic',
          status: 'active',
          parent: 'topic-security',
        }),
      },
    ];

    expect(() =>
      validateTopicContentProjection(
        documents,
        [{ id: 'topic-models', title: 'Models', status: 'active' }],
        catalog,
      ),
    ).toThrow(
      'topics/models.md: Topic topic-models parent mismatch; expected "topic-ai", received "topic-security"',
    );
  });

  it('does not count Topic front matter outside content/topics as a Topic page', () => {
    const catalog = validateTaxonomy(taxonomy());
    const documents = [
      {
        file: 'insights/not-a-topic-page.md',
        frontMatter: validateFrontMatter({
          id: 'topic-models',
          title: '模型',
          type: 'topic',
          status: 'active',
          parent: 'topic-ai',
        }),
      },
    ];

    expect(() =>
      validateTopicContentProjection(
        documents,
        [{ id: 'topic-models', title: 'Models', status: 'active' }],
        catalog,
      ),
    ).toThrow('insights/not-a-topic-page.md: Topic content must be stored under content/topics/');
  });
});
