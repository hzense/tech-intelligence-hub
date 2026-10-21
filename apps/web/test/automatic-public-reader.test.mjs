import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorialSignalReader,
  editorialPublicationBasisCapabilityQuery,
  mapEditorialSignalRows,
} from '../lib/editorial-signal-reader-core.ts';
import { mapUnifiedSignalRows } from '../lib/unified-signal-reader-core.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';
import { editorialUnifiedContent } from '../../../packages/database/src/unified-signal-plan.mjs';
import { projectEditorialEntityLinks } from '../lib/editorial-entity-links.ts';
import { buildPublicEntityDirectory } from '../lib/public-exploration-core.ts';
import { buildSignalRadar } from '../lib/signal-radar-model.ts';
import { currentInsight, insightInput, selectInsightSignals } from '../lib/topic-insight-core.ts';
import { getSearchDocumentProjections, searchPublishedContent } from '../lib/search-runtime.ts';

const id = `editorial-${'a'.repeat(32)}`;
const content = {
  title: 'AUTOMATICCANARY: a source-backed product announcement',
  summary: 'A public source reports the product announcement.',
  eventDate: '2026-10-20',
  dateBasis: 'source_published',
  signalType: 'product',
  organizations: ['Example Lab'],
  persons: ['Example Researcher'],
  topics: [{ id: 'topic-ai', title: 'AI' }],
  sourceUrls: ['https://example.com/article'],
};
const publishedAt = '2026-10-21T12:00:00.000Z';
const row = (overrides = {}) => ({
  signal_id: id,
  revision: 1,
  published_at: publishedAt,
  publication_basis: 'automatic_checks',
  content,
  ...overrides,
});
const entry = () => mapEditorialSignalRows([row()])[0];

test('automatic public provenance survives both readers without fabricated scores or human approval', () => {
  const direct = entry();
  const unified = mapUnifiedSignalRows([
    {
      signal_id: id,
      version: 1,
      origin: 'ai_generation',
      publication_basis: 'automatic_checks',
      content: editorialUnifiedContent(content),
      recorded_at: publishedAt,
      date_basis: 'source_published',
    },
  ])[0];
  const canonical = toUnifiedSignal(direct);
  assert.deepEqual(toUnifiedSignal(unified), canonical);
  assert.equal(canonical.publication.basis, 'automatic_checks');
  assert.equal(canonical.publication.state, 'published');
  assert.equal(canonical.assessment, null);
  assert.equal(canonical.dateBasis, 'source_published');
  assert.equal(canonical.people[0].id, null, 'positional names are not canonical identities');
  for (const basis of ['source_evidence', 'legacy_import', 'AI verified', '', null])
    assert.throws(() => mapEditorialSignalRows([row({ publication_basis: basis })]));
});

test('legacy reader supports an unmigrated schema but fails closed on missing new ACL or unknown basis', async () => {
  let capabilities = [];
  let result = [{ ...row(), publication_basis: undefined }];
  const queries = [];
  const reader = createEditorialSignalReader({
    query: async (sql) => {
      queries.push(sql);
      return { rows: sql === editorialPublicationBasisCapabilityQuery ? capabilities : result };
    },
  });
  assert.equal((await reader.list())[0].publication_basis, 'manual_confirmation');
  assert.doesNotMatch(queries.at(-1), /published_at, publication_basis/);
  capabilities = [{ available: true }];
  result = [row()];
  assert.equal((await reader.list())[0].publication_basis, 'automatic_checks');
  assert.match(queries.at(-1), /published_at, publication_basis/);
  capabilities = [{ available: false }];
  const before = queries.length;
  await assert.rejects(reader.list(), { name: 'PublicSignalReaderError' });
  assert.equal(queries.length, before + 1, 'partial ACL upgrade never reads/mislabels content');
  capabilities = [{ available: true }];
  result = [{ ...row(), publication_basis: null }];
  await assert.rejects(reader.list(), { name: 'PublicSignalReaderError' });
  result = [{ ...row(), publication_basis: undefined }];
  await assert.rejects(reader.list(), { name: 'PublicSignalReaderError' });
  result = [row({ publication_basis: 'forged' })];
  await assert.rejects(reader.list(), { name: 'PublicSignalReaderError' });
  result = [];
  assert.deepEqual(await reader.list(), []);
  assert.equal(await reader.byId(id), undefined, 'withdrawal is visible without cache');
});

test('automatic publications resolve only unique typed resource identities and contribute to radar', () => {
  const catalog = [
    { id: 'person-example', name: 'Example Researcher', type: 'person', status: 'active' },
    { id: 'company-example', name: 'Example Lab', type: 'company', status: 'active' },
  ];
  const [resolved] = projectEditorialEntityLinks([entry()], catalog);
  assert.deepEqual(resolved.entities, ['person-example', 'company-example']);
  assert.equal(toUnifiedSignal(resolved).publication.basis, 'automatic_checks');
  const directory = buildPublicEntityDirectory([resolved]);
  assert.equal(directory.length, 2);
  const radar = buildSignalRadar([resolved], [{ id: 'topic-ai', name: 'AI', parentId: null }], {
    now: new Date(publishedAt),
    entities: directory,
  });
  assert.equal(radar.totalCount, 1);
  assert.equal(radar.domains[0].totalCount, 1);
  assert.equal(radar.latestSignals[0].importance, null);
  assert.deepEqual(projectEditorialEntityLinks([resolved], [])[0].entities, []);
});

test('automated publications enter insights while changed and withdrawn evidence invalidates reports', () => {
  const signals = [entry(), { ...entry(), id: `editorial-${'b'.repeat(32)}` }];
  const window = selectInsightSignals(signals, ['topic-ai'], new Date(publishedAt));
  assert.equal(window.signals.length, 2);
  const result = {
    kind: 'topic_insight',
    topicIds: ['topic-ai'],
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    generatedAt: publishedAt,
    inputs: signals.map(insightInput),
    report: {
      title: 'AI observation',
      summary: 'Based on public signals, not independent fact verification.',
      sections: [
        { heading: 'Evidence', body: 'Observed changes.', signalIds: signals.map((s) => s.id) },
      ],
      uncertainties: ['Source coverage may be incomplete.'],
    },
  };
  assert.ok(currentInsight(result, signals));
  assert.equal(currentInsight(result, signals.slice(0, 1)), null);
  assert.equal(currentInsight(result, [{ ...signals[0], summary: 'Corrected' }, signals[1]]), null);
});

test('search uses the live automatic publication, never the scored Seed projection', async () => {
  const signal = entry();
  const projected = await getSearchDocumentProjections(true, [signal]);
  assert.ok(projected.every((document) => document.sourceId !== signal.id));
  const found = await searchPublishedContent('AUTOMATICCANARY', 'signal', true, [signal]);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, signal.id);
  const corrected = { ...signal, title: 'CORRECTEDCANARY: corrected title' };
  assert.deepEqual(
    await searchPublishedContent('AUTOMATICCANARY', 'signal', true, [corrected]),
    [],
  );
  assert.equal(
    (await searchPublishedContent('CORRECTEDCANARY', 'signal', true, [corrected])).length,
    1,
  );
  assert.deepEqual(await searchPublishedContent('AUTOMATICCANARY', 'signal', true, []), []);
});
