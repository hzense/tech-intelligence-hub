import { isLocalDevelopment } from '../lib/local-development';
import { executeGeneration, failQueuedGeneration } from '../lib/server/signal-generation';
import { runAutomaticPublicationStep } from './automatic-publication';

/** Uses Workflow's local filesystem world; only task identifiers enter its log. */
export async function localSignalGenerationWorkflow(owner: string, id: string, queuedAt: string) {
  'use workflow';
  const result = await runLocalGenerationStep(owner, id, queuedAt);
  if (result.status === 'completed') await runAutomaticPublicationStep(owner, id);
  return result;
}

async function runLocalGenerationStep(owner: string, id: string, queuedAt: string) {
  'use step';
  if (!isLocalDevelopment() || process.env.WORKFLOW_TARGET_WORLD !== 'local')
    throw new Error('local_development_unavailable');
  try {
    const result = await executeGeneration(owner, { action: 'run', id }, queuedAt);
    console.info(
      JSON.stringify({ event: 'local_generation_completed', task_id: id, status: result.status }),
    );
    return { status: result.status };
  } catch {
    await failQueuedGeneration(owner, id, queuedAt).catch(() => undefined);
    throw new Error('local_generation_failed');
  }
}
runLocalGenerationStep.maxRetries = 0;
