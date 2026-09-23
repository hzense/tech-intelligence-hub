import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

test('candidate enrichment uses a non-retrying billable dispatch step', async () => {
  const source = await readFile(
    new URL('../workflows/candidate-enrichment.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /runEnrichmentStep\.maxRetries = 0/);
  assert.match(source, /pollEnrichmentStep\.maxRetries = 3/);
  assert.doesNotMatch(source, /executeCandidateEnrichment\(/);
  assert.match(source, /startCandidateEnrichmentSandbox/);
});
