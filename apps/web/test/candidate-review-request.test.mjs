import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRequestIdentity } from '../components/candidate-review-request.ts';

test('uncertain save reuses original request identity, changed payload receives new identity', () => {
  let calls = 0;
  const nextId = () => `id-${++calls}`;
  const first = reviewRequestIdentity(null, 'revision=0;draft=a', nextId);
  assert.equal(reviewRequestIdentity(first, 'revision=0;draft=a', nextId), first);
  assert.equal(calls, 1);
  assert.equal(reviewRequestIdentity(first, 'revision=0;draft=b', nextId).requestId, 'id-2');
  assert.equal(reviewRequestIdentity(first, 'revision=1;draft=a', nextId).requestId, 'id-3');
});
