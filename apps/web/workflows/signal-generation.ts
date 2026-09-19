import { sleep } from 'workflow';
import { executeGeneration, failQueuedGeneration } from '../lib/server/signal-generation';

// Only identifiers enter Workflow storage. Provider credentials and source text
// are loaded inside the step and never returned into its persisted event log.
export async function signalGenerationWorkflow(owner: string, id: string) {
  'use workflow';
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await runGenerationStep(owner, id);
    if (status !== 'busy') return status;
    await sleep('30s');
  }
  await failQueuedStep(owner, id);
  return 'queue_expired';
}

async function runGenerationStep(owner: string, id: string) {
  'use step';
  try {
    const run = await executeGeneration(owner, { action: 'run', id });
    return run.status;
  } catch (error) {
    // Waiting for capacity is safe only because no provider call has been admitted.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'worker_busy')
      return 'busy';
    await failQueuedGeneration(owner, id);
    return 'failed';
  }
}
runGenerationStep.maxRetries = 0;

async function failQueuedStep(owner: string, id: string) {
  'use step';
  await failQueuedGeneration(owner, id);
}
failQueuedStep.maxRetries = 0;
