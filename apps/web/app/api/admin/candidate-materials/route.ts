import { createAdminMaterialHandler } from '@/lib/admin-material-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import {
  readMaterialDashboard,
  createMaterialRequest,
  inspectMaterialRequest,
  confirmMaterialRegistration,
  prepareCandidateMaterials,
  approveCandidateMaterials,
  enrichCandidateMaterials,
} from '@/lib/server/material-registration';
import {
  queueCandidateEnrichment,
  failQueuedCandidateEnrichment,
} from '@/lib/server/candidate-enrichment';
import { createMaterialEnrichmentDispatcher } from '@/lib/material-enrichment-dispatch';
import { start } from 'workflow/api';
import { candidateEnrichmentWorkflow } from '@/workflows/candidate-enrichment';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createAdminMaterialHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  read: readMaterialDashboard,
  create: createMaterialRequest,
  inspect: inspectMaterialRequest,
  confirm: confirmMaterialRegistration,
  prepare: prepareCandidateMaterials,
  approve: approveCandidateMaterials,
  enrich: createMaterialEnrichmentDispatcher({
    create: enrichCandidateMaterials,
    queue: queueCandidateEnrichment,
    start: (owner, id) => start(candidateEnrichmentWorkflow, [owner, id]),
    failQueued: failQueuedCandidateEnrichment,
  }),
});
export const POST = GET;
