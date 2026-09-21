import { createHash } from 'node:crypto';
import {
  assessGeneratedCandidates,
  validateGenerationSource,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import {
  signalGenerationSourceHash,
  type SignalGenerationRun,
} from '../../../packages/database/src/signal-generation-store.mjs';

export class CandidateReviewError extends Error {
  constructor() {
    super('candidate_review_unavailable');
  }
}

/** Read-only preparation, NOT a trusted verification record or publication permit. */
export function buildCandidateReview(run: SignalGenerationRun, index: number) {
  const unavailable = (): never => {
    throw new CandidateReviewError();
  };
  try {
    if (
      run.status !== 'completed' ||
      run.deleted_at ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 4
    )
      return unavailable();
    const result = run.result as { classification?: unknown; candidates?: unknown } | null;
    if (
      !result ||
      result.classification !== 'private' ||
      !Array.isArray(result.candidates) ||
      result.candidates.length > 5
    )
      return unavailable();
    const indices = result.candidates.map((row) => row?.index);
    if (
      indices.some((value) => !Number.isInteger(value) || value < 0 || value > 4) ||
      new Set(indices).size !== indices.length
    )
      return unavailable();
    const saved = result.candidates.find((row) => row.index === index);
    if (!saved || saved.classification !== 'private' || saved.status !== 'needs_review')
      return unavailable();
    const source = validateGenerationSource(run.snapshot.source);
    if (signalGenerationSourceHash(source) !== run.source_hash) return unavailable();
    // Never trust historical issues, model assertions or browser-provided approval.
    const input = Object.fromEntries(
      Object.entries(saved).filter(
        ([key]) => !['index', 'classification', 'status', 'issues'].includes(key),
      ),
    );
    const assessed = assessGeneratedCandidates(
      { candidates: [input], reason: '审核前只读检查' },
      source,
    );
    const normalized = assessed.candidates[0];
    if (assessed.candidates.length !== 1 || !normalized) return unavailable();
    const candidate = { ...normalized, index };
    const referenced = new Set(
      [
        ...candidate.event_date_evidence,
        ...candidate.claims.flatMap((claim) => claim.evidence),
        ...candidate.persons.flatMap((person) => person.evidence),
      ].map((reference) => reference.fragment_id),
    );
    const checks = [
      {
        code: 'public_evidence',
        label: '公开来源与使用许可',
        detail: '当前为私有解析材料；需独立公开原文、来源登记和使用许可核验。',
      },
      {
        code: 'claim_verification',
        label: '事实与反证核验',
        detail: '逐字引用已重新匹配任务原文，但主张真实性、来源独立性和反证仍需可信核验。',
      },
      {
        code: 'person_binding',
        label: '关键人物与组织绑定',
        detail: candidate.persons.length
          ? '已有人物建议；需消歧、绑定正式实体，并核实人物的事件角色与任职时间。'
          : '缺少关键人物；至少补齐一位有事件证据支持的人物。',
      },
      {
        code: 'event_identity',
        label: '事件身份与去重',
        detail: '需匹配规范事件身份、检查已有信号及跨文档重复，不能按标题直接创建正式信号。',
      },
      { code: 'taxonomy', label: '领域分类', detail: '需绑定现有 Taxonomy 的有效领域标识。' },
      {
        code: 'publication_chain',
        label: '核验与发布回执',
        detail: '尚未接入候选转换、可信核验记录和发布任务；没有公开发布许可。',
      },
      ...(candidate.event_date === null
        ? [
            {
              code: 'event_time',
              label: '事件发生时间',
              detail: '原文未确定事件时间；需补充依据，不能使用上传或生成时间。',
            },
          ]
        : []),
    ];
    return {
      version: 'candidate-review-preparation-v1' as const,
      runId: run.id,
      candidateIndex: index,
      sourceHash: run.source_hash,
      materialHash: createHash('sha256')
        .update(JSON.stringify({ runId: run.id, sourceHash: run.source_hash, candidate }))
        .digest('hex'),
      candidate,
      fragments: source.fragments.filter((fragment) => referenced.has(fragment.id)),
      checks,
      canPublish: false as const,
    };
  } catch {
    throw new CandidateReviewError();
  }
}
