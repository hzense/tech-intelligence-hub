import { TextEncoder } from 'node:util';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { parseImportOutput } from './import-task-contract.mjs';
import { isExcludedPublicPerson } from './person-resource-policy.mjs';
import { isGenerationValidationDetail } from './signal-generation-validation-diagnostics.mjs';

export const GENERATION_LIMITS = Object.freeze({
  inputTokens: 100000,
  // Independent storage/transport guards, not a token conversion ratio.
  sourceBytes: 1000000,
  outputBytes: 400000,
  candidates: 5,
  titleCharacters: 80,
  summaryCharacters: 500,
  references: 8,
  quoteCharacters: 500,
});
/** Shared local estimate; other providers may tokenize differently. Treat special tokens as text. */
export function estimateGenerationTokens(text) {
  return countTokens(text, { disallowedSpecial: new Set() });
}

function sourceSize(source) {
  const json = JSON.stringify(source);
  const sourceBytes = new TextEncoder().encode(json).length;
  const sourceTokens = estimateGenerationTokens(json);
  return {
    ready:
      sourceBytes <= GENERATION_LIMITS.sourceBytes && sourceTokens <= GENERATION_LIMITS.inputTokens,
    sourceBytes,
    sourceTokens,
    limitBytes: GENERATION_LIMITS.sourceBytes,
    limitTokens: GENERATION_LIMITS.inputTokens,
    tokenEncoding: 'o200k_base',
  };
}
export const REJECTED_CANDIDATES_REASON = '候选校验未全部通过；请查看逐条校验记录。';

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
              // Provider regex engines reject lookaround. Calendar validity and
              // year zero remain enforced by eventDate() after generation.
              { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
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
            // Enforce uniqueness in runtime validation; some providers reject uniqueItems.
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

function fail(code = 'invalid_generation_output', path, reason) {
  const error = new SignalGenerationError(code);
  if (path) error.diagnostic = { path, reason };
  throw error;
}

function record(value, keys, code, path) {
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
    fail(code, path, 'invalid_shape');
  return value;
}

function list(value, max, min = 0, code, path, missingReason = 'missing_items') {
  if (!Array.isArray(value)) fail(code, path, 'invalid_type');
  if (value.length < min) fail(code, path, missingReason);
  if (value.length > max) fail(code, path, 'too_many_items');
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, path, 'invalid_shape');
  }
  return value;
}

function string(value, max, code, path) {
  if (typeof value !== 'string') fail(code, path, 'invalid_type');
  if (!value.trim()) fail(code, path, 'missing_value');
  if ([...value].length > max) fail(code, path, 'text_too_long');
  if (
    [...value].some((char) => {
      const point = char.codePointAt(0);
      return (
        (point < 32 && ![9, 10, 13].includes(point)) ||
        point === 127 ||
        (point >= 0xd800 && point <= 0xdfff)
      );
    })
  )
    fail(code, path, 'invalid_characters');
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
  if (!sourceSize(source).ready) fail('generation_source_too_large');
  return source;
}

/** Read-only readiness metadata. Never returns source text or bypasses generation limits. */
export function inspectGenerationSource(importOutput) {
  const source = normalizeGenerationSource(importOutput);
  return {
    ...sourceSize(source),
    fragmentCount: source.fragments.length,
    locators: source.fragments.slice(0, 3).map(({ id, locator }) => ({ id, locator })),
  };
}

/** Structural validation only; each caller must enforce its own byte budget. */
export function normalizePrivateSource(source) {
  const code = 'invalid_generation_source';
  record(source, ['classification', 'fragments'], code);
  if (source.classification !== 'private') fail(code);
  const fragments = list(source.fragments, 10000, 1, code).map((fragment, index) => {
    record(fragment, ['id', 'text', 'locator'], code);
    if (fragment.id !== `fragment-${index + 1}`) fail(code);
    return { index, text: fragment.text, locator: fragment.locator };
  });
  return normalizeGenerationSource({ classification: 'private', fragments, warnings: [] });
}

export function validateGenerationSource(source) {
  const normalized = normalizePrivateSource(source);
  if (!sourceSize(normalized).ready) fail('generation_source_too_large');
  return normalized;
}

function references(value, fragments, min = 1, path) {
  const seen = new Set();
  return list(value, GENERATION_LIMITS.references, min, undefined, path, 'missing_evidence').map(
    (reference, index) => {
      const referencePath = `${path}[${index}]`;
      record(reference, ['fragment_id', 'quote'], undefined, referencePath);
      const id = string(reference.fragment_id, 30, undefined, `${referencePath}.fragment_id`);
      const quote = string(
        reference.quote,
        GENERATION_LIMITS.quoteCharacters,
        undefined,
        `${referencePath}.quote`,
      );
      const fragment = fragments.get(id);
      if (!fragment) fail(undefined, `${referencePath}.fragment_id`, 'unknown_fragment');
      if (!fragment.text.includes(quote))
        fail(undefined, `${referencePath}.quote`, 'quote_mismatch');
      const key = JSON.stringify([id, quote]);
      if (seen.has(key)) fail(undefined, referencePath, 'duplicate_reference');
      seen.add(key);
      return { fragment_id: id, quote };
    },
  );
}

function eventDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))
    fail(undefined, 'event_date', 'invalid_date');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    fail(undefined, 'event_date', 'invalid_date');
  return value;
}

/** Structural/quotation validation only: this does not establish factual or public eligibility. */
function normalizeCandidates(value, source, partial = false) {
  const validatedSource = validateGenerationSource(source);
  const fragments = new Map(validatedSource.fragments.map((fragment) => [fragment.id, fragment]));
  record(value, ['candidates', 'reason']);
  boundedBytes(value, GENERATION_LIMITS.outputBytes, 'generation_output_too_large');
  const reason = string(value.reason, 1000);
  const rejected = [];
  const candidates = list(value.candidates, GENERATION_LIMITS.candidates).map(
    (candidate, index) => {
      const errors = [];
      const check = (field, work, code = 'invalid_field') => {
        try {
          return work();
        } catch (error) {
          if (!partial || !(error instanceof SignalGenerationError)) throw error;
          const diagnostic = error.diagnostic;
          errors.push({
            field,
            code,
            ...(isGenerationValidationDetail(field, diagnostic?.path, diagnostic?.reason)
              ? diagnostic
              : {}),
          });
          return undefined;
        }
      };
      const reject = () => {
        rejected.push({ index, classification: 'private', status: 'rejected', errors });
        return null;
      };
      const shape = check(
        'candidate',
        () =>
          record(
            candidate,
            [
              'title',
              'summary',
              'event_date',
              'event_date_evidence',
              'persons',
              'organizations',
              'claims',
            ],
            undefined,
            'candidate',
          ),
        'invalid_candidate_shape',
      );
      if (!shape) return reject();
      const title = check(
        'title',
        () => string(candidate.title, GENERATION_LIMITS.titleCharacters, undefined, 'title'),
        typeof candidate.title === 'string' &&
          [...candidate.title].length > GENERATION_LIMITS.titleCharacters
          ? 'title_too_long'
          : 'invalid_field',
      );
      const summary = check(
        'summary',
        () => string(candidate.summary, GENERATION_LIMITS.summaryCharacters, undefined, 'summary'),
        typeof candidate.summary === 'string' &&
          [...candidate.summary].length > GENERATION_LIMITS.summaryCharacters
          ? 'summary_too_long'
          : 'invalid_field',
      );
      const event_date = check(
        'event_date',
        () => eventDate(candidate.event_date),
        'invalid_event_date',
      );
      const event_date_evidence = check(
        'event_date_evidence',
        () => {
          if (
            candidate.event_date === null &&
            Array.isArray(candidate.event_date_evidence) &&
            candidate.event_date_evidence.length
          )
            fail(undefined, 'event_date_evidence', 'unknown_date_has_evidence');
          return references(
            candidate.event_date_evidence,
            fragments,
            event_date === null ? 0 : 1,
            'event_date_evidence',
          );
        },
        candidate.event_date === null &&
          Array.isArray(candidate.event_date_evidence) &&
          candidate.event_date_evidence.length
          ? 'unknown_date_has_evidence'
          : 'invalid_evidence',
      );
      const persons = check('persons', () =>
        list(candidate.persons, 12, 0, undefined, 'persons')
          .map((person, index) => {
            const path = `persons[${index}]`;
            record(person, ['name', 'role', 'organization', 'evidence'], undefined, path);
            return {
              name: string(person.name, 150, undefined, `${path}.name`),
              role: string(person.role, 200, undefined, `${path}.role`),
              organization:
                person.organization === null
                  ? null
                  : string(person.organization, 200, undefined, `${path}.organization`),
              evidence: references(person.evidence, fragments, 1, `${path}.evidence`),
            };
          })
          .filter((person) => !isExcludedPublicPerson(person)),
      );
      const organizations = check('organizations', () => {
        const names = list(candidate.organizations, 12, 0, undefined, 'organizations').map(
          (name, index) => string(name, 200, undefined, `organizations[${index}]`),
        );
        const duplicateIndex = names.findIndex((name, index) => names.indexOf(name) !== index);
        if (duplicateIndex !== -1)
          fail(undefined, `organizations[${duplicateIndex}]`, 'duplicate_item');
        return names;
      });
      const claims = check('claims', () =>
        list(candidate.claims, 12, 1, undefined, 'claims').map((claim, index) => {
          const path = `claims[${index}]`;
          record(claim, ['text', 'evidence'], undefined, path);
          return {
            text: string(claim.text, 1200, undefined, `${path}.text`),
            evidence: references(claim.evidence, fragments, 1, `${path}.evidence`),
          };
        }),
      );
      if (errors.length) return reject();
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
  const result = {
    classification: 'private',
    candidates: candidates.filter(Boolean),
    reason: partial && rejected.length ? REJECTED_CANDIDATES_REASON : reason,
    ...(partial ? { validation_version: 1, rejected } : {}),
  };
  boundedBytes(result, GENERATION_LIMITS.outputBytes, 'generation_output_too_large');
  return result;
}

export function normalizeGeneratedCandidates(value, source) {
  return normalizeCandidates(value, source);
}

/** Reject candidates independently; diagnostics contain only server-owned codes, never raw output. */
export function assessGeneratedCandidates(value, source) {
  return normalizeCandidates(value, source, true);
}

/** Validate only the bounded envelope in the SDK; business validation runs after usage is captured. */
export function validateGenerationEnvelope(value) {
  record(value, ['candidates', 'reason']);
  string(value.reason, 1000);
  list(value.candidates, GENERATION_LIMITS.candidates);
  boundedBytes(value, GENERATION_LIMITS.outputBytes, 'generation_output_too_large');
  return value;
}
