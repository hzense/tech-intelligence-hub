import { z } from 'zod';

// Preserve original identifiers and text; validation must not silently trim claims.
const nonblank = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const verificationStatus = z.enum(['pending', 'verified', 'rejected']);
const affiliationType = z.enum(['works_at', 'leads', 'advises']);

/** A calendar date, never a timestamp or a capture-time substitute. */
export const affiliationDateSchema = z.string().refine((value) => {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}, 'Expected a valid YYYY-MM-DD date in years 0001 through 9999');

const periodFields = {
  valid_from: affiliationDateSchema.nullable(),
  valid_to: affiliationDateSchema.nullable(),
};

function validatePeriod(value: AffiliationPeriod, context: z.RefinementCtx): void {
  if (value.valid_from !== null && value.valid_to !== null && value.valid_from > value.valid_to) {
    context.addIssue({
      code: 'custom',
      path: ['valid_to'],
      message: 'valid_to precedes valid_from',
    });
  }
}

/** Inclusive known endpoints; null means unknown, not an unbounded interval. */
export const affiliationPeriodSchema = z.strictObject(periodFields).superRefine(validatePeriod);
export type AffiliationPeriod = z.infer<z.ZodObject<typeof periodFields>>;

/** Minimal typed entity projection; names never establish identity. */
export const affiliationEntitySchema = z.strictObject({
  id: nonblank,
  type: z.enum([
    'person',
    'company',
    'institution',
    'technology',
    'product',
    'model',
    'dataset',
    'standard_protocol',
    'paper',
    'event',
  ]),
});

/** Existing relations own dates. Other relation types are not promoted to affiliations. */
export const affiliationRelationSchema = z
  .strictObject({
    id: nonblank,
    source_id: nonblank,
    target_id: nonblank,
    relation_type: nonblank,
    ...periodFields,
  })
  .superRefine(validatePeriod);

export const personOrganizationAffiliationSchema = z.strictObject({
  relation_id: nonblank,
  person_id: nonblank,
  organization_id: nonblank,
  relation_type: affiliationType,
  role_title: nonblank,
  date_basis: nonblank,
  verification_status: verificationStatus,
});
export type PersonOrganizationAffiliation = z.infer<typeof personOrganizationAffiliationSchema>;

/** Status projection only: this module does not fetch or verify source contents. */
export const affiliationSourceEvidenceSchema = z.strictObject({
  id: nonblank,
  verification_status: verificationStatus,
});

export const affiliationEvidenceSchema = z.strictObject({
  relation_id: nonblank,
  evidence_id: nonblank,
  claim: nonblank,
  relation: z.enum(['supports', 'contradicts', 'context']),
  verification_status: verificationStatus,
});

function indexUnique<T>(
  rows: T[],
  key: (row: T) => string,
  collection: string,
  context: z.RefinementCtx,
): Map<string, T> {
  const result = new Map<string, T>();
  rows.forEach((row, index) => {
    const id = key(row);
    if (result.has(id)) {
      context.addIssue({
        code: 'custom',
        path: [collection, index],
        message: 'Duplicate identifier',
      });
    }
    result.set(id, row);
  });
  return result;
}

/**
 * Strict, in-memory structural validation. Pending records and missing evidence
 * are allowed for later review; a successful parse never grants publication.
 */
export const affiliationCatalogSchema = z
  .strictObject({
    entities: z.array(affiliationEntitySchema),
    relations: z.array(affiliationRelationSchema),
    affiliations: z.array(personOrganizationAffiliationSchema),
    public_source_evidence: z.array(affiliationSourceEvidenceSchema),
    affiliation_evidence: z.array(affiliationEvidenceSchema),
  })
  .superRefine((catalog, context) => {
    const entities = indexUnique(catalog.entities, (row) => row.id, 'entities', context);
    const relations = indexUnique(catalog.relations, (row) => row.id, 'relations', context);
    const affiliations = indexUnique(
      catalog.affiliations,
      (row) => row.relation_id,
      'affiliations',
      context,
    );
    const evidence = indexUnique(
      catalog.public_source_evidence,
      (row) => row.id,
      'public_source_evidence',
      context,
    );
    indexUnique(
      catalog.affiliation_evidence,
      (row) => JSON.stringify([row.relation_id, row.evidence_id]),
      'affiliation_evidence',
      context,
    );
    const issue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };

    catalog.relations.forEach((row, index) => {
      for (const field of ['source_id', 'target_id'] as const) {
        if (!entities.has(row[field])) {
          issue(['relations', index, field], 'Unknown entity');
        }
      }
    });
    catalog.affiliations.forEach((row, index) => {
      const path = ['affiliations', index];
      const relation = relations.get(row.relation_id);
      if (!relation) {
        issue([...path, 'relation_id'], 'Unknown relation');
      } else if (
        relation.source_id !== row.person_id ||
        relation.target_id !== row.organization_id ||
        relation.relation_type !== row.relation_type
      ) {
        issue([...path, 'relation_id'], 'Affiliation must match relation direction and type');
      }
      if (entities.get(row.person_id)?.type !== 'person') {
        issue([...path, 'person_id'], 'Expected a known person entity');
      }
      if (!['company', 'institution'].includes(entities.get(row.organization_id)?.type ?? '')) {
        issue([...path, 'organization_id'], 'Expected a known company or institution entity');
      }
    });
    catalog.affiliation_evidence.forEach((row, index) => {
      if (!affiliations.has(row.relation_id)) {
        issue(['affiliation_evidence', index, 'relation_id'], 'Unknown affiliation');
      }
      if (!evidence.has(row.evidence_id)) {
        issue(['affiliation_evidence', index, 'evidence_id'], 'Unknown public source evidence');
      }
    });
  });

export type AffiliationCatalog = z.infer<typeof affiliationCatalogSchema>;

export function parseAffiliationCatalog(input: unknown): AffiliationCatalog {
  return affiliationCatalogSchema.parse(input);
}

export type AffiliationPeriodClassification = 'within' | 'outside' | 'unknown';

/** Classify recorded dates only, independently of evidence or publication status. */
export function classifyAffiliationPeriod(
  input: AffiliationPeriod,
  on: string,
): AffiliationPeriodClassification {
  const { valid_from: from, valid_to: to } = affiliationPeriodSchema.parse(input);
  const date = affiliationDateSchema.parse(on);
  if ((from !== null && date < from) || (to !== null && date > to)) return 'outside';
  if (date === from || date === to || (from !== null && to !== null)) return 'within';
  return 'unknown';
}

export type AffiliationEvidenceAssessment = 'supported' | 'pending' | 'conflicted' | 'rejected';

/**
 * Conservatively assess recorded review statuses, not original facts. An active
 * contradiction is unresolved, not proof of falsity. Neither this result nor a
 * known time interval grants public eligibility or infers a current employer.
 */
export function assessAffiliationEvidence(
  input: unknown,
  relationId: string,
): AffiliationEvidenceAssessment {
  const catalog = parseAffiliationCatalog(input);
  const id = nonblank.parse(relationId);
  const affiliation = catalog.affiliations.find((row) => row.relation_id === id);
  if (!affiliation) throw new Error(`Unknown affiliation: ${id}`);
  if (affiliation.verification_status === 'rejected') return 'rejected';

  const evidence = new Map(catalog.public_source_evidence.map((row) => [row.id, row]));
  const links = catalog.affiliation_evidence.filter((row) => row.relation_id === id);
  if (
    links.some(
      (row) =>
        row.relation === 'contradicts' &&
        row.verification_status !== 'rejected' &&
        evidence.get(row.evidence_id)?.verification_status !== 'rejected',
    )
  ) {
    return 'conflicted';
  }
  if (
    affiliation.verification_status === 'verified' &&
    links.some(
      (row) =>
        row.relation === 'supports' &&
        row.verification_status === 'verified' &&
        evidence.get(row.evidence_id)?.verification_status === 'verified',
    )
  ) {
    return 'supported';
  }
  return 'pending';
}
