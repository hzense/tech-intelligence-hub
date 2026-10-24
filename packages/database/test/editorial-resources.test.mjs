import { describe, expect, it } from 'vitest';
import {
  normalizeEditorialContent,
  normalizeEditorialRequest,
  normalizeEditorialResources,
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

export function manualOrganizationFixture(suffix = '') {
  const fixture = resourceFixture(suffix);
  fixture.material.resources = [];
  fixture.material.resourceSourceOptions = [];
  fixture.material.sourceOptions = [...fixture.content.sourceUrls];
  fixture.content.persons = [];
  fixture.content.resources = [
    {
      type: 'institution',
      name: `Manual organization${suffix}`,
      introduction: null,
      event_role: null,
      evidence: [],
      basis: 'manual_confirmation',
      entity_id: null,
    },
  ];
  fixture.content.organizations = [fixture.content.resources[0].name];
  return fixture;
}

describe('manual organization publication contract', () => {
  it('records administrator assertions with no fabricated evidence and requires explicit consent', () => {
    const { request, material } = manualOrganizationFixture();
    expect(normalizeEditorialRequest(request, material)).toEqual(request);
    expect(() => normalizeEditorialRequest({ ...request, consent: false }, material)).toThrow(
      'confirmation_required',
    );
    expect(
      normalizeEditorialRequest({ ...request, action: 'draft', consent: false }, material).action,
    ).toBe('draft');
    expect(() =>
      normalizeEditorialRequest({ ...request, consent: false }, material, { automatic: true }),
    ).toThrow('automatic_publication_invalid');
    expect(() => normalizeEditorialRequest(request, { ...material, resources: undefined })).toThrow(
      'material_changed',
    );
    const original = resourceFixture();
    expect(normalizeEditorialRequest(original.request, original.material)).toEqual(
      original.request,
    );
    expect(normalizeEditorialContent(original.content).resources[0]).not.toHaveProperty('basis');
  });
  it('does not permit manual people, fake quotations, generated basis markers or duplicate organizations', () => {
    const { request, material } = manualOrganizationFixture();
    const resource = request.content.resources[0];
    for (const patch of [
      { type: 'person' },
      { basis: 'automatic_checks' },
      { evidence: [{ fragment_id: 'fragment-1', quote: 'An invented quote' }] },
      { basis: undefined },
    ])
      expect(() => normalizeEditorialResources([{ ...resource, ...patch }])).toThrow();
    expect(() =>
      normalizeEditorialResources(
        [
          {
            ...material.resources[0],
            ...resource,
          },
        ],
        { generated: true },
      ),
    ).toThrow();
    const { entity_id: id, ...draft } = resource;
    expect(id).toBe(null);
    expect(() => normalizeEditorialResources([draft], { generated: true })).toThrow();
    expect(normalizeEditorialResources([draft], { generated: true, allowManual: true })).toEqual([
      draft,
    ]);
    expect(() =>
      normalizeEditorialContent({
        ...request.content,
        resources: [resource, { ...resource, name: resource.name.toUpperCase() }],
        organizations: [resource.name, resource.name.toUpperCase()],
      }),
    ).toThrow();
  });
  it('allows only exact organization gap completion and cannot replace a generated resource', () => {
    const manual = manualOrganizationFixture();
    manual.material.missingResourceDetails = [
      { type: 'organization', name: manual.content.organizations[0] },
    ];
    expect(normalizeEditorialRequest(manual.request, manual.material)).toEqual(manual.request);
    for (const gap of [
      { type: 'person', name: manual.content.organizations[0] },
      { type: 'organization', name: 'Other organization' },
    ]) {
      expect(() =>
        normalizeEditorialRequest(manual.request, {
          ...manual.material,
          missingResourceDetails: [gap],
        }),
      ).toThrow('resource_details_incomplete');
    }
    const generated = resourceFixture();
    generated.content.resources[0] = {
      ...generated.content.resources[0],
      evidence: [],
      basis: 'manual_confirmation',
    };
    expect(() => normalizeEditorialRequest(generated.request, generated.material)).toThrow(
      'material_changed',
    );
    const extra = manual.content.resources[0];
    const intact = resourceFixture();
    intact.content.resources.push(extra);
    intact.content.organizations.push(extra.name);
    expect(normalizeEditorialRequest(intact.request, intact.material)).toEqual(intact.request);
  });
  it('previews manual organizations only through the explicit server option', async () => {
    const { content } = manualOrganizationFixture();
    const { entity_id: id, ...resource } = content.resources[0];
    expect(id).toBe(null);
    const pool = {
      connect: async () => ({
        query: async () => ({
          rows: [
            {
              id: 'institution-existing',
              type: 'institution',
              name: resource.name,
              status: 'active',
              aliases: [],
            },
          ],
        }),
        release() {},
      }),
    };
    await expect(previewEditorialResources({ pool, resources: [resource] })).rejects.toThrow();
    await expect(
      previewEditorialResources({ pool, resources: [resource], allowManual: true }),
    ).resolves.toEqual([
      {
        name: resource.name,
        type: 'institution',
        status: 'reuse',
        matches: [{ id: 'institution-existing', name: resource.name, type: 'institution' }],
      },
    ]);
  });
});

describe('generated resource publication contract', () => {
  it('blocks new publication of incomplete server-bound resources, but permits drafts and withdrawal', () => {
    const { request, material } = resourceFixture();
    // The displayed resources and participant list have already been narrowed:
    // a client cannot make the server's missing identity disappear by omitting it.
    material.missingResourceDetails = [{ type: 'organization', name: 'Missing organization' }];
    expect(() => normalizeEditorialRequest(request, material)).toThrow(
      'resource_details_incomplete',
    );
    expect(
      normalizeEditorialRequest({ ...request, action: 'draft', consent: false }, material).action,
    ).toBe('draft');
    expect(normalizeEditorialRequest({ ...request, action: 'withdraw' }, material).action).toBe(
      'withdraw',
    );
    // Receipt replay validation intentionally precedes today's publication policy.
    expect(normalizeEditorialRequest(request, material, { checkPublication: false }).action).toBe(
      'publish',
    );
    material.missingResourceDetails = [];
    expect(normalizeEditorialRequest(request, material).action).toBe('publish');
  });
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
