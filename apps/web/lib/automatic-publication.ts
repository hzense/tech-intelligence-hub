import { createHash } from 'node:crypto';
import { editorialMissing, type EditorialDashboard } from './editorial-review.ts';
import { editorialSourceUrl } from './editorial-source-options.ts';
import { isLocalRealAi } from './local-development.ts';

export type AutomaticPublicationPolicy = {
  mode: 'automatic';
  policy: 'auto-publication-v1';
  sourceUrls: string[];
};
export type AutomaticPublicationStatus = {
  eligible: boolean;
  status: 'disabled' | 'pending' | 'published' | 'needs_attention' | 'skipped';
  reasons: string[];
};

/** Capability only: each task must still carry its own immutable publication consent. */
export function automaticPublicationAvailable(env: Readonly<Record<string, string | undefined>>) {
  return (
    env.HZENSE_EDITORIAL_PUBLICATION_ENABLED === '1' &&
    env.HZENSE_UNIFIED_SIGNAL_ENABLED === '1' &&
    // Local UI settings do not require a process restart, but never bypass the
    // strict local database/origin/isolation contract or enable simulated AI.
    (env.HZENSE_LOCAL_DEVELOPMENT === '1'
      ? isLocalRealAi(env)
      : env.HZENSE_AUTOMATIC_PUBLICATION_ENABLED === '1')
  );
}

/** Preserve the manual generation page's explicit operator-level opt-in. */
export function automaticPublicationEnabled(env: Readonly<Record<string, string | undefined>>) {
  return env.HZENSE_AUTOMATIC_PUBLICATION_ENABLED === '1' && automaticPublicationAvailable(env);
}

export function automaticPublicationPolicy(value: unknown): AutomaticPublicationPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  if (
    Object.keys(policy).sort().join(',') !== 'mode,policy,sourceUrls' ||
    policy.mode !== 'automatic' ||
    policy.policy !== 'auto-publication-v1' ||
    !Array.isArray(policy.sourceUrls) ||
    policy.sourceUrls.length > 8 ||
    new Set(policy.sourceUrls).size !== policy.sourceUrls.length ||
    policy.sourceUrls.some((url) => typeof url !== 'string' || editorialSourceUrl(url) !== url)
  )
    return null;
  return policy as AutomaticPublicationPolicy;
}

/** Stable identity is independent of changing catalog/readiness checks. */
export function automaticPublicationRequestId(runId: string, index: number) {
  const hex = createHash('sha256').update(`auto-publication-v1:${runId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Read-only preparation. Only pinned original links can become public automatically. */
export function automaticPublicationPreview(
  dashboard: EditorialDashboard,
  policy: AutomaticPublicationPolicy | null,
  enabled: boolean,
): { state: AutomaticPublicationStatus; content: EditorialDashboard['content'] } {
  const content = {
    ...dashboard.content,
    sourceUrls: (policy?.sourceUrls ?? []).filter((url) => dashboard.sourceOptions?.includes(url)),
    ...(dashboard.content.resources === undefined
      ? {}
      : {
          resources: dashboard.content.resources.map((resource) => {
            const option = dashboard.resourceOptions?.find(
              (entry) => entry.type === resource.type && entry.name === resource.name,
            );
            return !resource.entity_id && option?.status === 'new' && !option.matches.length
              ? { ...resource, entity_id: '__new__' }
              : resource;
          }),
        }),
  };
  const result = (status: AutomaticPublicationStatus['status'], reasons: string[]) => ({
    state: { eligible: !!policy, status, reasons },
    content,
  });
  if (dashboard.action === 'publish') return result('published', []);
  if (dashboard.revision > 0 || dashboard.action !== null)
    return result('skipped', ['已有人工处理或撤回记录，自动发布不会覆盖；可在下方手动修改。']);
  if (!policy) return result('disabled', ['此任务未授权自动发布，历史任务不会自动补发。']);
  if (!enabled) return result('disabled', ['自动发布开关已关闭。']);
  const reasons = editorialMissing(
    content,
    dashboard.resourceOptions,
    dashboard.resourceSourceOptions,
    dashboard.missingResourceDetails,
  ).map((name) => `待补充：${name}`);
  if (!dashboard.configured) reasons.push('发布服务尚未就绪。');
  if (dashboard.warnings.length) reasons.push('补全或补证资料读取尚未确认，请恢复读取后再发布。');
  if (content.dateBasis !== 'source_published') reasons.push('未绑定原文发布日期规则。');
  if (!content.sourceUrls.length) reasons.push('没有已授权公开且仍可核对的原始网页来源。');
  if (content.resources === undefined) reasons.push('缺少关联资源结构。');
  if (content.resources?.length && !dashboard.resourcePublicationReady)
    reasons.push('资源发布权限尚未就绪。');
  if (
    content.topics.some(
      (topic) =>
        !dashboard.topicOptions.some(
          (entry) => entry.id === topic.id && entry.title === topic.title,
        ),
    )
  )
    reasons.push('领域标签已变更，请重新选择。');
  return result(reasons.length ? 'needs_attention' : 'pending', [...new Set(reasons)]);
}

type Run = { status: string; snapshot: { publication?: unknown }; result: unknown };
export type AutomaticPublicationResult = {
  state: 'disabled' | 'ineligible' | 'processed';
  candidates: Array<{
    index: number;
    status: 'published' | 'needs_attention' | 'skipped';
    reasons: string[];
  }>;
};

export function createAutomaticPublisher(deps: {
  enabled(): boolean;
  run(owner: string, runId: string): Promise<Run>;
  read(owner: string, runId: string, index: number): Promise<EditorialDashboard>;
  publish(owner: string, request: Record<string, unknown>): Promise<unknown>;
}) {
  return async (owner: string, runId: string): Promise<AutomaticPublicationResult> => {
    if (!deps.enabled()) return { state: 'disabled', candidates: [] };
    const run = await deps.run(owner, runId);
    const policy = automaticPublicationPolicy(run.snapshot.publication);
    if (run.status !== 'completed' || !policy) return { state: 'ineligible', candidates: [] };
    const result = run.result as { classification?: unknown; candidates?: unknown } | null;
    if (
      result?.classification !== 'private' ||
      !Array.isArray(result.candidates) ||
      result.candidates.length > 5
    )
      return { state: 'ineligible', candidates: [] };
    const indexes: number[] = [];
    for (const candidate of result.candidates) {
      if (
        !candidate ||
        candidate.classification !== 'private' ||
        candidate.status !== 'needs_review' ||
        !Number.isInteger(candidate.index) ||
        candidate.index < 0 ||
        candidate.index > 4 ||
        indexes.includes(candidate.index)
      )
        return { state: 'ineligible', candidates: [] };
      indexes.push(candidate.index);
    }
    const candidates: AutomaticPublicationResult['candidates'] = [];
    for (const index of indexes) {
      // No dependency invokes a model. Each candidate has its own atomic receipt.
      const dashboard = await deps.read(owner, runId, index);
      const { state, content } = automaticPublicationPreview(dashboard, policy, deps.enabled());
      if (state.status !== 'pending') {
        candidates.push({
          index,
          status:
            state.status === 'published'
              ? 'published'
              : state.status === 'skipped'
                ? 'skipped'
                : 'needs_attention',
          reasons: state.reasons,
        });
        continue;
      }
      try {
        await deps.publish(owner, {
          requestId: automaticPublicationRequestId(runId, index),
          runId,
          candidateIndex: index,
          expectedRevision: 0,
          materialHash: dashboard.materialHash,
          action: 'publish',
          content,
          consent: false,
        });
        candidates.push({ index, status: 'published', reasons: [] });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        // Infrastructure/uncertain commits are retried by the publication step,
        // never by re-running the paid generation step.
        if (
          ![
            'revision_conflict',
            'request_id_conflict',
            'material_changed',
            'confirmation_required',
            'resource_details_incomplete',
            'resource_identity_ambiguous',
            'resource_source_required',
            'entity_reference_invalid',
            'topic_reference_invalid',
            'excluded_person',
            'automatic_publication_invalid',
            'automatic_publication_not_authorized',
            'automatic_publication_source_invalid',
          ].includes(code)
        )
          throw new Error('automatic_publication_unavailable');
        candidates.push({
          index,
          status: 'needs_attention',
          reasons: ['发布条件已变化或存在人工处理，请重新读取并核对。'],
        });
      }
    }
    return { state: 'processed', candidates };
  };
}
