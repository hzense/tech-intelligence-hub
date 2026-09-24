'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaterialPlan } from '../../../packages/database/src/material-registration-contract.mjs';
import controls from './admin-controls.module.css';
import styles from './candidate-review-editor.module.css';

type Report = { id: string; planHash: string; plan: MaterialPlan; stages: string[] };
type Dashboard = {
  configured: boolean;
  enabled: boolean;
  originalSourceAvailable?: boolean;
  sources: Array<{ batchId: string; itemId: string; name: string; sourceUrl: string }>;
  sourceListNote?: string;
  requests: Array<{ id: string; createdAt: string; fragmentCount: number; reports: Report[] }>;
};
const errors: Record<string, string> = {
  source_unavailable: '所选资料已变化、取消或删除，请重新选择。',
  invalid_candidate_source_bundle: '资料重复、格式不符或总内容超过 48 KB；请减少资料后重试。',
  material_changed: '原候选或材料版本已变化，请刷新核对。',
  catalog_conflict: '已有目录记录与核验报告冲突，需先消歧；不会覆盖原记录。',
  topic_reference_invalid: '报告引用的领域未在正式 Taxonomy 中启用。',
  commit_unknown: '提交结果未知，请刷新核对，再用同一请求继续，勿重复建立请求。',
  not_configured: '通用补证存储或受限角色尚未配置。',
  material_entity_ambiguous: '人物或组织存在同名记录，需核验方先消歧；不会新建重复实体。',
  material_registration_conflict: '已有正式记录与报告冲突，请核验方修订报告；不会覆盖已有记录。',
  material_topic_invalid: '报告中的领域未启用，请核验方重新选择正式领域。',
  material_evidence_rejected: '报告引用的证据已被否决，不能通过重试恢复。',
};
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(errors[body.error] ?? '材料操作未完成，请刷新状态并核对原请求。'),
      { code: body.error },
    );
  return body;
}
type Props = {
  runId: string;
  candidateIndex: number;
  materialHash: string;
  onRegistered: () => void;
};
export function CandidateMaterialWorkflow(props: Props) {
  return (
    <MaterialWorkflow
      key={`${props.runId}:${props.candidateIndex}:${props.materialHash}`}
      {...props}
    />
  );
}
function MaterialWorkflow({ runId, candidateIndex, materialHash, onRegistered }: Props) {
  const [data, setData] = useState<Dashboard | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pending = useRef<{
    id: string;
    supplements: Array<{ batchId: string; itemId: string }>;
  } | null>(null);
  const url = `/api/admin/candidate-materials?runId=${encodeURIComponent(runId)}&candidateIndex=${candidateIndex}`;
  const refresh = useCallback(async () => {
    const next = await json(
      await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }),
    );
    if (
      pending.current &&
      next.requests.some((request: { id: string }) => request.id === pending.current?.id)
    ) {
      pending.current = null;
      setSelected([]);
    }
    setData(next);
  }, [url]);
  useEffect(() => {
    let active = true;
    fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      .then(json)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setMessage('补证流程状态未能读取，原候选仍可查看。');
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function action(kind: 'create' | 'confirm', report?: Report, requestId?: string) {
    setBusy(true);
    setMessage('');
    try {
      if (!data?.enabled) throw new Error('通用补证写入尚未启用。');
      if (kind === 'create' && !pending.current)
        pending.current = {
          id: crypto.randomUUID(),
          supplements: data.sources
            .filter((item) => selected.includes(item.itemId))
            .map(({ batchId, itemId }) => ({ batchId, itemId })),
        };
      const request =
        kind === 'create'
          ? { ...pending.current, runId, candidateIndex, materialHash, consent: true }
          : { requestId, reportId: report!.id, planHash: report!.planHash, consent: true };
      await json(
        await fetch('/api/admin/candidate-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: kind, request }),
          signal: AbortSignal.timeout(65000),
        }),
      );
      if (kind === 'create') {
        pending.current = null;
        setSelected([]);
        setMessage('补证请求已保存，等待独立材料核验；本操作未调用 AI、未公开资料。');
      } else {
        setMessage('材料登记及核验回执已保存。仍需完成候选核验和发布确认。');
        onRegistered();
      }
      await refresh();
    } catch (error) {
      if (
        kind === 'create' &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['invalid_request', 'source_unavailable', 'invalid_candidate_source_bundle'].includes(
          String(error.code),
        )
      )
        pending.current = null;
      setMessage(error instanceof Error ? error.message : '操作未完成，请刷新核对。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.history} aria-labelledby="material-workflow-title">
      <h3 id="material-workflow-title">通用补证与登记</h3>
      <p>补证 → 独立材料核验 → 确认登记 → 候选核验。各环节分开记录，不改写原候选，不自动发布。</p>
      {message ? <p role="status">{message}</p> : null}
      {!data ? (
        <p>正在读取补证流程。</p>
      ) : !data.configured ? (
        <p>通用补证存储尚未配置；当前仍可查看已有材料。</p>
      ) : (
        <>
          {!data.enabled ? <p>写入未启用，只读查看已保存材料。</p> : null}
          <p>{data.sourceListNote}</p>
          {data.originalSourceAvailable ? (
            <p>原候选来自仍可读取的公开链接，可直接使用原来源建立核验请求，也可选择补充资料。</p>
          ) : null}
          <fieldset disabled={busy || !data.enabled || !!pending.current}>
            <legend>关联已解析公开链接资料（最多 3 份）</legend>
            {data.sources.length ? (
              data.sources.map((item) => (
                <label key={item.itemId} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.itemId)}
                    disabled={!selected.includes(item.itemId) && selected.length >= 3}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked
                          ? [...old, item.itemId]
                          : old.filter((id) => id !== item.itemId),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))
            ) : (
              <p>暂无可用链接资料，请先导入官方原文链接并完成解析。</p>
            )}
          </fieldset>
          <p>
            建立请求会保存私有材料快照，供已配置的独立核验服务读取；URL
            声明不等于公开使用许可。不会立即调用模型或产生 AI 费用。
          </p>
          <button
            type="button"
            className={controls.button}
            disabled={
              busy ||
              !data.enabled ||
              (!pending.current && !selected.length && !data.originalSourceAvailable)
            }
            onClick={() => void action('create')}
          >
            {pending.current ? '使用原请求继续建立' : '确认建立补证请求（不调用 AI）'}
          </button>
          <a className={controls.button} href="/admin/imports">
            导入补证来源
          </a>
          {data.requests.map((request) => (
            <article key={request.id} className={styles.materialCard}>
              <h4>补证材料 · {new Date(request.createdAt).toLocaleString('zh-CN')}</h4>
              <p>{request.fragmentCount} 个原文片段</p>
              {!request.reports.length ? (
                <p>等待独立材料核验报告。尚未登记，也未获得公开许可。</p>
              ) : (
                request.reports.map((report) => (
                  <div key={report.id}>
                    <h4>{report.plan.candidate.title}</h4>
                    <p>{report.plan.candidate.summary}</p>
                    <p>事件日期：{report.plan.candidate.eventDate}</p>
                    <p>
                      {report.stages.includes('verified')
                        ? '已登记 / 已收到材料核验回执'
                        : report.stages.includes('registered')
                          ? '已登记，待完成核验回执；可用原报告继续'
                          : '待确认登记'}
                    </p>
                    <p>
                      人物：
                      {report.plan.candidate.persons
                        .map(
                          (p) =>
                            `${report.plan.entities.find((e) => e.id === p.entityId)?.name}（${p.role}）`,
                        )
                        .join('、')}
                    </p>
                    <p>
                      组织：
                      {report.plan.candidate.organizationIds
                        .map((id) => report.plan.entities.find((e) => e.id === id)?.name)
                        .join('、')}
                    </p>
                    <p>领域：{report.plan.topicIds.join('、')}</p>
                    <ul>
                      {report.plan.candidate.claims.map((claim, index) => (
                        <li key={`${index}:${claim.evidenceId}`}>{claim.text}</li>
                      ))}
                    </ul>
                    <details>
                      <summary>核对公开证据及来源</summary>
                      {report.plan.evidence.map((e) => (
                        <blockquote key={e.id}>
                          <p>{e.excerpt}</p>
                          <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
                            查看来源
                          </a>
                        </blockquote>
                      ))}
                    </details>
                    {!report.stages.includes('verified') ? (
                      <button
                        className={controls.button}
                        type="button"
                        disabled={busy || !data.enabled}
                        onClick={() => void action('confirm', report, request.id)}
                      >
                        确认登记材料（不发布）
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </article>
          ))}
        </>
      )}
      <button
        className={controls.button}
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          refresh()
            .catch(() => setMessage('刷新失败，请保留原请求。'))
            .finally(() => setBusy(false));
        }}
      >
        刷新补证状态
      </button>
    </section>
  );
}
