import { readFile, unlink } from 'node:fs/promises';
import { executeGeneration, failQueuedGeneration } from '../lib/server/signal-generation';
import {
  executeCandidateEnrichment,
  failQueuedCandidateEnrichment,
} from '../lib/server/candidate-enrichment';

// Trusted, build-pinned code only. Documents are data, never executable code.
// Secrets travel in a private file, not command arguments/logs or Workflow events.
async function main() {
  const path = '/vercel/sandbox/task.json';
  const { kind = 'signal-generation', owner, id, env } = JSON.parse(await readFile(path, 'utf8'));
  await unlink(path);
  Object.assign(process.env, env);
  try {
    if (kind === 'candidate-enrichment') await executeCandidateEnrichment(owner, id);
    else if (kind === 'signal-generation') await executeGeneration(owner, { action: 'run', id });
    else throw new Error('invalid_worker_kind');
    return 0;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'worker_busy')
      return 75; // No claim and no provider call: the queue may wait for capacity.
    await (
      kind === 'candidate-enrichment'
        ? failQueuedCandidateEnrichment(owner, id)
        : failQueuedGeneration(owner, id)
    ).catch(() => undefined);
    return 1;
  }
}
main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
