import { describe, expect, it } from 'vitest';
import {
  normalizeEditorialContent,
  normalizeEditorialRequest,
} from '../src/editorial-signal-contract.mjs';
import { previewEditorialResources } from '../src/editorial-signal-store.mjs';
import { editorialFixture } from './editorial-signal.test.mjs';

export function resourceFixture(suffix = '') {
  const fixture = editorialFixture();
  const resources = [
    {
      type: 'company',
      name: `Organization${suffix}`,
      introduction: 'Builds a platform.',
      event_role: 'Released the platform',
      evidence: [
        { fragment_id: 'fragment-1', quote: `Organization${suffix} released the platform.` },
      ],
    },
    {
      type: 'person',
      name: `Person${suffix}`,
      introduction: null,
      event_role: 'Announced the platform',
      evidence: [{ fragment_id: 'fragment-1', quote: `Person${suffix} announced the platform.` }],
    },
  ];
  fixture.content.organizations = [resources[0].name];
  fixture.content.persons = [resources[1].name];
  fixture.content.resources = resources.map((resource) => ({ ...resource, entity_id: null }));
  fixture.material.resources = resources;
  fixture.material.resourceSourceOptions = resources.map(({ name, type }) => ({
    name,
    type,
    sourceUrls: fixture.content.sourceUrls,
  }));
  return fixture;
}

describe('generated resource publication contract', () => {
  it('binds every generated resource field and participant name while preserving the old shape', () => {
    const { request, material } = resourceFixture();
    expect(normalizeEditorialRequest(request, material)).toEqual(request);
    for (const patch of [
      { introduction: 'Forged biography' },
      { event_role: 'Owner' },
      { name: 'Forged' },
      { evidence: [{ fragment_id: 'fragment-1', quote: 'Forged quote' }] },
    ])
      expect(() =>
        normalizeEditorialRequest(
          {
            ...request,
            content: {
              ...request.content,
              resources: [
                { ...request.content.resources[0], ...patch },
                request.content.resources[1],
              ],
            },
          },
          material,
        ),
      ).toThrow();
    for (const patch of [{ resources: undefined }, { organizations: ['Other'] }, { persons: [] }])
      expect(() =>
        normalizeEditorialRequest(
          { ...request, content: { ...request.content, ...patch } },
          material,
        ),
      ).toThrow();
    const old = editorialFixture();
    expect(normalizeEditorialContent(old.content)).not.toHaveProperty('resources');
  });
  it('requires a selected public source and only permits organization type correction with an explicit ID', () => {
    const { request, material } = resourceFixture();
    expect(() =>
      normalizeEditorialRequest(
        { ...request, content: { ...request.content, sourceUrls: [] } },
        { ...material, sourceOptions: [] },
      ),
    ).toThrow('resource_source_required');
    const correction = {
      ...request.content,
      resources: request.content.resources.map((row, i) =>
        i ? row : { ...row, type: 'institution', entity_id: 'institution-known' },
      ),
    };
    expect(
      normalizeEditorialRequest({ ...request, content: correction }, material).content.resources[0]
        .type,
    ).toBe('institution');
    correction.resources[0].entity_id = null;
    expect(() => normalizeEditorialRequest({ ...request, content: correction }, material)).toThrow(
      'material_changed',
    );
    const duplicate = {
      ...request.content,
      resources: request.content.resources.map((row) => ({ ...row, entity_id: 'same-id' })),
    };
    expect(() => normalizeEditorialContent(duplicate)).toThrow('entity_reference_invalid');
  });
  it('previews typed names and aliases across the seed and database without writing', async () => {
    const { material } = resourceFixture();
    const sql = [];
    const pool = {
      connect: async () => ({
        query: async (query) => {
          sql.push(query);
          return {
            rows: [
              {
                id: 'company-one',
                type: 'company',
                name: 'Existing',
                aliases: ['Organization'],
                status: 'active',
              },
              {
                id: 'company-other-person',
                type: 'company',
                name: 'Person',
                aliases: [],
                status: 'active',
              },
            ],
          };
        },
        release() {},
      }),
    };
    const preview = await previewEditorialResources({
      pool,
      resources: material.resources,
      catalog: [{ id: 'person-one', type: 'person', name: 'Person', status: 'active' }],
    });
    expect(preview.map((row) => [row.status, row.matches[0]?.id])).toEqual([
      ['reuse', 'company-one'],
      ['reuse', 'person-one'],
    ]);
    expect(sql.every((query) => query.startsWith('SELECT'))).toBe(true);
    const ambiguous = await previewEditorialResources({
      pool,
      resources: material.resources,
      catalog: [
        { id: 'institution-other', type: 'institution', name: 'Organization', status: 'active' },
      ],
    });
    expect(ambiguous[0].status).toBe('ambiguous');
    expect(ambiguous[0].matches).toHaveLength(2);
    expect(ambiguous[1].status).toBe('new');
  });
});
