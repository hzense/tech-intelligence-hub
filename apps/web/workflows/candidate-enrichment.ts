import { sleep } from 'workflow';
import { failQueuedCandidateEnrichment } from '../lib/server/candidate-enrichment';
import {
  startCandidateEnrichmentSandbox,
  pollGenerationSandbox,
  stopGenerationSandbox,
  type GenerationSandboxHandle,
} from '../lib/server/generation-sandbox';

// Workflow stores identifiers only. Source text and credentials are loaded
// inside the isolated worker and never enter Workflow event history.
export async function candidateEnrichmentWorkflow(owner: string, id: string) {
  'use workflow';
  for (let attempt = 0; attempt < 60; attempt++) {
    const handle = await runEnrichmentStep(owner, id);
    if (!handle) return 'already_started_or_finished';
    let status = 'running';
    try {
      for (let poll = 0; poll < 64; poll++) {
        await sleep('30s');
        status = await pollEnrichmentStep(handle);
        if (status !== 'running') break;
      }
    } finally {
      await stopEnrichmentStep(handle);
    }
    if (status !== 'busy') {
      await failQueuedStep(owner, id);
      return status;
    }
    await sleep('30s');
  }
  await failQueuedStep(owner, id);
  return 'queue_expired';
}

async function runEnrichmentStep(owner: string, id: string) {
  'use step';
  try {
    return await startCandidateEnrichmentSandbox(owner, id);
  } catch {
    await failQueuedCandidateEnrichment(owner, id);
    throw new Error('enrichment_dispatch_failed');
  }
}
// This step allocates the only process that may call the provider. Retrying it
// could create a second billable request, so Workflow retries are forbidden.
runEnrichmentStep.maxRetries = 0;

async function pollEnrichmentStep(handle: GenerationSandboxHandle) {
  'use step';
  return pollGenerationSandbox(handle);
}
pollEnrichmentStep.maxRetries = 3;

async function stopEnrichmentStep(handle: GenerationSandboxHandle) {
  'use step';
  await stopGenerationSandbox(handle).catch(() => undefined);
}
stopEnrichmentStep.maxRetries = 0;

async function failQueuedStep(owner: string, id: string) {
  'use step';
  await failQueuedCandidateEnrichment(owner, id);
}
failQueuedStep.maxRetries = 0;
