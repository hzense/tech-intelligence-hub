import { createGenerationHandler } from '@/lib/admin-signal-generation-handler';
import { getAdminOrigin, getAdminSession } from '@/lib/server/admin-auth';
import { start } from 'workflow/api';
import { signalGenerationWorkflow } from '@/workflows/signal-generation';
import { localSignalGenerationWorkflow } from '@/workflows/local-signal-generation';
import { isLocalDevelopment } from '@/lib/local-development';
import {
  generationDashboard,
  generationDetail,
  deleteGeneration,
  executeGeneration,
  failQueuedGeneration,
  inspectGenerationInput,
  queueGeneration,
  resolveQueuedGeneration,
} from '@/lib/server/signal-generation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Requests only admit/inspect tasks. Model work runs in a durable Workflow step.
export const maxDuration = 60;
export const GET = createGenerationHandler({
  session: getAdminSession,
  origin: () => getAdminOrigin() ?? undefined,
  dashboard: generationDashboard,
  detail: generationDetail,
  delete: deleteGeneration,
  execute: executeGeneration,
  inspectSource: inspectGenerationInput,
  resolveQueue: resolveQueuedGeneration,
  enqueue: async (owner, id) => {
    const run = await queueGeneration(owner, id);
    if (run.status === 'pending') {
      const queuedAt = new Date(run.progress_at!).toISOString();
      let workflow;
      try {
        workflow = isLocalDevelopment()
          ? await start(localSignalGenerationWorkflow, [owner, id, queuedAt])
          : await start(signalGenerationWorkflow, [owner, id, queuedAt]);
      } catch (error) {
        // If start was accepted but its acknowledgement was lost, the exact
        // queue fence protects any worker that has already claimed this task.
        await failQueuedGeneration(owner, id, queuedAt).catch(() => undefined);
        throw error;
      }
      console.info(
        JSON.stringify({
          event: 'signal_generation_dispatched',
          task_id: id,
          workflow_id: workflow.runId,
        }),
      );
    }
    return run;
  },
});
export const POST = GET;
