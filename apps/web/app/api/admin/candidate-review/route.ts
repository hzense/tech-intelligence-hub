import { createCandidateReviewHandler } from '@/lib/admin-candidate-review-handler';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { confirmPreparedReview, reviewDashboard } from '@/lib/server/candidate-review';
import { operateCandidateReview } from '@/lib/server/candidate-review-publication';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createCandidateReviewHandler({
  session: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin,
  read: reviewDashboard,
  confirm: confirmPreparedReview,
  operate: operateCandidateReview,
});
export const POST = GET;
