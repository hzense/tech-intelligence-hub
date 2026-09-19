import { TextEncoder } from 'node:util';
import { parseImportOutput } from './import-task-contract.mjs';

export const GENERATION_LIMITS = Object.freeze({
  sourceBytes: 48000,
  outputBytes: 96000,
  candidates: 5,
  titleCharacters: 50,
  summaryCharacters: 500,
  references: 8,
  quoteCharacters: 500,
});

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
export const generationCandidateJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['candidates', 'reason'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: GENERATION_LIMITS.candidates,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'summary',
          'event_date',
          'event_date_evidence',
          'persons',
          'organizations',
          'claims',
        ],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: GENERATION_LIMITS.titleCharacters },
          summary: { type: 'string', minLength: 1, maxLength: GENERATION_LIMITS.summaryCharacters },
          event_date: {
            anyOf: [
              { type: 'string', pattern: '^(?!0000)\\d{4}-\\d{2}-\\d{2}$' },
              { type: 'null' },
            ],
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
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          claims: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'evidence'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 1200 },
                evidence: { ...referencesSchema, minItems: 1 },
              },
            },
          },
        },
      },
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
});

export class SignalGenerationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code = 'invalid_generation_output') {
  throw new SignalGenerationError(code);
}

function record(value, keys, code) {
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
    fail(code);
  return value;
}

function list(value, max, min = 0, code) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code);
  }
  return value;
}

function string(value, max, code) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > max ||
    [...value].some((char) => {
      const point = char.codePointAt(0);
      return (
        (point < 32 && ![9, 10, 13].includes(point)) ||
        point === 127 ||
        (point >= 0xd800 && point <= 0xdfff)
      );
    })
  )
    fail(code);
  return value;
}

function boundedBytes(value, maximum, code) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > maximum) fail(code);
}

/** Source IDs and classification are server-owned; no filenames or URLs are added. */
function normalizeGenerationSource(importOutput) {
  const code = 'invalid_generation_source';
  record(importOutput, ['classification', 'fragments', 'warnings'], code);
  if (importOutput.classification !== 'private') fail(code);
  const rawFragments = list(importOutput.fragments, 10000, 1, code).map((fragment, index) => {
    record(fragment, ['index', 'text', 'locator'], code);
    if (fragment.index !== index) fail(code);
    return { text: fragment.text, locator: fragment.locator };
  });
  let validated;
  try {
    validated = parseImportOutput({ fragments: rawFragments, warnings: importOutput.warnings });
  } catch {
    fail(code);
  }
  const source = {
    classification: 'private',
    fragments: validated.fragments.map(({ text, locator }, index) => ({
      id: `fragment-${index + 1}`,
      text: string(text, 20000, code),
      locator,
    })),
  };
  return source;
}

export function buildGenerationSource(importOutput) {
  const source = normalizeGenerationSource(importOutput);
  boundedBytes(source, GENERATION_LIMITS.sourceBytes, 'generation_source_too_large');
  return source;
}

/** Read-only readiness metadata. Never returns source text or bypasses generation limits. */
export function inspectGenerationSource(importOutput) {
  const source = normalizeGenerationSource(importOutput);
  const sourceBytes = new TextEncoder().encode(JSON.stringify(source)).length;
  return {
    ready: sourceBytes <= GENERATION_LIMITS.sourceBytes,
    sourceBytes,
    limitBytes: GENERATION_LIMITS.sourceBytes,
    fragmentCount: source.fragments.length,
    locators: source.fragments.slice(0, 3).map(({ id, locator }) => ({ id, locator })),
  };
}

export function validateGenerationSource(source) {
  const code = 'invalid_generation_source';
  record(source, ['classification', 'fragments'], code);
  if (source.classification !== 'private') fail(code);
  const fragments = list(source.fragments, 10000, 1, code).map((fragment, index) => {
    record(fragment, ['id', 'text', 'locator'], code);
    if (fragment.id !== `fragment-${index + 1}`) fail(code);
    return { index, text: fragment.text, locator: fragment.locator };
  });
  return buildGenerationSource({ classification: 'private', fragments, warnings: [] });
}

function references(value, fragments, min = 1) {
  const seen = new Set();
  return list(value, GENERATION_LIMITS.references, min).map((reference) => {
    record(reference, ['fragment_id', 'quote']);
    const id = string(reference.fragment_id, 30);
    const quote = string(reference.quote, GENERATION_LIMITS.quoteCharacters);
    const fragment = fragments.get(id);
    if (!fragment || !fragment.text.includes(quote)) fail();
    const key = JSON.stringify([id, quote]);
    if (seen.has(key)) fail();
    seen.add(key);
    return { fragment_id: id, quote };
  });
}

function eventDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) fail();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail();
  return value;
}

/** Structural/quotation validation only: this does not establish factual or public eligibility. */
export function normalizeGeneratedCandidates(value, source) {
  const validatedSource = validateGenerationSource(source);
  const fragments = new Map(validatedSource.fragments.map((fragment) => [fragment.id, fragment]));
  record(value, ['candidates', 'reason']);
  const reason = string(value.reason, 1000);
  const candidates = list(value.candidates, GENERATION_LIMITS.candidates).map(
    (candidate, index) => {
      record(candidate, [
        'title',
        'summary',
        'event_date',
        'event_date_evidence',
        'persons',
        'organizations',
        'claims',
      ]);
      const title = string(candidate.title, GENERATION_LIMITS.titleCharacters);
      const summary = string(candidate.summary, GENERATION_LIMITS.summaryCharacters);
      const event_date = eventDate(candidate.event_date);
      const event_date_evidence = references(
        candidate.event_date_evidence,
        fragments,
        event_date === null ? 0 : 1,
      );
      if (event_date === null && event_date_evidence.length) fail();
      const persons = list(candidate.persons, 12).map((person) => {
        record(person, ['name', 'role', 'organization', 'evidence']);
        return {
          name: string(person.name, 150),
          role: string(person.role, 200),
          organization: person.organization === null ? null : string(person.organization, 200),
          evidence: references(person.evidence, fragments),
        };
      });
      const organizations = list(candidate.organizations, 12).map((name) => string(name, 200));
      if (new Set(organizations).size !== organizations.length) fail();
      const claims = list(candidate.claims, 12, 1).map((claim) => {
        record(claim, ['text', 'evidence']);
        return { text: string(claim.text, 1200), evidence: references(claim.evidence, fragments) };
      });
      const issues = ['needs_public_evidence'];
      if (!persons.length) issues.push('needs_person_evidence');
      if (event_date === null) issues.push('needs_event_time');
      return {
        index,
        title,
        summary,
        event_date,
        event_date_evidence,
        persons,
        organizations,
        claims,
        classification: 'private',
        status: 'needs_review',
        issues,
      };
    },
  );
  const result = { classification: 'private', candidates, reason };
  boundedBytes(result, GENERATION_LIMITS.outputBytes, 'generation_output_too_large');
  return result;
}
