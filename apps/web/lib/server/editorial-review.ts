import 'server-only';
import { unifiedSignalEnabled } from '../unified-signal-mode';
import {
  saveEditorialSignal,
  readEditorialSignal,
  previewEditorialResources,
} from '../../../../packages/database/src/editorial-signal-store.mjs';
import { createEditorialReviewService } from '../editorial-review-service';
import { generationRecord } from './signal-generation';
import { buildCandidateReview, buildEnrichedCandidateReview } from '../candidate-review';
import { listCandidateEnrichmentDtos } from './candidate-enrichment';
import { materialPublicationPreview } from './material-registration';
import type { EditorialContent } from '../editorial-review';
import {
  editorialPool,
  editorialPublicationEnabled,
  editorialResourcePublicationReady,
} from './editorial-database';
import { candidateReviewPool } from './candidate-review-database';
import { editorialTopicOptions } from './editorial-topics';
import { importPool } from './generation-import-reader';
import { readMaterialSupplement } from '../material-source-reader';
import { readEditorialSourceOptions } from '../editorial-source-options';
import { getResourceEntries } from '../seed-runtime';

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
    warnings.push('历史补证提案暂不可读取；不影响手动补充发布信息。');
  }
  const content: EditorialContent = {
    title: original.candidate.title,
    summary: original.candidate.summary,
    eventDate: prefill?.eventDate ?? candidate.event_date,
    signalType: original.candidate.signal_type ?? null,
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
    // Private import URLs are offered separately and require explicit public selection.
    sourceUrls: [],
  };
  const resources = prefill?.resources ?? candidate.resources ?? original.candidate.resources;
  if (resources !== undefined) {
    content.resources = resources.map((resource) => ({ ...resource, entity_id: null }));
    content.organizations = resources
      .filter((resource) => resource.type !== 'person')
      .map((resource) => resource.name);
    content.persons = resources
      .filter((resource) => resource.type === 'person')
      .map((resource) => resource.name);
  }
  const originalSourceOptions = await readEditorialSourceOptions(owner, run, (o, b, i) =>
    readMaterialSupplement(importPool, o, b, i),
  );
  const resourceSourceOptions =
    resources === undefined
      ? undefined
      : prefill?.resources !== undefined
        ? (prefill.resourceSourceOptions ?? [])
        : resources.map((resource) => ({
            name: resource.name,
            type: resource.type,
            sourceUrls: originalSourceOptions,
          }));
  return {
    materialHash: original.materialHash,
    content,
    warnings,
    sourceOptions: [...new Set([...originalSourceOptions, ...(prefill?.sourceOptions ?? [])])],
    ...(resources === undefined
      ? {}
      : {
          resources,
          resourceSourceOptions: resourceSourceOptions ?? [],
          resourceCatalog: (await getResourceEntries()).filter(
            (resource) =>
              resource.type === 'person' ||
              resource.type === 'company' ||
              resource.type === 'institution',
          ),
        }),
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
    saveEditorialSignal({
      pool: editorialPool,
      owner,
      request,
      material: bound,
      unified: unifiedSignalEnabled(process.env),
    }),
  resources: (resources, catalog) =>
    previewEditorialResources({ pool: candidateReviewPool, resources, catalog }),
  resourcePublicationReady: editorialResourcePublicationReady,
});
export const editorialDashboard = service.read;
export const writeEditorialReview = service.write;
