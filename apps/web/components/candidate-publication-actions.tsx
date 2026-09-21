'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import controls from './admin-controls.module.css';
import styles from './candidate-review-editor.module.css';
import { reviewRequestIdentity } from './candidate-review-request';

type Props = { runId: string; candidateIndex: number; materialHash: string };
type Action = 'inspect' | 'confirm' | 'prepare' | 'assemble' | 'publish' | 'withdraw';
type Review = { revision: number; decision: string; material_hash: string };
type PipelineReceipt = {
  verification?: { verification_id?: string } | null;
  publication?: { publication_revision?: number; status?: string; current_public?: boolean } | null;
};
type Readiness = {
  ready?: boolean;
  blocked?: string[];
  blockers?: string[];
  status?: string;
  receipt?: PipelineReceipt;
};
type Preparation = {
  ready: boolean;
  blockers: string[];
  counts?: {
    people: number;
    organizations: number;
    topics: number;
    evidence: number;
    claims: number;
  };
};

const stageCopy: Record<string, { label: string; detail: string }> = {
  review_not_submitted: {
    label: '可以确认新的审核版本',
    detail: '上一修订未送核验；系统会从当前候选与正式数据重新准备，不复用旧核验。',
  },
  review_confirmation_required: {
    label: '可以确认送核验',
    detail: '系统已从当前候选和正式数据自动准备审核版本；确认后进入独立核验，仍不会公开。',
  },
  review_preparation_blocked: {
    label: '尚未满足送核验条件',
    detail: '系统不会要求人工补写发布字段；请先补齐下面列出的正式数据或公开证据。',
  },
  conversion_required: {
    label: '可以确认转换',
    detail: '系统将候选转换为正式私有版本，仍不会公开。',
  },
  trusted_verification_required: {
    label: '等待系统独立核验',
    detail: '无需粘贴报告或填写编号；可信核验结果到达后即可继续。',
  },
  verification_recorded: {
    label: '可以确认组装',
    detail: '系统已找到有效核验记录，可以组装待发布版本。',
  },
  assembled_requires_live_release_checks: {
    label: '可以确认发布',
    detail: '系统将在提交前再次检查授权、证据、版本和公开资格。',
  },
  published: {
    label: '当前已发布',
    detail: '该信号当前满足公开门禁，可在网站及搜索中展示。',
  },
  not_currently_public: {
    label: '当前未公开',
    detail: '历史发布已经撤回或失效；可确认新的系统审核版本并重新进入独立核验。',
  },
};

export function latestReview(records: Review[], materialHash: string) {
  const latest = [...records].sort((a, b) => b.revision - a.revision)[0];
  if (
    !latest ||
    !Number.isInteger(latest.revision) ||
    latest.revision < 1 ||
    latest.material_hash !== materialHash
  )
    throw new Error('审核材料版本已变化，请重新加载当前候选后核对。');
  return latest;
}

export function latestSubmittedReview(records: Review[], materialHash: string) {
  const latest = latestReview(records, materialHash);
  if (latest.decision !== 'submit_verification')
    throw new Error('最新审核尚未送核验，请先保存并送核验。');
  return latest;
}

export function latestPublishedReview(records: Review[], materialHash: string) {
  const selected = [...records]
    .sort((a, b) => b.revision - a.revision)
    .find(
      (record) =>
        record.decision === 'submit_verification' && record.material_hash === materialHash,
    );
  if (!selected || !Number.isInteger(selected.revision) || selected.revision < 1)
    throw new Error('没有可用于撤回的已送核验版本。');
  return selected;
}

export function unreviewedPublicationReadiness(data: {
  configured: boolean;
  preparation?: Preparation;
}): Readiness {
  const prepared = data.configured && data.preparation?.ready === true;
  const blockers = !data.configured
    ? ['审核与发布写入尚未启用，当前只能查看候选和证据。']
    : (data.preparation?.blockers ?? ['系统尚未返回审核准备结果，请刷新后重试。']);
  return {
    ready: prepared,
    status: prepared ? 'review_confirmation_required' : 'review_preparation_blocked',
    blocked: prepared ? [] : blockers,
  };
}

export function applyReviewPreparationGate(
  readiness: Readiness,
  data: { configured: boolean; preparation?: Preparation },
): Readiness {
  if (!['review_not_submitted', 'not_currently_public'].includes(readiness.status ?? ''))
    return readiness;
  if (data.configured && data.preparation?.ready === true) return readiness;
  return unreviewedPublicationReadiness(data);
}

function nextAction(status?: string): Action | null {
  if (status === 'review_confirmation_required') return 'confirm';
  if (status === 'review_not_submitted' || status === 'not_currently_public') return 'confirm';
  if (status === 'conversion_required') return 'prepare';
  if (status === 'verification_recorded') return 'assemble';
  if (status === 'assembled_requires_live_release_checks') return 'publish';
  return null;
}

export function automaticPublicationExtra(action: Action, pipeline?: PipelineReceipt) {
  if (action === 'assemble') {
    const verificationId = pipeline?.verification?.verification_id;
    if (
      typeof verificationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        verificationId,
      )
    )
      throw new Error('尚未收到有效的独立核验结果，请稍后刷新状态。');
    return { verificationId };
  }
  if (action === 'publish' || action === 'withdraw') {
    const saved = pipeline?.publication?.publication_revision;
    if (action === 'withdraw' && (!Number.isSafeInteger(saved) || Number(saved) < 1))
      throw new Error('未找到可撤回的当前发布版本，请刷新状态。');
    const expectedPublicationRevision = Number.isSafeInteger(saved) ? Number(saved) : 0;
    return {
      expectedPublicationRevision,
      reasonCode:
        action === 'withdraw'
          ? 'operator_request'
          : expectedPublicationRevision === 0
            ? 'initial_publication'
            : 'republication',
    };
  }
  return {};
}

const actionLabels: Record<Action, string> = {
  inspect: '刷新发布状态',
  confirm: '确认候选并送核验',
  prepare: '确认转换为私有版本',
  assemble: '确认组装待发布版本',
  publish: '确认正式发布',
  withdraw: '确认撤回',
};

export function CandidatePublicationActions(props: Props) {
  return (
    <PublicationActions
      key={`${props.runId}:${props.candidateIndex}:${props.materialHash}`}
      {...props}
    />
  );
}

function PublicationActions({ runId, candidateIndex, materialHash }: Props) {
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const [message, setMessage] = useState('正在读取最新发布状态。');
  const pending = useRef<Partial<Record<Action, { fingerprint: string; requestId: string }>>>({});
  const running = useRef(false);

  const readReviews = useCallback(async () => {
    const response = await fetch(
      `/api/admin/candidate-review?runId=${encodeURIComponent(runId)}&candidateIndex=${candidateIndex}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error('读取当前审核版本失败。尚未执行任何发布操作，请重试。');
    return (await response.json()) as {
      configured: boolean;
      reviews: Review[];
      preparation?: Preparation;
    };
  }, [candidateIndex, runId]);

  const post = useCallback(
    async (action: Action, expectedReviewRevision: number, extra: Record<string, unknown> = {}) => {
      const base = {
        runId,
        candidateIndex,
        materialHash,
        expectedReviewRevision,
        ...extra,
      };
      const fingerprint = JSON.stringify({ action, request: base });
      pending.current[action] = reviewRequestIdentity(
        pending.current[action] ?? null,
        fingerprint,
        () => crypto.randomUUID(),
      );
      const response = await fetch('/api/admin/candidate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          request: { ...base, requestKey: pending.current[action]?.requestId },
        }),
      });
      const body = (await response.json()) as { readiness?: Readiness; error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          if (body.error === 'review_revision_required')
            throw new Error('重新发布需要新的审核修订和独立核验，不能重复使用旧版本。');
          throw new Error('版本或状态已变化。请刷新状态后重新确认。');
        }
        if (response.status === 503)
          throw new Error('当前阶段尚未配置或暂不可用；未执行后续操作。');
        throw new Error('操作结果未知。请求编号已保留，请重试同一操作，不要继续下一阶段。');
      }
      delete pending.current[action];
      return body;
    },
    [candidateIndex, materialHash, runId],
  );

  const inspect = useCallback(async () => {
    const data = await readReviews();
    if (!data.reviews.length) {
      const state = unreviewedPublicationReadiness(data);
      const prepared = state.ready === true;
      setReadiness(state);
      setReceipt(null);
      setMessage(
        prepared ? '审核版本已自动准备，等待管理员确认。' : '候选已读取，尚未满足送核验条件。',
      );
      return { data, review: null, state };
    }
    const review = latestReview(data.reviews, materialHash);
    const body = await post('inspect', review.revision);
    if (!body.readiness) throw new Error('服务端未返回发布状态，请稍后刷新。');
    const state = applyReviewPreparationGate(body.readiness, data);
    setReadiness(state);
    setReceipt(body);
    setMessage(`已读取审核 r${review.revision} 的最新状态。`);
    return { data, review, state };
  }, [materialHash, post, readReviews]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await inspect();
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : '读取发布状态失败。');
      }
    })();
    return () => {
      active = false;
    };
  }, [inspect]);

  async function perform(action: Action) {
    if (running.current) return;
    if (
      action !== 'inspect' &&
      !window.confirm(
        action === 'publish'
          ? '确认正式公开此候选？系统会再次检查全部发布门禁。'
          : action === 'withdraw'
            ? '确认撤回此信号？公开列表、详情和搜索将不再展示有效版本。'
            : `确认${actionLabels[action].replace(/^确认/, '')}？`,
      )
    )
      return;
    running.current = true;
    setBusy(true);
    try {
      if (action === 'inspect') {
        await inspect();
        return;
      }
      const data = await readReviews();
      if (!data.configured && action !== 'withdraw')
        throw new Error('审核/发布存储尚未配置，暂不能执行。');
      if (action === 'confirm') {
        if (data.preparation?.ready !== true) throw new Error('系统准备尚未完成，请查看阻塞项。');
        const expectedReviewRevision = data.reviews.length
          ? latestReview(data.reviews, materialHash).revision
          : 0;
        const body = await post('confirm', expectedReviewRevision);
        setReceipt(body);
        setMessage('已确认候选并送核验，正在刷新最新状态。');
        await inspect();
        return;
      }
      const review =
        action === 'withdraw'
          ? latestPublishedReview(data.reviews, materialHash)
          : latestSubmittedReview(data.reviews, materialHash);
      const inspected = await post('inspect', review.revision);
      const pipeline = inspected.readiness?.receipt;
      const extra = automaticPublicationExtra(action, pipeline);
      const body = await post(action, review.revision, extra);
      setReceipt(body);
      setMessage(`${actionLabels[action]}成功，正在刷新最新状态。`);
      await inspect();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请求失败；未自动执行后续步骤。');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const blockers = readiness?.blocked ?? readiness?.blockers ?? [];
  const status = readiness?.status;
  const stage = status ? stageCopy[status] : undefined;
  const following = nextAction(status);
  const currentlyPublic = status === 'published';

  return (
    <section
      className={`${styles.editor} ${controls.scope}`}
      aria-labelledby="publication-actions-heading"
    >
      <h2 id="publication-actions-heading">审核确认与正式发布</h2>
      <p>系统自动读取核验记录、版本号和发布参数；管理员无需复制 ID、填写 JSON 或选择技术原因。</p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className={styles.history}>
        <h3>{stage?.label ?? '发布状态尚未读取'}</h3>
        <p>{stage?.detail ?? '点击刷新后，系统会显示当前可执行的下一步。'}</p>
        {blockers.length ? (
          <ul>
            {blockers.map((blocker, index) => (
              <li key={`${index}:${blocker}`}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className={controls.group}>
        <button type="button" disabled={busy} onClick={() => void perform('inspect')}>
          刷新发布状态
        </button>
        {following ? (
          <button type="button" disabled={busy} onClick={() => void perform(following)}>
            {actionLabels[following]}
          </button>
        ) : null}
        {currentlyPublic ? (
          <button type="button" disabled={busy} onClick={() => void perform('withdraw')}>
            确认撤回
          </button>
        ) : null}
      </div>
      {receipt ? (
        <details className={styles.history}>
          <summary>最近服务端回执</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(receipt, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
