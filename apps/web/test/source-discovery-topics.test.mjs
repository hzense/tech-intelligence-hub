import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unavailableDiscoveryTopics,
  discoveryMissingTopicNames,
} from '../lib/source-discovery-topics.ts';

test('every selected discovery domain must have its own publishable label', () => {
  const selected = [
    { id: 'topic-ai', name: '人工智能' },
    { id: 'topic-quantum', name: '量子技术' },
  ];
  assert.deepEqual(unavailableDiscoveryTopics(selected, selected), []);
  assert.deepEqual(unavailableDiscoveryTopics(selected, [{ id: 'topic-ai' }]), [selected[1]]);
  assert.deepEqual(unavailableDiscoveryTopics(selected, [{ id: 'topic-ai-agents' }]), selected);
  assert.deepEqual(
    unavailableDiscoveryTopics([selected[1]], [{ id: 'topic-quantum' }]),
    [],
    'a legacy explicit filter need not enable unrelated domains',
  );
  assert.equal(selected.length, 2, 'the requested search scope is never narrowed');
});

test('missing-domain labels tolerate old and malformed task results', () => {
  assert.deepEqual(discoveryMissingTopicNames(undefined), []);
  assert.deepEqual(discoveryMissingTopicNames({}), []);
  assert.deepEqual(
    discoveryMissingTopicNames([
      { id: 'topic-quantum', name: '量子技术' },
      null,
      'topic-ai',
      { id: 'bad', name: 'bad' },
      { id: 'topic-empty', name: ' ' },
      { id: 'topic-long', name: 'a'.repeat(201) },
    ]),
    ['量子技术'],
  );
});
