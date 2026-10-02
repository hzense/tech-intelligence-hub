'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import type {
  AutomationConfigRecord,
  AutomationRun,
} from '../../../packages/database/src/automation-store.mjs';
import styles from './admin-automation.module.css';
import {
  automationGenerationIds,
  generationSummaryLabel,
  sourceAutomationLabel,
  type AutomationGenerationProgress,
} from '../lib/automation-generation-status';

type Kind = AutomationConfig['kind'];
type Profile = { id: string; revision: number; name: string; ready: boolean };
type Topic = { id: string; name: string };
type ConfigView = Pick<
  AutomationConfigRecord,
  'id' | 'revision' | 'config' | 'enabled' | 'next_run_at' | 'created_at' | 'updated_at'
>;
type RunView = Pick<
  AutomationRun,
  | 'id'
  | 'snapshot'
  | 'status'
  | 'phase'
  | 'result'
  | 'error_code'
  | 'created_at'
  | 'finished_at'
  | 'charged_microusd'
  | 'cost_source'
  | 'publication_status'
> & { generationProgress?: AutomationGenerationProgress };
type Dashboard = { configs: ConfigView[]; runs: RunView[]; configDeletionAvailable: boolean };
const blank = (kind: Kind): AutomationConfig => ({
  name: '',
  kind,
  enabled: false,
  frequency: kind === 'topic_insight' ? 'weekly' : 'daily',
  sourceUrls: [],
  topicIds: [],
  profileId: null,
  profileRevision: null,
  ...(kind === 'source_collection'
    ? { discovery: { keywords: [], lookbackDays: 2, maxSources: 5 } }
    : {}),
});
const errors: Record<string, string> = {
  not_configured: '此功能尚未完成数据库、权限和预算配置。',
  execution_disabled: '配置可保存，但采集执行尚未启用；本次未启动任务。',
  revision_conflict: '配置已由其他会话修改，请刷新后核对。',
  request_id_conflict: '请求编号与已有任务不匹配，请先核对任务。',
  task_active: '该配置已有正在执行的任务，请查看列表。',
  config_in_use:
    '该配置还有排队、执行中、结果未知或未释放执行锁的任务，暂不能删除。请先核对原任务和费用。',
  config_deletion_unavailable: '删除功能尚未完成数据库升级和权限核验；现有配置仍可保存。',
  not_found: '配置不存在或已被删除，请刷新列表核对。',
  commit_unknown: '操作提交结果未确认，请刷新列表核对，不要新建替代配置。',
  budget_exceeded: '今日或单次预算不足，任务未启动。',
  profile_not_ready: '所选模型配置未就绪。',
  source_url_invalid: '来源链接格式或地址不符合导入规则。',
  discovery_connection_unsupported:
    '自动联网发现需要分阶段配置的“分析”模型使用 OpenRouter 连接；生成使用“提取”模型。',
  discovery_topic_invalid: '所选领域已失效，请重新选择。',
  discovery_search_unconfirmed:
    '供应商未确认实际联网检索，已停止后续生成；请核对原任务，不要重复调用。',
  discovery_invalid_output: '检索结果格式不符合要求，未用于生成；费用仍保留。',
  discovery_unavailable: '联网发现未完成，请核对模型权限、连接与原任务。',
  capability_failed: '分析模型不支持所需工具或上下文容量，请选择兼容模型。',
  provider_rejected: '供应商拒绝请求，请核对搜索权限、模型与账户额度。',
  timeout: '供应商响应超时，结果未知；请核对原任务和费用，不要直接重试。',
  insight_stale: '证据信号已改变或撤回，请重新生成报告。',
  dispatch_unknown: '任务已保存，但派发结果未知；请先刷新核对。',
};
async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/admin/automation', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? '操作结果未确认，请刷新列表核对。');
  return result;
}
const money = (microusd: number) => `$${(microusd / 1_000_000).toFixed(4)}`;
const time = (date: string | Date | null) => (date ? new Date(date).toLocaleString('zh-CN') : '—');
function TopicReport({ result }: { result: Record<string, unknown> }) {
  const report = result.report as
    | {
        title?: string;
        summary?: string;
        sections?: { heading: string; body: string; signalIds: string[] }[];
        uncertainties?: string[];
      }
    | undefined;
  if (!report) return <p>报告结构不可用，请勿确认公开。</p>;
  return (
    <div className={styles.report}>
      <h3>{report.title}</h3>
      <p>{report.summary}</p>
      {report.sections?.map((section, index) => (
        <section key={index}>
          <h4>{section.heading}</h4>
          <p>{section.body}</p>
          <p>
            引用：
            {section.signalIds.map((id) => (
              <Link href={`/signals/${encodeURIComponent(id)}`} key={id}>
                {id}
              </Link>
            ))}
          </p>
        </section>
      ))}
      {report.uncertainties?.length ? (
        <>
          <h4>不确定性</h4>
          <ul>
            {report.uncertainties.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
function SourceResult({
  result,
  progress,
}: {
  result: Record<string, unknown>;
  progress?: AutomationGenerationProgress;
}) {
  const discovery = result.discovery as
    | {
        searchRequests?: number;
        duplicates?: number;
        rejected?: number;
        articles?: { url: string; title: string; publishedAt: string }[];
      }
    | undefined;
  const ids = automationGenerationIds(result);
  return (
    <div className={styles.report}>
      {discovery ? (
        <>
          <p>
            实际检索 {discovery.searchRequests ?? 0} 次 · 选中 {discovery.articles?.length ?? 0}{' '}
            篇原文 · 已有或重复 {discovery.duplicates ?? 0} 项 · 不符合规则{' '}
            {discovery.rejected ?? 0} 项
          </p>
          <details>
            <summary>查看发现的来源</summary>
            <ul>
              {discovery.articles?.map((article) => (
                <li key={article.url}>
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    {article.title}
                  </a>{' '}
                  · {article.publishedAt}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      {typeof result.batchId === 'string' ? (
        <Link href="/admin/imports">查看导入批次 · {result.batchId}</Link>
      ) : null}
      {progress?.total ? (
        <p>
          候选任务 {progress.total} 项 · 已完成 {progress.completed} 项 · 排队 {progress.pending} 项
          · 生成中 {progress.running} 项 · 失败 {progress.failed} 项 · 取消 {progress.cancelled} 项
          · 待核对 {progress.unknown + progress.unavailable} 项。
          <br />
          {progress.knownCandidates > 0 || progress.candidateCountComplete
            ? `已确认生成 ${progress.knownCandidates} 条私有候选`
            : '候选数量尚未确认'}
          {progress.candidateCountComplete ? '。' : '（仅统计已读取的完成结果，其余结果待核对）。'}
          候选仍需人工确认发布。
        </p>
      ) : null}
      <ul>
        {ids.map((id) => {
          const task = progress?.tasks.find((row) => row.id === id);
          return (
            <li key={id}>
              <Link href={`/admin/signal-generation/${id}`}>查看私有候选任务 · {id}</Link>
              <span>{task ? generationSummaryLabel(task) : '已登记，结果待核对'}</span>
            </li>
          );
        })}
      </ul>
      <p>资料或候选登记未完成：{Number(result.failed) || 0} 项。候选任务仍需各自完成生成与审核。</p>
    </div>
  );
}

export function AdminAutomation({
  kind,
  configured,
  executionEnabled,
  executionReadiness,
  loadError,
  initial,
  profiles,
  topics,
}: {
  kind: Kind;
  configured: boolean;
  executionEnabled: boolean;
  executionReadiness?: { ready: boolean; checks: { key: string; ready: boolean }[] };
  loadError: boolean;
  initial: Dashboard;
  profiles: Profile[];
  topics: Topic[];
}) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<AutomationConfig>(() => blank(kind));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [summaryReadFailures, setSummaryReadFailures] = useState(0);
  const createId = useRef<string | null>(null);
  const requestIds = useRef<Record<string, string>>({});
  const refreshSequence = useRef(0);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const next = await api<Dashboard>();
    if (sequence === refreshSequence.current) {
      setState(next);
      setRefreshFailed(false);
      setSummaryReadFailures(0);
    }
    return next;
  }
  async function reload() {
    if (busy || !configured) return;
    setBusy(true);
    try {
      await refresh();
      setMessage('列表已更新。');
    } catch {
      setMessage('读取失败，请稍后刷新。');
    } finally {
      setBusy(false);
    }
  }
  function edit(row: ConfigView | null) {
    setEditing(row);
    // An explicit save is required to convert a legacy fixed-URL schedule to paid discovery.
    setDraft(
      row
        ? kind === 'source_collection' && !row.config.discovery
          ? {
              ...row.config,
              sourceUrls: [],
              enabled: false,
              discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
            }
          : row.config
        : blank(kind),
    );
    createId.current = null;
    setMessage('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured) return;
    createId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ config: ConfigView }>({
        action: 'save',
        request: {
          id: editing?.id ?? createId.current,
          expectedRevision: editing?.revision ?? 0,
          config: draft.discovery
            ? {
                ...draft,
                topicIds: [],
                discovery: {
                  ...draft.discovery,
                  keywords: draft.discovery.keywords.map((word) => word.trim()).filter(Boolean),
                },
              }
            : draft,
          consent: true,
        },
      });
      createId.current = null;
      setEditing(result.config);
      setDraft(result.config.config);
      await refresh();
      setMessage(`配置已保存为 r${result.config.revision}。保存配置不会启动任务。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存结果未确认');
    } finally {
      setBusy(false);
    }
  }
  async function run(row: ConfigView) {
    if (
      busy ||
      !configured ||
      !executionEnabled ||
      !window.confirm(
        `确认启动“${row.config.name}”？运行可能产生导入或模型费用，结果需在任务列表中核对。`,
      )
    )
      return;
    requestIds.current[row.id] ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ run: RunView }>({
        action: 'trigger',
        request: {
          configId: row.id,
          expectedRevision: row.revision,
          requestId: requestIds.current[row.id],
          consent: true,
        },
      });
      delete requestIds.current[row.id];
      await refresh();
      setMessage(`任务 ${result.run.id} 已保存，请在下方查看进度。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '启动结果未确认');
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: ConfigView) {
    if (
      busy ||
      !configured ||
      !state.configDeletionAvailable ||
      !window.confirm(
        `确认删除“${row.config.name}”吗？配置将从列表隐藏并停止后续调度，不能在页面恢复。历史任务、结果和费用仍然保留，不会撤回已公开的专题。若有排队、执行中或结果未知的任务，将拒绝删除。本操作不调用 AI。`,
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await api({
        action: 'delete',
        request: { id: row.id, expectedRevision: row.revision, consent: true },
      });
      // Only remove local state after the server confirms the deletion. Retain
      // history and other unsaved edits, even if the following refresh fails.
      setState((current) => ({
        ...current,
        configs: current.configs.filter((config) => config.id !== row.id),
      }));
      if (editing?.id === row.id) edit(null);
      delete requestIds.current[row.id];
      try {
        await refresh();
        setMessage('配置已删除，后续调度已停止；历史任务、结果和费用记录保留。');
      } catch {
        setMessage('配置已删除，但列表刷新失败；请点击“刷新列表”核对。历史任务和费用记录保留。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除结果未确认，请刷新列表核对。');
    } finally {
      setBusy(false);
    }
  }
  async function publish(row: RunView, confirm: boolean) {
    if (
      busy ||
      !window.confirm(
        confirm ? '确认公开这份专题洞察？请先阅读报告及其引用。' : '确认撤回这份公开洞察？',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await api({ action: 'publish', id: row.id, confirm });
      await refresh();
      setMessage(confirm ? '专题洞察已确认公开。' : '专题洞察已撤回。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '结果未确认');
    } finally {
      setBusy(false);
    }
  }
  const configs = state.configs.filter((row) => row.config.kind === kind);
  const runs = state.runs.filter((row) => row.snapshot.kind === kind);
  const summaryReadFailed = runs.some((row) => row.generationProgress?.readFailed);
  const shouldRefresh =
    configured &&
    !busy &&
    (runs.some(
      (row) =>
        row.status === 'queued' || row.status === 'running' || row.generationProgress?.active,
    ) ||
      (summaryReadFailed && summaryReadFailures < 3));
  useEffect(() => {
    if (!shouldRefresh) return;
    let stopped = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      const sequence = ++refreshSequence.current;
      try {
        const next = await api<Dashboard>();
        if (!stopped && sequence === refreshSequence.current) {
          setState(next);
          setRefreshFailed(false);
          setSummaryReadFailures((count) =>
            next.runs.some(
              (row) => row.snapshot.kind === kind && row.generationProgress?.readFailed,
            )
              ? count + 1
              : 0,
          );
        }
      } catch {
        if (!stopped && sequence === refreshSequence.current) {
          setRefreshFailed(true);
          setSummaryReadFailures((count) => count + 1);
        }
      } finally {
        inFlight = false;
      }
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [shouldRefresh, kind]);
  const checkLabels: Record<string, string> = {
    storage: '配置存储',
    execution: '自动执行开关',
    budget: '采集预算',
    import: '资料导入服务',
    generation: '信号生成服务',
  };
  return (
    <main className={`section-shell ${styles.main}`}>
      <header className={styles.header}>
        <p className="kicker">管理后台 · 自动任务</p>
        <h1>{kind === 'source_collection' ? '自动采集配置' : '专题洞察配置'}</h1>
        <p>
          {kind === 'source_collection'
            ? '选择 AI 配置，自动搜索网站科技范围内的互联网信息、获取原文、去重并生成私有候选；无需指定领域或填写网址。候选经人工确认后发布。'
            : '按专题选择当前公开信号，生成附有引用的私有报告，确认后公开。'}
        </p>
        {loadError ? (
          <p role="alert">
            任务列表读取失败，已停用操作；请检查专用数据库连接及权限，不要将空列表当作没有任务。
          </p>
        ) : !configured ? (
          <p role="status">
            配置存储尚未就绪，暂不能保存；请配置专用数据库连接并完成迁移及权限核验。填写关键词或开启执行不能解决存储问题。
          </p>
        ) : !executionEnabled ? (
          <p>
            配置存储已就绪：可以保存配置。执行开关、预算或依赖服务尚未就绪，不能启动任务或开启定时执行。
          </p>
        ) : null}
        {executionReadiness ? (
          <details>
            <summary>执行条件（配置检查，不调用 AI）</summary>
            <ul>
              {executionReadiness.checks.map((check) => (
                <li key={check.key}>
                  {checkLabels[check.key] ?? check.key}：{check.ready ? '已配置' : '待配置'}
                </li>
              ))}
            </ul>
            <p>这里只检查服务器配置是否齐备；数据库连通性、权限和模型能力仍需实际核验。</p>
          </details>
        ) : null}
      </header>
      <section className={styles.card} aria-labelledby="config-title">
        <div className={styles.row}>
          <h2 id="config-title">
            {editing ? `编辑 ${editing.config.name} · r${editing.revision}` : '新建配置'}
          </h2>
          <button type="button" disabled={busy} onClick={() => edit(null)}>
            新建配置
          </button>
        </div>
        <form onSubmit={save} className={styles.form}>
          <label>
            配置名称
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            执行频率
            <select
              aria-label="执行频率"
              value={draft.frequency}
              onChange={(e) =>
                setDraft({ ...draft, frequency: e.target.value as AutomationConfig['frequency'] })
              }
            >
              <option value="manual">仅手动</option>
              <option value="daily">每日（UTC）</option>
              <option value="weekly">每周一（UTC）</option>
            </select>
          </label>
          <label>
            分阶段模型配置
            <select
              aria-label="分阶段模型配置"
              required
              value={draft.profileId ?? ''}
              onChange={(e) => {
                const profile = profiles.find((row) => row.id === e.target.value);
                setDraft({
                  ...draft,
                  profileId: profile?.id ?? null,
                  profileRevision: profile?.revision ?? null,
                });
              }}
            >
              <option value="">选择已就绪配置</option>
              {profiles
                .filter((row) => row.ready)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · r{row.revision}
                  </option>
                ))}
            </select>
          </label>
          {kind === 'source_collection' && draft.discovery ? (
            <>
              <p className={styles.full}>
                使用所选配置的“分析”模型（OpenRouter，须支持工具调用）联网发现，使用“提取”模型生成信号；各自的费用分别记账。检索不使用分析阶段的报告提示词。手动网址／文件请使用导入页面。
              </p>
              {editing && !editing.config.discovery ? (
                <p className={styles.full}>
                  此为旧固定网址配置。保存后将转为联网发现并关闭原计划；无需指定领域，请确认检索范围及是否启用定时执行。
                </p>
              ) : null}
              <label className={styles.full}>
                关注关键词或组织／人物（可选，用中文或英文逗号分隔，最多 10 个）
                <input
                  value={draft.discovery.keywords.join('，')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      discovery: { ...draft.discovery!, keywords: e.target.value.split(/[,，]/) },
                    })
                  }
                  placeholder="例如：推理芯片，智能体，英伟达"
                />
              </label>
              <label>
                检索时间范围
                <select
                  value={draft.discovery.lookbackDays}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      discovery: { ...draft.discovery!, lookbackDays: Number(e.target.value) },
                    })
                  }
                >
                  <option value={1}>近 1 天</option>
                  <option value={2}>近 2 天</option>
                  <option value={7}>近 7 天</option>
                  <option value={30}>近 30 天</option>
                </select>
              </label>
              <label>
                每次最多读取原文数量
                <input
                  type="number"
                  min={1}
                  max={8}
                  required
                  value={draft.discovery.maxSources}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      discovery: { ...draft.discovery!, maxSources: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <p className={styles.full}>
                每次最多搜索 3
                次。原文获取失败或没有新信息时不编造候选。采集、导入、生成分别遵守服务器配置的预算；启用计划即授权按此范围定期执行，不自动发布。
              </p>
            </>
          ) : null}
          {kind === 'source_collection' ? (
            <p className={styles.full}>
              AI 自动在网站全部科技领域内发现信息，无需指定领域。
              {editing?.config.topicIds.length
                ? '此旧配置包含领域限制，保存后将改为全站科技范围；已有运行记录保持不变。'
                : ''}
            </p>
          ) : (
            <fieldset className={styles.full}>
              <legend>分析专题（至少 1 个，最多 5 个）</legend>
              <div className={styles.topics}>
                {topics.map((topic) => (
                  <label key={topic.id}>
                    <input
                      type="checkbox"
                      checked={draft.topicIds.includes(topic.id)}
                      disabled={!draft.topicIds.includes(topic.id) && draft.topicIds.length >= 5}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          topicIds: e.target.checked
                            ? [...draft.topicIds, topic.id]
                            : draft.topicIds.filter((id) => id !== topic.id),
                        })
                      }
                    />
                    {topic.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!configured || (!executionEnabled && !draft.enabled)}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            允许定时执行（可能产生费用）
          </label>
          <button
            type="submit"
            disabled={
              !configured ||
              busy ||
              !draft.profileId ||
              (kind === 'topic_insight' && !draft.topicIds.length)
            }
          >
            {busy ? '处理中…' : '保存配置'}
          </button>
        </form>
      </section>
      <section className={styles.card} aria-labelledby="saved-title">
        <div className={styles.row}>
          <h2 id="saved-title">已保存配置</h2>
          <button type="button" disabled={!configured || busy} onClick={() => void reload()}>
            刷新列表
          </button>
        </div>
        {configured && !state.configDeletionAvailable ? (
          <p id="delete-unavailable">删除功能待完成数据库升级与最小授权；现有配置仍可保存。</p>
        ) : null}
        {configs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>频率</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.config.name} · r{row.revision}
                      {kind === 'source_collection' ? (
                        <small>
                          {row.config.discovery ? 'AI 联网发现' : '旧固定网址配置（编辑可转换）'}
                        </small>
                      ) : null}
                    </td>
                    <td>{row.config.frequency}</td>
                    <td>{row.enabled ? '定时开启' : '仅手动'}</td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => edit(row)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={busy || !configured || !executionEnabled}
                        onClick={() => void run(row)}
                      >
                        立即运行
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        aria-label={`删除配置 ${row.config.name}`}
                        aria-describedby={
                          configured && !state.configDeletionAvailable
                            ? 'delete-unavailable'
                            : undefined
                        }
                        disabled={busy || !configured || !state.configDeletionAvailable}
                        onClick={() => void remove(row)}
                      >
                        删除配置
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>暂无配置。</p>
        )}
      </section>
      <section className={styles.card} aria-labelledby="runs-title">
        <h2 id="runs-title">运行记录</h2>
        {shouldRefresh ? (
          <p>每 5 秒自动读取任务状态，不调用 AI；切换到后台标签页后暂停刷新。</p>
        ) : null}
        {refreshFailed ? (
          <p role="alert">自动刷新失败，当前显示上次读取的状态；请点击“刷新列表”核对。</p>
        ) : null}
        {summaryReadFailed ? (
          <p role="alert">
            关联候选状态暂时无法读取，不代表生成失败。仅剩不可读记录时，系统最多自动重查 3
            次；仍不可读时请点击“刷新列表”或打开原任务核对，不要重复启动。
          </p>
        ) : null}
        {runs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>创建时间</th>
                  <th>配置</th>
                  <th>状态与阶段</th>
                  <th>记账</th>
                  <th>结果与操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {time(row.created_at)}
                      <small>{row.id}</small>
                    </td>
                    <td>{row.snapshot.name}</td>
                    <td>
                      {kind === 'source_collection'
                        ? sourceAutomationLabel(row)
                        : `${row.status} · ${row.phase}`}
                      {kind === 'source_collection' ? <small>采集阶段：{row.phase}</small> : null}
                      {row.error_code ? (
                        <small>{errors[row.error_code] ?? row.error_code}</small>
                      ) : null}
                    </td>
                    <td>
                      {money(row.charged_microusd)}
                      <small>{row.cost_source ?? '未结算'}</small>
                      {kind === 'source_collection' ? (
                        <small>检索记账，不含导入和生成费用</small>
                      ) : null}
                    </td>
                    <td>
                      {row.snapshot.kind === 'topic_insight' &&
                      row.status === 'completed' &&
                      row.result ? (
                        <>
                          <details>
                            <summary>阅读私有报告</summary>
                            <TopicReport result={row.result} />
                          </details>
                          <button
                            type="button"
                            disabled={busy || row.publication_status === 'published'}
                            onClick={() => void publish(row, true)}
                          >
                            确认公开
                          </button>
                          {row.publication_status === 'published' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void publish(row, false)}
                            >
                              撤回
                            </button>
                          ) : null}
                        </>
                      ) : row.snapshot.kind === 'source_collection' && row.result ? (
                        <SourceResult
                          result={row.result}
                          {...(row.generationProgress ? { progress: row.generationProgress } : {})}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>暂无运行记录。</p>
        )}
      </section>
      {message ? (
        <p role="status" className={styles.message}>
          {message}
        </p>
      ) : null}
    </main>
  );
}
