import 'server-only';
import {
  saveEditorialSignal,
  readEditorialSignal,
} from '../../../../packages/database/src/editorial-signal-store.mjs';
import { createEditorialReviewService } from '../editorial-review-service';
import { generationRecord } from './signal-generation';
import { buildCandidateReview, buildEnrichedCandidateReview } from '../candidate-review';
import { listCandidateEnrichmentDtos } from './candidate-enrichment';
import { materialPublicationPreview } from './material-registration';
import type { EditorialContent } from '../editorial-review';
import { editorialPool, editorialPublicationEnabled } from './editorial-database';
import { editorialTopicOptions } from './editorial-topics';

async function material(owner: string, runId: string, index: number) {
  const run = await generationRecord(owner, runId);
  const original = buildCandidateReview(run, index);
  let candidate = original.candidate;
  const warnings: string[] = [];
  try {
    const enrichments = await listCandidateEnrichmentDtos(
      owner,
      runId,
      index,
      original.materialHash,
    );
    const latest = enrichments.find(
      (row) => row.status === 'completed' && row.material_hash === original.materialHash,
    );
    if (latest?.result?.candidate)
      candidate = buildEnrichedCandidateReview(
        run,
        index,
        latest.result.candidate as Record<string, unknown>,
      ).candidate;
  } catch {
    warnings.push('历史 AI 补全暂不可读取，当前按原候选展示；可直接手动补充并确认。');
  }
  let prefill;
  try {
    prefill = (await materialPublicationPreview(owner, runId, index, original))?.editorialPrefill;
  } catch {
    warnings.push('历史补证提案暂不可读取；不影响手动填写四项信息。');
  }
  const content: EditorialContent = {
    title: original.candidate.title,
    summary: original.candidate.summary,
    eventDate: prefill?.eventDate ?? candidate.event_date,
    organizations: prefill?.organizations ?? [
      ...new Set([
        ...candidate.organizations,
        ...candidate.persons.flatMap((person) =>
          person.organization ? [person.organization] : [],
        ),
      ]),
    ],
    persons: prefill?.persons ?? candidate.persons.map((person) => person.name),
    topics: prefill?.topics ?? [],
    // Imported private documents and arbitrary input URLs are not made public
    // merely by entering four fields. Original evidence remains in the admin UI.
    sourceUrls: [],
  };
  return {
    materialHash: original.materialHash,
    content,
    warnings,
    // Supplemental selections (including an intentional empty list) take precedence.
    ...(prefill?.topics === undefined && original.candidate.topic_ids !== undefined
      ? { generatedTopicIds: original.candidate.topic_ids }
      : {}),
  };
}
const service = createEditorialReviewService({
  enabled: editorialPublicationEnabled,
  material,
  topics: editorialTopicOptions,
  read: (owner, runId, candidateIndex) =>
    readEditorialSignal({ pool: editorialPool, owner, runId, candidateIndex }),
  save: (owner, request, bound) =>
    saveEditorialSignal({ pool: editorialPool, owner, request, material: bound }),
});
export const editorialDashboard = service.read;
export const writeEditorialReview = service.write;
