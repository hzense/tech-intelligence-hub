import {
  normalizeMaterialPlan,
  type MaterialPlan,
} from '../../../packages/database/src/material-registration-contract.mjs';
import {
  validateCandidateSourceBundle,
  type CandidateSourceBundle,
} from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import type { MaterialCandidate } from './candidate-publication-materials';

const changed = (): never => {
  throw Object.assign(new Error('material_changed'), { code: 'material_changed' });
};
/** The verifier may add evidence and identities, never silently replace the original story. */
export function bindMaterialPlan(
  input: unknown,
  bundle: CandidateSourceBundle,
  identity: {
    owner: string;
    runId: string;
    candidateIndex: number;
    materialHash: string;
    candidate: MaterialCandidate;
    /** Server-only: owner-scoped original import URL, after its source hash matches the run. */
    originalSourceUrl?: string | null;
  },
) {
  const plan = normalizeMaterialPlan(input),
    source = validateCandidateSourceBundle(bundle);
  if (
    plan.owner !== identity.owner ||
    plan.runId !== identity.runId ||
    plan.candidateIndex !== identity.candidateIndex ||
    plan.baseMaterialHash !== identity.materialHash ||
    source.baseMaterialHash !== identity.materialHash ||
    plan.sourceBundleHash !== source.sourceBundleHash ||
    plan.candidate.title !== identity.candidate.title ||
    plan.candidate.summary !== identity.candidate.summary ||
    (identity.candidate.event_date !== null &&
      plan.candidate.eventDate !== identity.candidate.event_date) ||
    JSON.stringify(plan.candidate.claims.map((c) => c.text)) !==
      JSON.stringify(identity.candidate.claims.map((c) => c.text))
  )
    changed();
  const entities = new Map(plan.entities.map((entity) => [entity.id, entity]));
  // Existing names, event roles and known affiliations remain part of the locked story.
  for (const person of identity.candidate.persons) {
    if (
      !plan.candidate.persons.some(
        (proposed) =>
          entities.get(proposed.entityId)?.name === person.name &&
          proposed.role === person.role &&
          (person.organization === null ||
            (proposed.organizationId !== null &&
              entities.get(proposed.organizationId)?.name === person.organization)),
      )
    )
      changed();
  }
  for (const organization of identity.candidate.organizations) {
    if (!plan.candidate.organizationIds.some((id) => entities.get(id)?.name === organization))
      changed();
  }
  // The original source has no URL in bundle v1. Only the server may supply its
  // hash-checked import declaration; absence preserves the private-file boundary.
  for (const evidence of plan.evidence) {
    const found = source.source.fragments.some((fragment, index) => {
      const provenance = source.provenance[index];
      const sameSource =
        (provenance?.kind === 'supplement' && provenance.sourceUrl === evidence.sourceUrl) ||
        (provenance?.kind === 'original' && identity.originalSourceUrl === evidence.sourceUrl);
      return sameSource && fragment.text.includes(evidence.excerpt);
    });
    if (!found) changed();
  }
  return plan;
}
export function materialPlanCandidate(plan: MaterialPlan): MaterialCandidate {
  const entity = new Map(plan.entities.map((row) => [row.id, row]));
  const evidence = new Map(plan.evidence.map((row) => [row.id, row]));
  const refs = (ids: string[]) => ids.map((id) => ({ quote: evidence.get(id)!.excerpt }));
  return {
    title: plan.candidate.title,
    summary: plan.candidate.summary,
    event_date: plan.candidate.eventDate,
    event_date_evidence: [],
    persons: plan.candidate.persons.map((person) => ({
      name: entity.get(person.entityId)!.name,
      role: person.role,
      organization: person.organizationId ? entity.get(person.organizationId)!.name : null,
      evidence: refs(person.evidenceIds),
    })),
    organizations: plan.candidate.organizationIds.map((id) => entity.get(id)!.name),
    claims: plan.candidate.claims.map((claim) => ({
      text: claim.text,
      evidence: refs([claim.evidenceId]),
    })),
  };
}
