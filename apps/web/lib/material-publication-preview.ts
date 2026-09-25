import type { GeneratedCandidate } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import type { CandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { restoreMaterialEnrichment, type MaterialEnrichmentContext } from './material-enrichment';
import {
  buildPublicationMaterials,
  type PublicationMaterials,
} from './candidate-publication-materials';

export type MaterialPublicationPreview = {
  requestId: string;
  taskId: string;
  materials: PublicationMaterials;
};

/** Display only. Never supplies a review draft, preparation hash or publication permission. */
export function buildMaterialPublicationPreview(
  bundle: CandidateSourceBundle,
  original: GeneratedCandidate,
  result: Record<string, unknown>,
  context: MaterialEnrichmentContext,
): PublicationMaterials {
  const { candidate, hints } = restoreMaterialEnrichment(bundle, original, result, context);
  const materials = buildPublicationMaterials(
    candidate,
    { people: [], organizations: [], evidence: [], topics: [] },
    [],
  );
  for (const item of materials.items) {
    if (item.key === 'topics') {
      if (!hints.topicIds.length) continue;
      item.proposed = hints.topicIds
        .map((id) => `${context.topics.find((topic) => topic.id === id)!.title}（${id}）`)
        .join('、');
      item.status = 'proposed';
      item.nextStep = '已选择启用领域，待人工确认、独立核验及登记；尚未成为正式分类关联。';
    } else if (item.key.startsWith('organization:')) {
      const identity = hints.organizations.find((row) => `organization:${row.name}` === item.key);
      item.status = 'proposed';
      item.references = identity?.evidence ?? item.references;
      item.nextStep = identity
        ? `组织类型提案：${identity.type === 'company' ? '公司' : '机构'}。待核验、登记正式实体。`
        : '已提取组织名称；组织类型依据仍缺失，需核对已有档案或补充来源，再核验登记。';
    } else if (
      item.key !== 'person:missing' &&
      (item.references.length || (item.key === 'event_date' && candidate.event_date))
    ) {
      item.status = 'proposed';
      item.nextStep = item.key.startsWith('claim:')
        ? '已补充原文引用；公开来源、使用许可及事实仍待独立核验，未登记为公开证据。'
        : '已补全原文依据；待人工确认、独立核验及正式登记。';
    }
  }
  return materials;
}
