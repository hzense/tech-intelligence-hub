import { publishGeneratedSignals } from '../lib/server/editorial-review';

/** Separate from paid generation: retries only inspect/write publication receipts. */
export async function runAutomaticPublicationStep(owner: string, runId: string) {
  'use step';
  const result = await publishGeneratedSignals(owner, runId);
  console.info(
    JSON.stringify({
      event: 'automatic_publication',
      run_id: runId,
      state: result.state,
      published: result.candidates.filter((candidate) => candidate.status === 'published').length,
      needs_attention: result.candidates.filter(
        (candidate) => candidate.status === 'needs_attention',
      ).length,
    }),
  );
  // No source contents, candidate text, credentials or owner enter Workflow events.
  return { state: result.state };
}
runAutomaticPublicationStep.maxRetries = 3;
