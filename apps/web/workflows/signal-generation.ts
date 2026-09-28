import { sleep } from 'workflow';
import { failQueuedGeneration } from '../lib/server/signal-generation';
import {
  startGenerationSandbox,
  pollGenerationSandbox,
  stopGenerationSandbox,
  type GenerationSandboxHandle,
} from '../lib/server/generation-sandbox';

// Only identifiers enter Workflow storage. Provider credentials and source text
// are loaded inside the step and never returned into its persisted event log.
export async function signalGenerationWorkflow(owner: string, id: string, queuedAt?: string) {
  'use workflow';
  for (let attempt = 0; attempt < 60; attempt++) {
    const handle = await runGenerationStep(owner, id, queuedAt);
    if (!handle) return 'already_started_or_finished';
    let status = 'running';
    for (let poll = 0; poll < 64; poll++) {
      await sleep('30s');
      try {
        status = await pollGenerationStep(handle);
      } catch {
        // Observability failure is not execution failure. The Sandbox still
        // owns its bounded lifetime; never kill a potentially paid response.
        continue;
      }
      if (status !== 'running') break;
    }
    if (status === 'running') return 'observation_unconfirmed';
    // Stop only after the command has positively reported an exit code.
    await stopGenerationStep(handle);
    // Only a worker's explicit pre-claim capacity rejection permits another launch.
    if (status !== 'busy') {
      await failQueuedStep(owner, id, queuedAt);
      return status;
    }
    await sleep('30s');
  }
  await failQueuedStep(owner, id, queuedAt);
  return 'queue_expired';
}

async function runGenerationStep(owner: string, id: string, queuedAt?: string) {
  'use step';
  try {
    return await startGenerationSandbox(owner, id, queuedAt);
  } catch {
    await failQueuedGeneration(owner, id, queuedAt);
    throw new Error('generation_dispatch_failed');
  }
}
runGenerationStep.maxRetries = 0;

async function pollGenerationStep(handle: GenerationSandboxHandle) {
  'use step';
  return pollGenerationSandbox(handle);
}
// Read-only polling may retry, but never starts a process or invokes AI.
pollGenerationStep.maxRetries = 3;

async function stopGenerationStep(handle: GenerationSandboxHandle) {
  'use step';
  await stopGenerationSandbox(handle).catch(() => undefined);
}
stopGenerationStep.maxRetries = 0;

async function failQueuedStep(owner: string, id: string, queuedAt?: string) {
  'use step';
  await failQueuedGeneration(owner, id, queuedAt);
}
failQueuedStep.maxRetries = 0;
