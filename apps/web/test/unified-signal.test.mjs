import assert from 'node:assert/strict';
import test from 'node:test';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';

const base = {
  id: 'example-signal',
  title: 'Example',
  summary: 'Example summary',
  type: 'technology',
  status: 'accepted',
  occurred_at: '2026-09-01T00:00:00.000Z',
  captured_at: '2026-09-02T00:00:00.000Z',
  source_id: 'source-one',
  source_url: 'https://example.com/story',
  topics: ['topic-one'],
  entities: ['person-one'],
  importance: 3,
  confidence: 0.8,
  novelty: 0.5,
};

test('legacy and qualified signals share the same public shape without changing their basis', () => {
  const legacy = toUnifiedSignal(base);
  const qualified = toUnifiedSignal({
    ...base,
    public_version: 2,
    publication_revision: 4,
    public_people: [{ id: 'person-one', name: 'Person One', event_role: 'founder' }],
    public_sources: [{ id: 'source-one', name: 'Source One', url: base.source_url }],
  });
  assert.deepEqual(Object.keys(legacy), Object.keys(qualified));
  assert.equal(legacy.publication.basis, 'legacy_seed');
  assert.equal(legacy.publication.state, 'archive');
  assert.equal(qualified.publication.basis, 'source_evidence');
  assert.equal(qualified.publication.state, 'published');
  assert.equal(qualified.publication.version, 2);
  assert.equal(qualified.assessment.importance, 3);
  assert.equal(qualified.people[0].id, 'person-one');
  assert.deepEqual(qualified.relatedEntities, []);
});

test('historical non-participant entities remain visible without becoming people or organizations', () => {
  const legacy = toUnifiedSignal({
    ...base,
    legacy_related_entities: [{ id: 'model-one', name: 'Model One', type: 'model' }],
  });
  assert.deepEqual(legacy.people, []);
  assert.deepEqual(legacy.organizations, []);
  assert.deepEqual(legacy.relatedEntities, [{ id: 'model-one', name: 'Model One', type: 'model' }]);
});

test('manual signal keeps names but has no invented entity identity or assessment', () => {
  const { importance, confidence, novelty, ...withoutAssessment } = base;
  void importance;
  void confidence;
  void novelty;
  const manual = toUnifiedSignal({
    ...withoutAssessment,
    id: 'editorial-1234',
    type: 'editorial',
    publication_basis: 'manual_confirmation',
    publication_revision: 1,
    public_people: [{ id: 'person-0', name: 'Named Person', event_role: '' }],
    public_organizations: [{ id: 'organization-0', name: 'Named Organization', event_role: '' }],
    public_sources: [],
  });
  assert.equal(manual.publication.basis, 'manual_confirmation');
  assert.equal(manual.type, null);
  assert.equal(manual.publication.state, 'published');
  assert.equal(manual.assessment, null);
  assert.deepEqual(manual.people, [{ id: null, name: 'Named Person', eventRole: '' }]);
  assert.deepEqual(manual.organizations, [{ id: null, name: 'Named Organization', eventRole: '' }]);
  assert.deepEqual(manual.relatedEntities, []);
  assert.deepEqual(manual.sources, []);
});
