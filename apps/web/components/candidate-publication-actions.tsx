'use client';

import { useRef, useState } from 'react';
import controls from './admin-controls.module.css';
import styles from './candidate-review-editor.module.css';
import { reviewRequestIdentity } from './candidate-review-editor';

type Props = { runId: string; candidateIndex: number; materialHash: string };
type Action = 'inspect' | 'prepare' | 'verify' | 'assemble' | 'publish' | 'withdraw';
type Review = { revision: number; decision: string; material_hash: string };
type Readiness = {
  ready?: boolean;
  blocked?: string[];
  blockers?: string[];
  status?: string;
  receipt?: unknown;
};
const actions: { action: Action; label: string; description: string }[] = [
  {
    action: 'inspect',
    label: '检查发布资格',
    description: '只读检查当前门禁与状态，不调用 AI、不写入。',
  },
  {
    action: 'prepare',
    label: '转换为正式私有候选',
    description: '按事件键去重并关联已建档实体；仍为私有，不公开。',
  },
  {
    action: 'verify',
    label: '提交签名核验报告',
    description: '校验报告签名及其绑定的候选版本，不将人工审核直接视为核验通过。',
  },
  {
    action: 'assemble',
    label: '组装待发布版本',
    description: '使用已保存的核验记录组装内容；此步骤不公开。',
  },
  {
    action: 'publish',
    label: '正式发布',
    description: '公开该候选；数据库模式列表与搜索遵循同一资格门禁。',
  },
  {
    action: 'withdraw',
    label: '撤回正式信号',
    description: '撤回已发布版本，不删除历史审核与核验记录。',
  },
];
export function latestSubmittedReview(records: Review[], materialHash: string) {
  const latest = [...records].sort((a, b) => b.revision - a.revision)[0];
  if (!latest || latest.decision !== 'submit_verification')
    throw new Error('最新审核尚未送核验，请先保存并送核验。');
  if (
    !Number.isInteger(latest.revision) ||
    latest.revision < 1 ||
    latest.material_hash !== materialHash
  )
    throw new Error('审核材料版本已变化，请重新加载当前候选后核对。');
  return latest;
}
export function withdrawalReview(records: Review[], materialHash: string, revision: string) {
  if (!/^[1-9]\d*$/.test(revision) || !Number.isSafeInteger(Number(revision)))
    throw new Error('撤回时请输入已有转换记录对应的审核版本号。');
  const review = records.find((record) => record.revision === Number(revision));
  if (!review || review.material_hash !== materialHash)
    throw new Error('指定审核版本与当前材料不匹配，请核对既有发布回执。');
  return review;
}
export function inspectionReview(records: Review[], materialHash: string, revision: string) {
  const selected =
    revision || String([...records].sort((a, b) => b.revision - a.revision)[0]?.revision ?? '');
  return withdrawalReview(records, materialHash, selected);
}
const publicationReasons = {
  publish: {
    initial_publication: '首次发布',
    content_correction: '内容修正',
    republication: '重新发布',
  },
  withdraw: {
    factual_error: '事实错误',
    privacy: '隐私问题',
    evidence_revoked: '证据失效',
    operator_request: '管理员要求撤回',
  },
};
export function publicationExtra(
  action: Action,
  inputs: {
    envelope: string;
    verificationId: string;
    publicationRevision: string;
    reasonCode: string;
  },
) {
  if (action === 'verify') {
    let envelope: unknown;
    try {
      envelope = JSON.parse(inputs.envelope);
    } catch {
      throw new Error('签名核验报告必须为有效 JSON。');
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
      throw new Error('签名核验报告必须为 JSON 对象。');
    return { envelope };
  }
  if (action === 'assemble') {
    const verificationId = inputs.verificationId.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        verificationId,
      )
    )
      throw new Error('请输入有效的核验记录 UUID。');
    return { verificationId };
  }
  if (action === 'publish' || action === 'withdraw') {
    const expectedPublicationRevision = Number(inputs.publicationRevision);
    if (
      !/^\d+$/.test(inputs.publicationRevision) ||
      !Number.isSafeInteger(expectedPublicationRevision) ||
      expectedPublicationRevision < 0
    )
      throw new Error('请输入当前发布版本号（非负整数），首次发布按服务端回执填写。');
    const reasonCode = inputs.reasonCode.trim();
    if (!Object.hasOwn(publicationReasons[action], reasonCode))
      throw new Error(`请选择${action === 'publish' ? '发布' : '撤回'}操作对应的原因。`);
    return { expectedPublicationRevision, reasonCode };
  }
  return {};
}

export function CandidatePublicationActions(props: Props) {
  return (
    <PublicationActions
      key={`${props.runId}:${props.candidateIndex}:${props.materialHash}`}
      {...props}
    />
  );
}
function PublicationActions({ runId, candidateIndex, materialHash }: Props) {
  const [inputs, setInputs] = useState({
    envelope: '',
    verificationId: '',
    publicationRevision: '',
    reasonCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [withdrawReviewRevision, setWithdrawReviewRevision] = useState('');
  const [checked, setChecked] = useState(false);
  const [reviewRevision, setReviewRevision] = useState<number | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const [message, setMessage] = useState('先检查发布资格；每一步都需单独执行，不会自动调用 AI。');
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const running = useRef(false);
  async function perform(action: Action) {
    if (running.current) return;
    if (
      (action === 'publish' || action === 'withdraw') &&
      !window.confirm(
        action === 'publish'
          ? '确认正式公开此候选？请确保公开来源、人物关联和签名核验均已核对。'
          : '确认撤回正式信号？公开内容将不再作为有效发布展示。',
      )
    )
      return;
    running.current = true;
    setBusy(true);
    try {
      const extra = publicationExtra(action, inputs);
      const response = await fetch(
        `/api/admin/candidate-review?runId=${encodeURIComponent(runId)}&candidateIndex=${candidateIndex}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('读取当前审核版本失败。尚未执行任何发布操作，请重试。');
      const data = (await response.json()) as { configured: boolean; reviews: Review[] };
      if (!data.configured && action !== 'withdraw' && action !== 'inspect') {
        setChecked(false);
        throw new Error('审核/发布存储尚未配置，暂不能执行。');
      }
      let latest: Review;
      try {
        latest =
          action === 'inspect'
            ? inspectionReview(data.reviews, materialHash, withdrawReviewRevision)
            : action === 'withdraw'
              ? withdrawalReview(data.reviews, materialHash, withdrawReviewRevision)
              : latestSubmittedReview(data.reviews, materialHash);
      } catch (error) {
        setChecked(false);
        throw error;
      }
      setReviewRevision(latest.revision);
      const request = {
        runId,
        candidateIndex,
        materialHash,
        expectedReviewRevision: latest.revision,
        ...extra,
      };
      pending.current = reviewRequestIdentity(
        pending.current,
        JSON.stringify({ action, request }),
        () => crypto.randomUUID(),
      );
      const result = await fetch('/api/admin/candidate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          request: { ...request, requestKey: pending.current.requestId },
        }),
      });
      const body = (await result.json()) as { readiness?: Readiness; error?: string };
      if (!result.ok) {
        if (result.status === 409) {
          setChecked(false);
          if (body.error === 'review_revision_required')
            throw new Error(
              '撤回后重新发布需要新的审核修订和独立签名核验。请先编辑候选、保存新修订并重新核验，不要重试同一旧版本。',
            );
          throw new Error('版本或状态冲突。请检查最新发布资格并核对回执，不要重复推进后续步骤。');
        }
        if (result.status === 503)
          throw new Error('当前阶段尚未配置或暂不可用；未确认成功，请核对服务端记录。');
        throw new Error(
          '操作未确认成功，当前输入已保留。原样重试使用同一请求编号；不要盲目执行下一阶段。',
        );
      }
      setReceipt(body);
      if (body.readiness) setReadiness(body.readiness);
      setChecked(
        data.configured === true &&
          [...data.reviews].sort((a, b) => b.revision - a.revision)[0]?.decision ===
            'submit_verification',
      );
      pending.current = null;
      setMessage(
        action === 'inspect'
          ? `已核对审核 r${latest.revision}。请查看门禁与回执，再选择下一步。`
          : `${actions.find((item) => item.action === action)?.label}请求已成功返回，请核对回执；不会自动执行下一步。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请求失败，原输入与请求编号已保留。');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function change(key: keyof typeof inputs, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
    pending.current = null;
  }
  const blockers = readiness?.blocked ?? readiness?.blockers ?? [];
  return (
    <section
      className={`${styles.editor} ${controls.scope}`}
      aria-labelledby="publication-actions-heading"
    >
      <h2 id="publication-actions-heading">核验与正式发布</h2>
      <p>以下操作互相独立。审核决定、签名核验、组装版本和正式公开不是同一状态；不触发 AI 生成。</p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {reviewRevision !== null ? (
        <p>最近核对审核版本：r{reviewRevision}（每次操作前重新读取）</p>
      ) : null}
      {readiness ? (
        <div>
          <p>
            发布资格：{readiness.ready ? '门禁已就绪，仍需手动确认发布' : '尚未就绪'} ·{' '}
            {readiness.status ?? '请查阅回执'}
          </p>
          {blockers.length ? (
            <ul>
              {blockers.map((blocker, index) => (
                <li key={`${index}:${blocker}`}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={busy} className={styles.fields}>
        <legend>阶段输入</legend>
        <label>
          签名核验报告（JSON，仅核验阶段使用）
          <textarea
            rows={6}
            value={inputs.envelope}
            onChange={(event) => change('envelope', event.target.value)}
          />
        </label>
        <label>
          已保存核验记录 UUID（仅组装阶段使用）
          <input
            value={inputs.verificationId}
            onChange={(event) => change('verificationId', event.target.value)}
          />
        </label>
        <label>
          检查 / 撤回的原审核版本号（检查时留空读取最新版本；撤回必须指定原版本）
          <input
            inputMode="numeric"
            value={withdrawReviewRevision}
            onChange={(event) => {
              setWithdrawReviewRevision(event.target.value);
              pending.current = null;
            }}
          />
        </label>
        <label>
          当前发布版本号（以最新服务端回执为准）
          <input
            inputMode="numeric"
            value={inputs.publicationRevision}
            onChange={(event) => change('publicationRevision', event.target.value)}
          />
        </label>
        <label>
          发布 / 撤回原因
          <select
            value={inputs.reasonCode}
            onChange={(event) => change('reasonCode', event.target.value)}
          >
            <option value="">请选择操作原因</option>
            <optgroup label="发布">
              {Object.entries(publicationReasons.publish).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="撤回">
              {Object.entries(publicationReasons.withdraw).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </fieldset>
      {actions.map(({ action, label, description }) => (
        <div key={action} className={controls.group}>
          <button
            type="button"
            disabled={
              busy ||
              (action === 'withdraw'
                ? !/^[1-9]\d*$/.test(withdrawReviewRevision)
                : action !== 'inspect' && !checked)
            }
            onClick={() => void perform(action)}
          >
            {label}
          </button>
          <span>{description}</span>
        </div>
      ))}
      {receipt ? (
        <details className={styles.history} open>
          <summary>最近服务端回执（不代表所有阶段完成）</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(receipt, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
