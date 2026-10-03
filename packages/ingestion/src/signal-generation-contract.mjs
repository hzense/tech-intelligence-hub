import { TextEncoder } from 'node:util';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { parseImportOutput } from './import-task-contract.mjs';
import { isExcludedPublicPerson } from './person-resource-policy.mjs';
import { isGenerationValidationDetail } from './signal-generation-validation-diagnostics.mjs';
import { SIGNAL_TYPES } from './signal-types.mjs';
export { SIGNAL_TYPES } from './signal-types.mjs';

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
  description: '一条来自本次 untrusted_source 的逐字原文证据，必须同时填写片段编号和引文。',
  additionalProperties: false,
  required: ['fragment_id', 'quote'],
  properties: {
    fragment_id: {
      type: 'string',
      minLength: 1,
      maxLength: 30,
      description:
        '使用本次输入 fragments 中真实存在的 id，例如 fragment-1；不要填写网址或自编编号。',
    },
    quote: {
      type: 'string',
      minLength: 1,
      maxLength: GENERATION_LIMITS.quoteCharacters,
      description:
        '从对应片段 text 连续逐字复制的非空短引，保留原语言、大小写和标点；不要翻译、改写或加省略号。',
    },
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
      description:
        '仅保留有原文主张证据的技术事件；没有可支持的主张时返回 []，不要生成无证据候选。',
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
            description:
              '事件实际发生的 YYYY-MM-DD 日期，不是默认采用文章发布日期。需由原文及上下文支持完整年月日；无法确定则为 null。',
            anyOf: [
              // Provider regex engines reject lookaround. Calendar validity and
              // year zero remain enforced by eventDate() after generation.
              { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
              { type: 'null' },
            ],
          },
          event_date_evidence: {
            ...referencesSchema,
            description:
              'event_date 非 null 时必须至少 1 条逐字原文证据，支持事件日期的年月日；若年份来自另一处上下文，一并引用。只有 event_date 为 null 时才允许 []。',
          },
          persons: {
            type: 'array',
            description:
              '只列有原文证据的事件参与人物。没有证据则返回 []；不得保留 evidence 为空的人物。',
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
                evidence: {
                  ...referencesSchema,
                  minItems: 1,
                  description:
                    '每个人物必须至少 1 条逐字原文证据，支持姓名、角色以及填写的所属组织；不得返回 []。无依据时从 persons 中省略该人物。',
                },
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
            description:
              '每条候选必须至少 1 条有原文证据的核心事实主张；没有可支持主张时省略整条候选。',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'evidence'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 1200 },
                evidence: {
                  ...referencesSchema,
                  minItems: 1,
                  description:
                    '每条主张必须至少 1 条支持该主张的逐字原文证据；不得返回 []。无依据时省略该主张，全部主张无依据时省略整条候选。',
                },
              },
            },
          },
        },
      },
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
});

// Legacy tasks keep their original schema and candidate material. New tasks pin
// the selectable catalog in their snapshot and require an explicit selection.
const legacyCandidateSchema = generationCandidateJsonSchema.properties.candidates.items;
export const generationCandidateWithTopicsJsonSchema = Object.freeze({
  ...generationCandidateJsonSchema,
  properties: {
    ...generationCandidateJsonSchema.properties,
    candidates: {
      ...generationCandidateJsonSchema.properties.candidates,
      items: {
        ...legacyCandidateSchema,
        required: [...legacyCandidateSchema.required, 'topic_ids'],
        properties: {
          ...legacyCandidateSchema.properties,
          topic_ids: {
            type: 'array',
            description:
              '从本次已启用领域目录中选择最相关的领域 ID，最多 5 项且不得重复；无合适领域时返回 []。不得自行创造领域或填写领域名称。',
            maxItems: 5,
            items: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
  },
});

export const GENERATION_METADATA_CONTRACT = 'signal-metadata-v1';
const topicCandidateSchema = generationCandidateWithTopicsJsonSchema.properties.candidates.items;
export const generationCandidateWithMetadataJsonSchema = Object.freeze({
  ...generationCandidateWithTopicsJsonSchema,
  properties: {
    ...generationCandidateWithTopicsJsonSchema.properties,
    candidates: {
      ...generationCandidateWithTopicsJsonSchema.properties.candidates,
      items: {
        ...topicCandidateSchema,
        required: [...topicCandidateSchema.required, 'signal_type'],
        properties: {
          ...topicCandidateSchema.properties,
          signal_type: {
            type: 'string',
            enum: SIGNAL_TYPES,
            description: '选择最能描述事件本身的一种事件类型；与 topic_ids 技术领域分别填写。',
          },
        },
      },
    },
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

/** A server-owned catalog, pinned with the request; never silently truncate it. */
export function normalizeGenerationTopics(value) {
  const code = 'invalid_generation_topics';
  const seen = new Set();
  return list(value, 1000, 0, code).map((topic) => {
    record(topic, ['id', 'title'], code);
    const id = string(topic.id, 100, code);
    const title = string(topic.title, 200, code);
    if (id !== id.trim() || title !== title.trim() || seen.has(id)) fail(code);
    seen.add(id);
    return { id, title };
  });
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
function normalizeCandidates(value, source, partial = false, topics, outputContract) {
  if (outputContract !== undefined && outputContract !== GENERATION_METADATA_CONTRACT)
    fail('invalid_generation_output');
  const topicIds =
    topics === undefined
      ? undefined
      : new Set(normalizeGenerationTopics(topics).map(({ id }) => id));
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
              ...(outputContract === GENERATION_METADATA_CONTRACT ? ['signal_type'] : []),
              ...(topicIds !== undefined || (candidate && Object.hasOwn(candidate, 'topic_ids'))
                ? ['topic_ids']
                : []),
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
      const signal_type =
        outputContract === GENERATION_METADATA_CONTRACT
          ? check('signal_type', () => {
              if (!SIGNAL_TYPES.includes(candidate.signal_type))
                fail(undefined, 'signal_type', 'invalid_type');
              return candidate.signal_type;
            })
          : undefined;
      const hasTopics = Object.hasOwn(candidate, 'topic_ids');
      const topic_ids = hasTopics
        ? check('topic_ids', () => {
            const ids = list(candidate.topic_ids, 5, 0, undefined, 'topic_ids').map((id, index) => {
              const path = `topic_ids[${index}]`;
              const normalized = string(id, 100, undefined, path);
              if (normalized !== normalized.trim()) fail(undefined, path, 'invalid_characters');
              if (topicIds !== undefined && !topicIds.has(normalized))
                fail(undefined, path, 'unknown_topic');
              return normalized;
            });
            const duplicateIndex = ids.findIndex((id, index) => ids.indexOf(id) !== index);
            if (duplicateIndex !== -1)
              fail(undefined, `topic_ids[${duplicateIndex}]`, 'duplicate_item');
            return ids;
          })
        : undefined;
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
        ...(outputContract === GENERATION_METADATA_CONTRACT ? { signal_type } : {}),
        ...(hasTopics ? { topic_ids } : {}),
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

export function normalizeGeneratedCandidates(value, source, topics, outputContract) {
  return normalizeCandidates(value, source, false, topics, outputContract);
}

/** Reject candidates independently; diagnostics contain only server-owned codes, never raw output. */
export function assessGeneratedCandidates(value, source, topics, outputContract) {
  return normalizeCandidates(value, source, true, topics, outputContract);
}

/** Validate only the bounded envelope in the SDK; business validation runs after usage is captured. */
export function validateGenerationEnvelope(value) {
  record(value, ['candidates', 'reason']);
  string(value.reason, 1000);
  list(value.candidates, GENERATION_LIMITS.candidates);
  boundedBytes(value, GENERATION_LIMITS.outputBytes, 'generation_output_too_large');
  return value;
}
