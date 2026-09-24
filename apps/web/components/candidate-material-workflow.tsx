'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaterialPlan } from '../../../packages/database/src/material-registration-contract.mjs';
import controls from './admin-controls.module.css';
import styles from './candidate-review-editor.module.css';

type Report = { id: string; planHash: string; plan: MaterialPlan; stages: string[] };
type Proposal = {
  id: string;
  proposalHash: string;
  plan: MaterialPlan;
  dossier: { statements: Record<string, string>; eventDate: { value: string; quote: string } };
  approved: boolean;
  approvalExpiresAt: string | null;
};
type Dashboard = {
  configured: boolean;
  enabled: boolean;
  reviewEnabled?: boolean;
  originalSourceAvailable?: boolean;
  sources: Array<{ batchId: string; itemId: string; name: string; sourceUrl: string }>;
  sourceListNote?: string;
  requests: Array<{
    id: string;
    createdAt: string;
    fragmentCount: number;
    reports: Report[];
    proposals?: Proposal[];
  }>;
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
  needs_person_evidence: '当前候选缺少有原文支持的关键人物，请先进行私有 AI 补全或补充来源。',
  needs_event_time: '缺少事件发生日期及引用依据；不会改用上传时间。',
  needs_public_evidence: '现有引用不能完整对应到公开来源，请补充准确原文链接。',
  needs_organization_identity: '相关组织尚未登记，规则不能推断其实体类型；需补充实体核验材料。',
  needs_topic_evidence: '未能明确匹配启用领域，需进一步分类核验。',
  material_review_expired: '人工确认已过期，不能继续签名；请重新核对材料后建立新一轮确认。',
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
  async function reviewAction(kind: 'prepare' | 'approve', requestId: string, proposal?: Proposal) {
    if (
      kind === 'approve' &&
      !window.confirm(
        '确认您已核对页面列出的六项声明、每个来源及原文摘录，并具有所列摘录的公开引用权限？此操作仅提交独立核验，不发布信号。',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const request =
        kind === 'prepare'
          ? { requestId }
          : {
              requestId,
              proposalId: proposal!.id,
              proposalHash: proposal!.proposalHash,
              consent: true,
            };
      const result = await json(
        await fetch('/api/admin/candidate-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: kind, request }),
          signal: AbortSignal.timeout(65000),
        }),
      );
      if (kind === 'prepare')
        setMessage(
          result.ready
            ? '核验材料已准备，请核对下方提案；这不是已核实结论。'
            : (result.blockers ?? [])
                .map((code: string) => errors[code] ?? '材料尚不完整，无法准备可确认提案。')
                .join(' '),
        );
      else
        setMessage(
          result.dispatched
            ? '确认已保存，独立核验已提交；尚未登记或发布。'
            : '确认已保存，执行器尚未确认接单；请保留原请求，可用同一确认继续提交。',
        );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未完成，请刷新核对原请求。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.history} aria-labelledby="material-workflow-title">
      <h3 id="material-workflow-title">通用补证与登记</h3>
      <p>
        补证 → 准备材料 → 人工确认 → 独立复查与签名 →
        确认登记。各环节分开记录，不改写原候选，不自动发布。
      </p>
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
              {data.reviewEnabled && !request.reports.length ? (
                <>
                  <button
                    type="button"
                    className={controls.button}
                    disabled={busy || !data.enabled}
                    onClick={() => void reviewAction('prepare', request.id)}
                  >
                    准备核验材料（不调用 AI）
                  </button>
                  {(request.proposals ?? []).map((proposal) => (
                    <section key={proposal.id} aria-label="待确认核验材料">
                      <h4>
                        {proposal.plan.candidate.title} ·{' '}
                        {proposal.approved ? '人工已确认，等待独立复查' : '待人工确认'}
                      </h4>
                      <p>{proposal.plan.candidate.summary}</p>
                      <p>事件日期：{proposal.plan.candidate.eventDate}</p>
                      <blockquote>{proposal.dossier.eventDate.quote}</blockquote>
                      <p>
                        人物：
                        {proposal.plan.candidate.persons
                          .map(
                            (person) =>
                              `${proposal.plan.entities.find((entity) => entity.id === person.entityId)?.name}（${person.role}；${person.organizationId ? proposal.plan.entities.find((entity) => entity.id === person.organizationId)?.name : '无已知组织关系'}）`,
                          )
                          .join('、')}
                      </p>
                      <p>领域：{proposal.plan.topicIds.join('、')}</p>
                      <ul>
                        {proposal.plan.candidate.claims.map((claim, index) => (
                          <li key={index}>{claim.text}</li>
                        ))}
                      </ul>
                      <h5>逐来源确认范围：仅以下原文摘录，不授权其他内容</h5>
                      {proposal.plan.evidence.map((evidence) => (
                        <blockquote key={evidence.id}>
                          <p>{evidence.excerpt}</p>
                          <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">
                            {evidence.sourceUrl}
                          </a>
                        </blockquote>
                      ))}
                      <h5>确认前须核对的六项声明</h5>
                      <ul>
                        {Object.entries(proposal.dossier.statements).map(([key, statement]) => (
                          <li key={key}>{statement}</li>
                        ))}
                      </ul>
                      <p>
                        规则只准备材料，不证明上述声明。若任何一项不能确认，请勿继续；来源可访问也不等于拥有引用权限。
                      </p>
                      {proposal.approvalExpiresAt ? (
                        <p>
                          本次确认有效至：
                          {new Date(proposal.approvalExpiresAt).toLocaleString('zh-CN')}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className={controls.button}
                        disabled={
                          busy ||
                          !data.enabled ||
                          Boolean(
                            proposal.approvalExpiresAt &&
                            Date.parse(proposal.approvalExpiresAt) <= Date.now(),
                          )
                        }
                        onClick={() => void reviewAction('approve', request.id, proposal)}
                      >
                        {proposal.approved
                          ? '用已保存确认继续提交独立核验'
                          : '我已核对以上内容，确认提交独立核验'}
                      </button>
                    </section>
                  ))}
                </>
              ) : null}
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
