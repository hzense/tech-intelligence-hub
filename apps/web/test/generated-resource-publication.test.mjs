import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapEditorialSignalRows,
  createEditorialSignalReader,
} from '../lib/editorial-signal-reader-core.ts';
import { projectEditorialEntityLinks } from '../lib/editorial-entity-links.ts';
import {
  buildPublicEntityDirectory,
  parseSignalFilters,
  selectSignals,
} from '../lib/public-exploration-core.ts';
import {
  resourceHref,
  resourceIntroduction,
  resourceProfile,
} from '../lib/resource-presentation.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';

const evidence = [
  {
    fragment_id: 'fragment-1',
    quote: 'Example Security researcher Ada Example presented the security tool.',
  },
];
const resources = [
  {
    entity_id: 'person-ada-example',
    type: 'person',
    name: 'Ada Example',
    introduction: 'Ada Example researches security tools at Example Security.',
    event_role: 'Presented the security tool',
    evidence,
    source_urls: ['https://example.com/announcement'],
  },
  {
    entity_id: 'company-example-security',
    type: 'company',
    name: 'Example Security',
    introduction: 'Example Security develops security tools.',
    event_role: 'Tool developer',
    evidence,
    source_urls: ['https://example.com/research'],
  },
];
function row(overrides = {}) {
  return {
    signal_id: `editorial-${'a'.repeat(32)}`,
    revision: 1,
    published_at: '2026-10-04T12:00:00Z',
    content: {
      title: 'A security tool',
      summary: 'An evidenced product announcement.',
      eventDate: '2026-10-03',
      signalType: 'product',
      persons: ['Ada Example'],
      organizations: ['Example Security'],
      topics: [{ id: 'topic-ai-security', title: 'AI Security' }],
      sourceUrls: ['https://example.com/announcement', 'https://example.com/research'],
      resources: globalThis.structuredClone(resources),
    },
    ...overrides,
  };
}

test('published generated resources give canonical detail links, company type, profiles, sources and reverse Signals without Seed edits', () => {
  const [entry] = projectEditorialEntityLinks(mapEditorialSignalRows([row()]), []);
  const unified = toUnifiedSignal(entry);
  assert.equal(unified.people[0].id, 'person-ada-example');
  assert.equal(unified.people[0].eventRole, 'Presented the security tool');
  assert.equal(unified.organizations[0].id, 'company-example-security');
  assert.equal(unified.organizations[0].eventRole, 'Tool developer');
  assert.equal(
    JSON.stringify(entry).includes('fragment-1'),
    false,
    'private evidence fragments are not part of public DTOs',
  );
  const directory = buildPublicEntityDirectory([entry], [], new Date('2026-10-04'));
  const company = directory.find((entity) => entity.id === 'company-example-security');
  const person = directory.find((entity) => entity.id === 'person-ada-example');
  assert.equal(company.type, 'company');
  assert.equal(resourceHref(company), '/resources/company-example-security');
  assert.equal(resourceHref(person), '/persons/person-ada-example');
  assert.equal(resourceIntroduction(company), resources[1].introduction);
  assert.deepEqual(resourceProfile(company).sourceUrls, resources[1].source_urls);
  assert.deepEqual(resourceProfile(person).sourceUrls, resources[0].source_urls);
  assert.deepEqual(
    company.signals.map((signal) => signal.id),
    [entry.id],
  );
  assert.deepEqual(
    company.relatedPeople.map((person) => person.id),
    ['person-ada-example'],
  );
  assert.equal(
    selectSignals([entry], parseSignalFilters({ organization: company.id }), []).total,
    1,
  );
});

test('explicit published bindings survive same-name ambiguity; old names can resolve uniquely through a newly public resource', () => {
  const current = mapEditorialSignalRows([row()])[0];
  const old = row({ signal_id: `editorial-${'b'.repeat(32)}` });
  delete old.content.resources;
  const legacy = mapEditorialSignalRows([old])[0];
  const entries = projectEditorialEntityLinks([current, legacy], []);
  assert.deepEqual(entries[1].entities, ['person-ada-example', 'company-example-security']);
  const ambiguous = [
    { id: 'person-another-ada', name: 'Ada Example', type: 'person', status: 'active' },
  ];
  const again = projectEditorialEntityLinks([current, legacy], ambiguous);
  assert.equal(toUnifiedSignal(again[0]).people[0].id, 'person-ada-example');
  assert.equal(toUnifiedSignal(again[1]).people[0].id, null);
});

test('only current published revisions supply resource profiles; withdrawal removes an orphan but retains another published reference', async () => {
  const newer = row();
  const older = row({
    signal_id: `editorial-${'b'.repeat(32)}`,
    published_at: '2026-10-03T12:00:00Z',
  });
  older.content.resources[1].introduction = 'The earlier evidenced introduction.';
  let published = [older, newer];
  const reader = createEditorialSignalReader({ query: async () => ({ rows: published }) });
  const directory = async () => buildPublicEntityDirectory(await reader.list());
  assert.equal(
    resourceIntroduction((await directory()).find((entity) => entity.type === 'company')),
    resources[1].introduction,
  );
  published = [older];
  assert.equal(
    resourceIntroduction((await directory()).find((entity) => entity.type === 'company')),
    'The earlier evidenced introduction.',
  );
  published = [];
  assert.deepEqual(await directory(), []);
});

test('public reader rejects incomplete resource publication rather than displaying unbound drafts', () => {
  for (const alter of [
    (content) => {
      content.resources[0].entity_id = null;
    },
    (content) => {
      content.resources[0].entity_id = 'https://example.com/id';
    },
    (content) => {
      content.resources[1].type = 'person';
    },
    (content) => {
      content.resources.pop();
    },
    (content) => {
      content.sourceUrls = [];
    },
    (content) => {
      content.resources[0].source_urls = ['https://wrong.example/unselected'];
    },
    (content) => {
      delete content.resources[0].source_urls;
    },
  ]) {
    const input = row();
    alter(input.content);
    assert.throws(() => mapEditorialSignalRows([input]), { name: 'PublicSignalReaderError' });
  }
});

test('generated event profiles do not overwrite independently curated existing profiles', () => {
  const input = row();
  input.content.resources[1].entity_id = 'company-google';
  input.content.resources[1].name = 'Google';
  input.content.organizations = ['Google'];
  const entry = mapEditorialSignalRows([input])[0];
  const company = buildPublicEntityDirectory([entry]).find(
    (entity) => entity.id === 'company-google',
  );
  assert.equal(resourceIntroduction(company), resourceProfile('company-google').introduction);
});

test('a generated publication without evidenced people creates only the supported organization', () => {
  const input = row();
  input.content.persons = [];
  input.content.resources = input.content.resources.filter(
    (resource) => resource.type !== 'person',
  );
  const [entry] = mapEditorialSignalRows([input]);
  assert.deepEqual(entry.public_people, []);
  const directory = buildPublicEntityDirectory([entry]);
  assert.deepEqual(
    directory.map((entity) => entity.id),
    ['company-example-security'],
  );
  assert.deepEqual(directory[0].relatedPeople, []);
});
