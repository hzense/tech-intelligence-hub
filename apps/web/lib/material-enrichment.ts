import { Buffer } from 'node:buffer';
import {
  validateCandidateSourceBundle,
  type CandidateSourceBundle,
} from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import {
  validateGenerationSource,
  normalizeGeneratedCandidates,
  type GeneratedCandidate,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { candidateEnrichmentJsonSchema } from '../../../packages/ingestion/src/candidate-enrichment-contract.mjs';

type Reference = { fragment_id: string; quote: string };
export type MaterialHints = {
  organizations: Array<{ name: string; type: 'company' | 'institution'; evidence: Reference[] }>;
  topicIds: string[];
};
export type MaterialEnrichmentContext = { topics: Array<{ id: string; title: string }> };
const fail = (code = 'invalid_enrichment_output'): never => {
  throw Object.assign(new Error(code), { code });
};
const refsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 8,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['fragment_id', 'quote'],
    properties: {
      fragment_id: { type: 'string' },
      quote: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
};
export const materialEnrichmentJsonSchema = {
  ...candidateEnrichmentJsonSchema,
  required: [
    'event_date',
    'event_date_evidence',
    'persons',
    'organizations',
    'claim_evidence',
    'organization_identities',
    'topic_ids',
  ],
  properties: {
    ...(candidateEnrichmentJsonSchema.properties as Record<string, unknown>),
    claim_evidence: { type: 'array', minItems: 1, maxItems: 6, items: refsSchema },
    organization_identities: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'evidence'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: ['company', 'institution'] },
          evidence: refsSchema,
        },
      },
    },
    topic_ids: { type: 'array', maxItems: 5, items: { type: 'string' } },
  },
};
export const materialEnrichmentRules = `这是补证资料包补全。标题、摘要、主张文本和已有日期、人物关系不得改写。按原主张顺序输出 claim_evidence，引用能支持该主张的补充原文；可补充不同语言的原文，但不得把仅仅相关当作支持。已有日期可重新引用补充原文。人物必须与本事件直接相关且姓名、角色、组织逐字出现在引文中。organization_identities 仅在原文明确说明公司(company/公司/企业)或机构(institution/institute/university/机构/研究所/大学)时提供类型及证据，否则留空。topic_ids 只能选给定已启用目录中的 ID，没有相关领域则留空。所有输出是待人工核对的私有提案，不代表事实验证或公开许可。`;

function remap(candidate: GeneratedCandidate, ids: Map<string, string>): GeneratedCandidate {
  const map = (refs: Reference[]) =>
    refs.map((ref) => ({
      ...ref,
      fragment_id: ids.get(ref.fragment_id) ?? fail('material_changed'),
    }));
  return {
    ...candidate,
    event_date_evidence: map(candidate.event_date_evidence),
    persons: candidate.persons.map((p) => ({ ...p, evidence: map(p.evidence) })),
    claims: candidate.claims.map((c) => ({ ...c, evidence: map(c.evidence) })),
  };
}

/** Keep every supplement and every cited original fragment, without truncation.
 * IDs are compact only inside the AI snapshot; output is remapped to the bundle. */
export function materialEnrichmentInput(
  bundle: CandidateSourceBundle,
  original: GeneratedCandidate,
) {
  const checked = validateCandidateSourceBundle(bundle);
  const cited = new Set(
    [
      ...original.event_date_evidence,
      ...original.persons.flatMap((p) => p.evidence),
      ...original.claims.flatMap((c) => c.evidence),
    ].map((ref) => ref.fragment_id),
  );
  const fragments = checked.source.fragments.filter(
    (fragment, index) => cited.has(fragment.id) || checked.provenance[index]!.kind === 'supplement',
  );
  const toCompact = new Map(fragments.map((f, index) => [f.id, `fragment-${index + 1}`]));
  const source = validateGenerationSource({
    classification: 'private',
    fragments: fragments.map((f) => ({ ...f, id: toCompact.get(f.id)! })),
  });
  return { source, candidate: remap(original, toCompact), fragmentIds: fragments.map((f) => f.id) };
}

/** Re-run on persisted results before preparing any registration proposal. */
export function assessMaterialEnrichment(
  value: unknown,
  original: GeneratedCandidate,
  source: unknown,
  context: MaterialEnrichmentContext,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== [...materialEnrichmentJsonSchema.required].sort().join(',')
  )
    fail();
  const checked = validateGenerationSource(source);
  if (original.event_date !== null && v.event_date !== original.event_date) fail();
  if (!Array.isArray(v.claim_evidence) || v.claim_evidence.length !== original.claims.length)
    fail();
  const candidate = normalizeGeneratedCandidates(
    {
      reason: '补证私有提案，待人工确认。',
      candidates: [
        {
          title: original.title,
          summary: original.summary,
          event_date: original.event_date ?? v.event_date,
          event_date_evidence: v.event_date_evidence,
          persons: v.persons,
          organizations: v.organizations,
          claims: original.claims.map((claim, index) => ({
            text: claim.text,
            evidence: (v.claim_evidence as unknown[])[index],
          })),
        },
      ],
    },
    checked,
  ).candidates[0]!;
  for (const p of original.persons)
    if (
      !candidate.persons.some(
        (next) =>
          next.name === p.name && next.role === p.role && next.organization === p.organization,
      )
    )
      fail();
  if (original.organizations.some((name) => !candidate.organizations.includes(name))) fail();
  for (const p of candidate.persons) {
    if (
      !p.evidence.some((ref) =>
        ref.quote
          .split(/[。！？!?;；\n]|\.(?=\s|$)/u)
          .some((statement) =>
            [p.name, p.role, ...(p.organization ? [p.organization] : [])].every((text) =>
              statement.includes(text),
            ),
          ),
      )
    )
      fail();
  }
  if (
    candidate.organizations.some(
      (name) =>
        !original.organizations.includes(name) &&
        !checked.fragments.some((f) => f.text.includes(name)),
    )
  )
    fail();
  if (
    !Array.isArray(v.organization_identities) ||
    v.organization_identities.length > 12 ||
    !Array.isArray(v.topic_ids) ||
    v.topic_ids.length > 5 ||
    new Set(v.topic_ids).size !== v.topic_ids.length
  )
    fail();
  const organizations = (v.organization_identities as Array<Record<string, unknown>>).map((row) => {
    if (
      !row ||
      Object.keys(row).sort().join(',') !== 'evidence,name,type' ||
      typeof row.name !== 'string' ||
      !candidate.organizations.includes(row.name) ||
      typeof row.type !== 'string' ||
      !['company', 'institution'].includes(row.type) ||
      !Array.isArray(row.evidence) ||
      !row.evidence.length ||
      row.evidence.length > 8
    )
      fail();
    const references = row.evidence as Reference[];
    for (const ref of references) {
      if (
        !ref ||
        Object.keys(ref).sort().join(',') !== 'fragment_id,quote' ||
        typeof ref.quote !== 'string' ||
        !ref.quote ||
        [...ref.quote].length > 500 ||
        !checked.fragments.some((f) => f.id === ref.fragment_id && f.text.includes(ref.quote))
      )
        fail();
    }
    const namePattern = (row.name as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const typeWords =
      row.type === 'company' ? 'company|corporation' : 'institution|institute|university';
    // A private proposal still needs an explicit name/type relation in ONE quote.
    // Do not join unrelated references, or use another organization's type word.
    const relation = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${namePattern}(?:(?:\\s+is\\s+|,\\s*)(?:(?:a|an|the)\\s+)?(?:(?:AI|artificial intelligence|technology|research|software|private|public)\\s+){0,3}(?:${typeWords})\\b|是(?:一家|一所|一个)?(?:人工智能|科技|研究|软件|私营|公立)?(?:${row.type === 'company' ? '公司|企业' : '机构|研究所|大学'}))`,
      'iu',
    );
    if (!references.some((ref) => relation.test(ref.quote))) fail();
    return {
      name: row.name as string,
      type: row.type as 'company' | 'institution',
      evidence: row.evidence as Reference[],
    };
  });
  if (
    new Set(organizations.map((row) => row.name)).size !== organizations.length ||
    (v.topic_ids as unknown[]).some((id) => !context.topics.some((t) => t.id === id))
  )
    fail();
  const result = {
    classification: 'private' as const,
    validation_version: 1 as const,
    candidate: { ...candidate, index: original.index },
    materialHints: { organizations, topicIds: v.topic_ids as string[] },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 128000) fail('enrichment_output_too_large');
  return result;
}

export function restoreMaterialEnrichment(
  bundle: CandidateSourceBundle,
  original: GeneratedCandidate,
  result: Record<string, unknown>,
  context: MaterialEnrichmentContext,
) {
  const input = materialEnrichmentInput(bundle, original);
  const saved = result.candidate as GeneratedCandidate;
  const hints = result.materialHints as MaterialHints;
  if (
    !saved ||
    !hints ||
    saved.title !== original.title ||
    saved.summary !== original.summary ||
    JSON.stringify(saved.claims.map((c) => c.text)) !==
      JSON.stringify(original.claims.map((c) => c.text))
  )
    fail('material_changed');
  const verified = assessMaterialEnrichment(
    {
      event_date: saved.event_date,
      event_date_evidence: saved.event_date_evidence,
      persons: saved.persons,
      organizations: saved.organizations,
      claim_evidence: saved.claims.map((c) => c.evidence),
      organization_identities: hints.organizations,
      topic_ids: hints.topicIds,
    },
    input.candidate,
    input.source,
    context,
  );
  const ids = new Map(input.fragmentIds.map((id, index) => [`fragment-${index + 1}`, id]));
  return {
    candidate: remap(verified.candidate, ids),
    hints: {
      ...verified.materialHints,
      organizations: verified.materialHints.organizations.map((row) => ({
        ...row,
        evidence: row.evidence.map((ref) => ({
          ...ref,
          fragment_id: ids.get(ref.fragment_id) ?? fail(),
        })),
      })),
    },
  };
}
