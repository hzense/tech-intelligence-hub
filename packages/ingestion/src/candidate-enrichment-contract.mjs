import { TextEncoder } from 'node:util';
import {
  GENERATION_LIMITS,
  normalizeGeneratedCandidates,
  validateGenerationSource,
} from './signal-generation-contract.mjs';

const referenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fragment_id', 'quote'],
  properties: {
    fragment_id: { type: 'string', minLength: 1, maxLength: 30 },
    quote: { type: 'string', minLength: 1, maxLength: GENERATION_LIMITS.quoteCharacters },
  },
};
const referencesSchema = { type: 'array', maxItems: 8, items: referenceSchema };

export const candidateEnrichmentJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['event_date', 'event_date_evidence', 'persons', 'organizations'],
  properties: {
    event_date: {
      anyOf: [{ type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }, { type: 'null' }],
    },
    event_date_evidence: referencesSchema,
    persons: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'organization', 'evidence'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          role: { type: 'string', minLength: 1, maxLength: 200 },
          organization: {
            anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
          },
          evidence: { ...referencesSchema, minItems: 1 },
        },
      },
    },
    organizations: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
});

export class CandidateEnrichmentError extends Error {
  constructor(code = 'invalid_enrichment_output') {
    super(code);
    this.name = 'CandidateEnrichmentError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new CandidateEnrichmentError(code);
};

function plainRecord(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) => !keys.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key)),
    )
  )
    fail('invalid_enrichment_output');
  return value;
}

/**
 * Bind model proposals to the immutable candidate and source snapshot. The model
 * may only propose event/person/organization fields; title, summary and claims
 * always remain byte-for-byte derived from the saved candidate.
 */
export function assessCandidateEnrichment(value, candidate, source) {
  try {
    plainRecord(value, ['event_date', 'event_date_evidence', 'persons', 'organizations']);
    const validatedSource = validateGenerationSource(source);
    const original = plainRecord(candidate, [
      'index',
      'title',
      'summary',
      'event_date',
      'event_date_evidence',
      'persons',
      'organizations',
      'claims',
      'classification',
      'status',
      'issues',
    ]);
    if (
      original.classification !== 'private' ||
      original.status !== 'needs_review' ||
      !Number.isInteger(original.index) ||
      original.index < 0 ||
      original.index > 4
    )
      fail('invalid_enrichment_candidate');
    const merged = {
      title: original.title,
      summary: original.summary,
      event_date: original.event_date ?? value.event_date,
      event_date_evidence:
        original.event_date === null ? value.event_date_evidence : original.event_date_evidence,
      persons: original.persons.length ? original.persons : value.persons,
      organizations: [...new Set([...original.organizations, ...value.organizations])],
      claims: original.claims,
    };
    const normalized = normalizeGeneratedCandidates(
      { candidates: [merged], reason: '私有补全提案，待管理员审核。' },
      validatedSource,
    ).candidates[0];
    if (!normalized) fail('invalid_enrichment_output');
    const sourceText = validatedSource.fragments.map((fragment) => fragment.text).join('\n');
    for (const organization of normalized.organizations)
      if (!sourceText.includes(organization)) fail('invalid_enrichment_output');
    for (const person of normalized.persons) {
      const quoted = person.evidence.map((reference) => reference.quote).join('\n');
      if (
        !quoted.includes(person.name) ||
        !quoted.includes(person.role) ||
        (person.organization !== null && !quoted.includes(person.organization))
      )
        fail('invalid_enrichment_output');
    }
    const result = {
      classification: 'private',
      validation_version: 1,
      candidate: { ...normalized, index: original.index },
    };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 128000)
      fail('enrichment_output_too_large');
    return result;
  } catch (error) {
    if (error instanceof CandidateEnrichmentError) throw error;
    fail('invalid_enrichment_output');
  }
}
