import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { projectEditorialEntityLinks } from '../lib/editorial-entity-links.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';
import {
  buildPublicEntityDirectory,
  nameOnlySignalFilters,
  parseSignalFilters,
  selectSignals,
} from '../lib/public-exploration-core.ts';

const person = { id: 'person-researcher', name: 'Researcher', type: 'person', status: 'active' };
const organization = {
  id: 'company-example',
  name: 'Example Labs',
  type: 'company',
  status: 'active',
  aliases: ['Example Laboratory'],
};
const catalog = [person, organization];
function manual(overrides = {}) {
  return {
    id: `editorial-${'a'.repeat(32)}`,
    title: 'Reported event',
    summary: 'The event summary',
    type: 'editorial',
    publication_basis: 'manual_confirmation',
    publication_revision: 1,
    status: 'accepted',
    occurred_at: '2026-10-01T00:00:00.000Z',
    captured_at: '2026-10-02T00:00:00.000Z',
    topics: ['topic-ai'],
    source_id: '',
    source_url: '',
    entities: [],
    public_people: [{ id: 'person-0', name: 'Researcher', event_role: '' }],
    public_organizations: [{ id: 'organization-0', name: 'Example Labs', event_role: '' }],
    ...overrides,
  };
}
function qualified(overrides = {}) {
  return {
    ...manual(),
    id: 'qualified-event',
    type: 'research',
    publication_basis: 'source_evidence',
    public_version: 1,
    importance: 3,
    confidence: 0.7,
    novelty: 0.8,
    public_people: [{ id: person.id, name: person.name, event_role: 'researcher' }],
    public_organizations: [
      { id: organization.id, name: organization.name, event_role: 'publisher' },
    ],
    ...overrides,
  };
}

test('only unique exact typed names and existing aliases resolve; no fuzzy matching or entity creation', () => {
  const original = manual({
    public_people: [
      { id: 'person-0', name: ' ＲＥＳＥＡＲＣＨＥＲ ', event_role: 'speaker' },
      { id: 'person-1', name: 'Example Labs', event_role: '' },
      { id: 'person-2', name: 'Researcher Junior', event_role: '' },
    ],
    public_organizations: [
      { id: 'organization-0', name: 'example laboratory', event_role: '' },
      { id: 'organization-1', name: 'Researcher', event_role: '' },
    ],
  });
  const snapshot = globalThis.structuredClone(original);
  const [entry] = projectEditorialEntityLinks([original], catalog);
  const unified = toUnifiedSignal(entry);
  assert.deepEqual(
    unified.people.map((row) => row.id),
    [person.id, null, null],
  );
  assert.deepEqual(
    unified.organizations.map((row) => row.id),
    [organization.id, null],
  );
  assert.equal(unified.people[0].eventRole, 'speaker');
  assert.deepEqual(entry.entities, [person.id, organization.id]);
  assert.equal(unified.publication.basis, 'manual_confirmation');
  assert.equal(unified.assessment, null);
  assert.deepEqual(original, snapshot, 'the immutable stored/public record is not mutated');
});

test('ambiguous aliases and missing or inactive identities remain name-only', () => {
  const ambiguous = [
    ...catalog,
    { ...person, id: 'person-other', name: 'Another Person', aliases: ['Researcher'] },
    { ...organization, status: 'archived' },
  ];
  const [entry] = projectEditorialEntityLinks([manual()], ambiguous);
  assert.equal(toUnifiedSignal(entry).people[0].id, null);
  assert.equal(toUnifiedSignal(entry).organizations[0].id, organization.id);
  const [inactive] = projectEditorialEntityLinks(
    [manual()],
    catalog.map((row) => ({ ...row, status: 'archived' })),
  );
  assert.deepEqual(inactive.entities, []);
  assert.deepEqual(
    toUnifiedSignal(inactive).people.map((row) => row.id),
    [null],
  );
});

test('existing current public identities extend the catalog, but editorial names cannot create identities', () => {
  const current = qualified();
  const entries = projectEditorialEntityLinks([manual(), current], []);
  assert.deepEqual(entries[0].entities, [person.id, organization.id]);
  assert.equal(entries[1], current);
  const [unlinked] = projectEditorialEntityLinks([manual()], []);
  assert.deepEqual(unlinked.entities, []);
  assert.equal(toUnifiedSignal(unlinked).people[0].id, null);
  const forged = manual({
    id: `editorial-${'b'.repeat(32)}`,
    public_people: [
      { id: person.id, name: person.name, event_role: '', canonical_entity_id: person.id },
    ],
  });
  assert.ok(
    projectEditorialEntityLinks([manual(), forged], []).every((row) => row.entities.length === 0),
  );
  assert.deepEqual(
    projectEditorialEntityLinks([manual(), qualified({ public_version: undefined })], [])[0]
      .entities,
    [],
  );
});

test('a removed or ambiguous catalog identity clears a previous projection on the next read', () => {
  const resolved = projectEditorialEntityLinks([manual()], catalog);
  const [withdrawn] = projectEditorialEntityLinks(resolved, []);
  assert.deepEqual(withdrawn.entities, []);
  assert.equal(toUnifiedSignal(withdrawn).people[0].id, null);
  assert.equal(toUnifiedSignal(withdrawn).organizations[0].id, null);
});

test('excluded people cannot gain links through a catalog alias or an old public identity', () => {
  const leader = {
    id: 'person-xi-jinping',
    name: 'Xi Jinping',
    type: 'person',
    status: 'active',
    aliases: ['Leader Alias'],
  };
  const original = manual({
    public_people: [{ id: 'person-0', name: 'Leader Alias', event_role: '' }],
  });
  const [entry] = projectEditorialEntityLinks(
    [
      original,
      qualified({ public_people: [{ id: leader.id, name: 'Leader Alias', event_role: '' }] }),
    ],
    [leader],
  );
  assert.deepEqual(entry.entities, [organization.id]);
  assert.equal(toUnifiedSignal(entry).people[0].id, null);
  const [roleExcluded] = projectEditorialEntityLinks(
    [
      manual({
        public_people: [{ id: 'person-0', name: person.name, event_role: 'head of government' }],
      }),
    ],
    catalog,
  );
  assert.deepEqual(toUnifiedSignal(roleExcluded).people, []);
});

test('resolved IDs consistently drive detail links, resource reverse signals and filters', () => {
  const [entry] = projectEditorialEntityLinks([manual()], catalog);
  const unified = toUnifiedSignal(entry);
  assert.equal(unified.people[0].id, person.id);
  assert.equal(unified.organizations[0].id, organization.id);
  assert.deepEqual(nameOnlySignalFilters([entry], 'person'), []);
  assert.equal(selectSignals([entry], parseSignalFilters({ person: person.id }), []).total, 1);
  assert.equal(
    selectSignals([entry], parseSignalFilters({ organization: organization.id }), []).total,
    1,
  );
  const directory = buildPublicEntityDirectory([entry], catalog);
  assert.deepEqual(
    directory.find((row) => row.id === person.id).signals.map((row) => row.id),
    [entry.id],
  );
  assert.deepEqual(
    directory.find((row) => row.id === person.id).relatedOrganizations.map((row) => row.id),
    [organization.id],
  );
  assert.deepEqual(
    directory.find((row) => row.id === organization.id).relatedPeople.map((row) => row.id),
    [person.id],
  );
});

test('actual public list, detail and entity lookup share catalog matching in both read modes and observe withdrawals', async () => {
  const state = { editorial: [manual()], qualified: [qualified()], seed: [] };
  globalThis.__editorialEntityRuntime = state;
  const originalMode = process.env.HZENSE_SIGNAL_READ_MODE;
  const originalEnabled = process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
  try {
    const bundled = await build({
      entryPoints: [new URL('../lib/seed-runtime.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'public-entity-runtime-providers',
          setup(plugin) {
            const modules = {
              '@hzense/content': `export async function loadSeedCatalog() { return { entities: globalThis.__editorialEntityRuntime.seed, signals: [], sources: [], topics: [] }; }`,
              './server/public-signals.ts': `export async function getPublicSignals() { const s = globalThis.__editorialEntityRuntime; return [...s.qualified, ...s.editorial]; }`,
              './server/editorial-signals.ts': `export async function getEditorialSignals() { return globalThis.__editorialEntityRuntime.editorial; }`,
            };
            plugin.onResolve(
              { filter: /^(@hzense\/content|\.\/server\/(public-signals|editorial-signals)\.ts)$/ },
              (args) => ({ path: args.path, namespace: 'providers' }),
            );
            plugin.onLoad({ filter: /.*/, namespace: 'providers' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const api = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = '1';
    process.env.HZENSE_SIGNAL_READ_MODE = 'database';
    const id = state.editorial[0].id;
    assert.deepEqual((await api.getSignalEntryById(id)).entities, [person.id, organization.id]);
    assert.deepEqual((await api.getSignalEntries()).find((row) => row.id === id).entities, [
      person.id,
      organization.id,
    ]);
    assert.ok((await api.getSignalsForEntity(person.id)).some((row) => row.id === id));
    state.qualified = [];
    assert.deepEqual((await api.getSignalEntryById(id)).entities, []);
    // The loaded seed catalog keeps the same array; populate active known resources.
    state.seed.push(...catalog);
    process.env.HZENSE_SIGNAL_READ_MODE = 'legacy';
    assert.deepEqual((await api.getSignalEntryById(id)).entities, [person.id, organization.id]);
    assert.deepEqual((await api.getSignalEntries()).find((row) => row.id === id).entities, [
      person.id,
      organization.id,
    ]);
    assert.deepEqual(
      (await api.getSignalsForEntity(organization.id)).map((row) => row.id),
      [id],
    );
    state.editorial = [];
    assert.equal(await api.getSignalEntryById(id), undefined);
    assert.deepEqual(await api.getSignalsForEntity(person.id), []);
  } finally {
    if (originalMode === undefined) delete process.env.HZENSE_SIGNAL_READ_MODE;
    else process.env.HZENSE_SIGNAL_READ_MODE = originalMode;
    if (originalEnabled === undefined) delete process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
    else process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = originalEnabled;
    delete globalThis.__editorialEntityRuntime;
  }
});
