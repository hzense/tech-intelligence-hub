import { materialPlanHash } from '../../../packages/database/src/material-registration-contract.mjs';
import type { MaterialReviewDossier } from '../../../packages/database/src/material-verification-worker.mjs';
import { materialReviewStatements, type MaterialDraft } from './material-plan-preparation.ts';

export function approvedMaterialDossier(
  payload: MaterialDraft,
  approval: {
    owner_id: string;
    approved_by: string;
    created_at: Date | string;
  },
): MaterialReviewDossier {
  const plan = payload.plan,
    draft = payload.dossier;
  if (
    approval.owner_id !== plan.owner ||
    approval.approved_by !== plan.owner ||
    draft.version !== 'material-review-draft-v1' ||
    draft.planHash !== materialPlanHash(plan) ||
    draft.sourceBundleHash !== plan.sourceBundleHash ||
    Object.keys(draft.statements).length !== Object.keys(materialReviewStatements).length ||
    Object.entries(materialReviewStatements).some(
      ([key, value]) => draft.statements[key as keyof typeof materialReviewStatements] !== value,
    )
  )
    throw Object.assign(new Error('material_changed'), { code: 'material_changed' });
  const approvedAt = new Date(approval.created_at).toISOString();
  return {
    version: 'reviewed-material-dossier-v1',
    requestId: draft.requestId,
    planHash: draft.planHash,
    sourceBundleHash: draft.sourceBundleHash,
    approvedBy: approval.approved_by,
    approvedAt,
    expiresAt: new Date(Date.parse(approvedAt) + 24 * 60 * 60 * 1000).toISOString(),
    checks: Object.fromEntries(
      Object.entries(materialReviewStatements).map(([key, rationale]) => [
        key,
        { approved: true, rationale },
      ]),
    ) as MaterialReviewDossier['checks'],
    sources: [...new Set(plan.evidence.map((e) => e.sourceUrl))].map((sourceUrl) => ({
      sourceUrl,
      excerptHashes: [
        ...new Set(
          plan.evidence.filter((e) => e.sourceUrl === sourceUrl).map((e) => e.contentHash),
        ),
      ],
      authenticity: { approved: true, rationale: materialReviewStatements.sourceAuthenticity },
      usageRights: {
        approved: true,
        rationale: materialReviewStatements.usageRights,
        basis:
          '候选所有者针对页面逐项展示的来源 URL 与原文摘录确认具有公开引用权限；仅适用于本提案列出的摘录，不是对整站或其他材料的授权。',
      },
    })),
    eventDate: { ...draft.eventDate, rationale: materialReviewStatements.eventRelevance },
  };
}
