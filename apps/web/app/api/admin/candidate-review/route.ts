import { createCandidateReviewHandler } from '@/lib/admin-candidate-review-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { confirmPreparedReview, reviewDashboard } from '@/lib/server/candidate-review';
import { operateCandidateReview } from '@/lib/server/candidate-review-publication';
import {
  createCandidateEnrichment,
  queueCandidateEnrichment,
} from '@/lib/server/candidate-enrichment';
import { start } from 'workflow/api';
import { candidateEnrichmentWorkflow } from '@/workflows/candidate-enrichment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createCandidateReviewHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  read: reviewDashboard,
  confirm: confirmPreparedReview,
  enrich: async (owner, request) => {
    const created = await createCandidateEnrichment(owner, request);
    const queued = await queueCandidateEnrichment(owner, created.id);
    if (queued.status === 'pending') {
      const workflow = await start(candidateEnrichmentWorkflow, [owner, queued.id]);
      console.info(
        JSON.stringify({
          event: 'candidate_enrichment_dispatched',
          task_id: queued.id,
          workflow_id: workflow.runId,
        }),
      );
    }
    return queued;
  },
  operate: operateCandidateReview,
});
export const POST = GET;
