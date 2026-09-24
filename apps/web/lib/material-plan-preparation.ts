import { createHash } from 'node:crypto';
import {
  normalizeMaterialPlan,
  materialPlanHash,
  type MaterialPlan,
} from '../../../packages/database/src/material-registration-contract.mjs';
import type { MaterialWorkerRequest } from '../../../packages/database/src/material-verification-worker.mjs';
import type { MaterialCandidate, MaterialReference } from './candidate-publication-materials';
import { bindMaterialPlan } from './material-registration-binding.ts';
import type { MaterialHints } from './material-enrichment.ts';

export const materialReviewStatements = {
  sourceAuthenticity:
    '我已打开列出的原始链接，核对真实发布主体、原文及对应出处，而非仅凭域名或模型判断。',
  usageRights: '我确认有权在 HZense 公开引用列出的原文摘录；不含未获授权的私有、付费或受限材料。',
  entityIdentity: '我已核对人物与组织身份，排除同名歧义，并确认所列角色及组织关系有原文支持。',
  eventRelevance:
    '我已核对事件发生日期及人物与本事件的关系，不将采集时间、文章发布日期或推测当作事件时间。',
  claimSupport:
    '我已逐条核对标题、摘要及主张与证据的对应关系，并检查矛盾信息；不把规则匹配当作事实验证。',
  taxonomy: '我已核对所列领域与本事件相关，且不以目录存在代替内容判断。',
} as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (kind: string, value: string) => `${kind}-${hash(value).slice(0, 32)}`;
const normalized = (v: string) => v.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const blocked = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};
export type MaterialDraft = {
  plan: MaterialPlan;
  dossier: {
    version: 'material-review-draft-v1';
    requestId: string;
    planHash: string;
    sourceBundleHash: string;
    reviewRound: number;
    statements: typeof materialReviewStatements;
    eventDate: { value: string; evidenceId: string; quote: string; rationale: string };
  };
};

/** Preparation only: reuses extracted facts, never invents missing identities or
 * treats its own checks as a trusted attestation. No network or model calls. */
export function prepareMaterialPlan(
  packet: MaterialWorkerRequest,
  now = new Date(),
  hints?: MaterialHints,
): { ready: true; payload: MaterialDraft } | { ready: false; blockers: string[] } {
  try {
    const candidate = packet.candidate as MaterialCandidate;
    if (!candidate.persons.length) blocked('needs_person_evidence');
    if (!candidate.event_date || !candidate.event_date_evidence?.length)
      blocked('needs_event_time');
    const publicFragments = packet.bundle.source.fragments.flatMap((fragment, index) => {
      const provenance = packet.bundle.provenance[index];
      const url =
        provenance?.kind === 'original' ? packet.originalSourceUrl : provenance?.sourceUrl;
      return url ? [{ fragment, url }] : [];
    });
    const evidence = new Map<string, MaterialPlan['evidence'][number]>();
    const sources = new Map<string, MaterialPlan['sources'][number]>();
    const addEvidence = (refs: MaterialReference[], required: string[] = []) => {
      if (!refs.length || refs.some((r) => !r.quote)) blocked('needs_public_evidence');
      const matches = publicFragments.filter(
        ({ fragment }) =>
          refs.every((r) => fragment.text.includes(r.quote)) &&
          required.every((s) => fragment.text.includes(s)),
      );
      if (!matches.length) blocked('needs_public_evidence');
      const { fragment, url } = matches[0]!;
      const origin = new URL(url).origin,
        host = new URL(url).hostname;
      const registered = packet.catalog.sources.filter((s) => s.allowed_hosts.includes(host));
      if (registered.length > 1 || registered.some((s) => !s.active)) blocked('source_conflict');
      const existing = registered[0];
      const source = existing
        ? {
            id: existing.id,
            name: existing.name,
            url: existing.url,
            allowedHosts: existing.allowed_hosts,
          }
        : { id: id('source', origin), name: host, url: `${origin}/`, allowedHosts: [host] };
      sources.set(source.id, source);
      const evidenceId = id('evidence', `${packet.requestId}\n${url}\n${fragment.text}`);
      evidence.set(evidenceId, {
        id: evidenceId,
        sourceId: source.id,
        sourceUrl: url,
        locator: JSON.stringify(fragment.locator),
        excerpt: fragment.text,
        contentHash: hash(fragment.text),
        capturedAt: now.toISOString(),
        sourcePublishedAt: null,
      });
      return evidenceId;
    };
    const entities = new Map<string, MaterialPlan['entities'][number]>();
    const addEntity = (name: string, kind: 'person' | 'organization', evidenceId: string) => {
      const matches = packet.catalog.entities.filter((row) =>
        [row.name, ...(row.aliases ?? [])].some((n) => normalized(n) === normalized(name)),
      );
      if (
        matches.length > 1 ||
        matches.some(
          (row) =>
            row.status !== 'active' ||
            row.name !== name ||
            (kind === 'person'
              ? row.type !== 'person'
              : !['company', 'institution'].includes(row.type)),
        )
      )
        blocked('material_entity_ambiguous');
      const proposed =
        kind === 'organization' ? hints?.organizations.find((row) => row.name === name) : undefined;
      if (kind === 'organization' && !matches.length && !proposed)
        blocked('needs_organization_identity');
      const identityEvidence =
        !matches.length && proposed
          ? proposed.evidence.map((ref) => addEvidence([ref], [name]))
          : [];
      const current = matches[0];
      const entityId = current?.id ?? id(kind, name);
      const previous = entities.get(entityId);
      entities.set(entityId, {
        id: entityId,
        name,
        type: (current?.type ??
          proposed?.type ??
          'person') as MaterialPlan['entities'][number]['type'],
        aliases: current?.aliases ?? [],
        evidenceIds: [
          ...new Set([...(previous?.evidenceIds ?? []), evidenceId, ...identityEvidence]),
        ],
      });
      return entityId;
    };
    const organizations = new Set<string>();
    const persons = candidate.persons.map((person) => {
      const e = addEvidence(person.evidence ?? [], [
        person.name,
        person.role,
        ...(person.organization ? [person.organization] : []),
      ]);
      const org = person.organization ? addEntity(person.organization, 'organization', e) : null;
      if (org) organizations.add(org);
      return {
        entityId: addEntity(person.name, 'person', e),
        role: person.role,
        organizationId: org,
        evidenceIds: [e],
      };
    });
    const claims = candidate.claims.map((claim) => ({
      text: claim.text,
      evidenceId: addEvidence(claim.evidence),
    }));
    for (const organization of candidate.organizations) {
      if ([...entities.values()].some((e) => e.name === organization && e.type !== 'person'))
        continue;
      const match = candidate.claims
        .flatMap((claim) => claim.evidence)
        .filter((ref) => ref.quote.includes(organization));
      organizations.add(
        addEntity(organization, 'organization', addEvidence(match.slice(0, 1), [organization])),
      );
    }
    const dateReference = candidate.event_date_evidence![0]!;
    const dateId = addEvidence([dateReference]);
    const story = normalized(
      `${candidate.title}\n${candidate.summary}\n${candidate.claims.map((c) => c.text).join('\n')}`,
    );
    const topics = packet.catalog.topics.filter(
      (topic) =>
        topic.runtime_enabled !== false &&
        topic.status !== 'archived' &&
        topic.title.length >= 2 &&
        (hints?.topicIds.length
          ? hints.topicIds.includes(topic.id)
          : story.includes(normalized(topic.title))),
    );
    if (!topics.length || topics.length > 5) blocked('needs_topic_evidence');
    const plan = normalizeMaterialPlan({
      version: 'material-registration-v1',
      owner: packet.owner,
      runId: packet.runId,
      candidateIndex: packet.candidateIndex,
      baseMaterialHash: packet.baseMaterialHash,
      sourceBundleHash: packet.bundle.sourceBundleHash,
      entities: [...entities.values()],
      sources: [...sources.values()],
      evidence: [...evidence.values()],
      topicIds: topics.map((t) => t.id),
      candidate: {
        title: candidate.title,
        summary: candidate.summary,
        eventDate: candidate.event_date,
        persons,
        organizationIds: [...organizations],
        claims,
      },
    });
    bindMaterialPlan(plan, packet.bundle, {
      ...packet,
      materialHash: packet.baseMaterialHash,
      candidate,
    });
    return {
      ready: true,
      payload: {
        plan,
        dossier: {
          version: 'material-review-draft-v1',
          requestId: packet.requestId,
          planHash: materialPlanHash(plan),
          sourceBundleHash: packet.bundle.sourceBundleHash,
          reviewRound: 0,
          statements: materialReviewStatements,
          eventDate: {
            value: plan.candidate.eventDate,
            evidenceId: dateId,
            quote: dateReference.quote,
            rationale: '待管理员核对所列日期与原文的事件发生时间对应关系。',
          },
        },
      },
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'material_preparation_blocked';
    return { ready: false, blockers: [code] };
  }
}
