'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import type {
  AutomationConfigRecord,
  AutomationRunView,
} from '../../../packages/database/src/automation-store.mjs';
import { startVisiblePolling } from '../lib/visible-polling';
import styles from './admin-automation.module.css';
import { TopicInsightTags } from './topic-insight-tags';
import {
  discoveryDiagnosticItems,
  discoveryValidationItems,
} from '../lib/source-discovery-diagnostics';
import { automationSourceFailureItems } from '../lib/automation-source-failures';
import { readAutomationSourceFallbacks } from '../lib/automation-source-fallbacks';
import { parseImportRecoveryBatchId } from '../lib/import-recovery';
import { discoveryMissingTopicNames } from '../lib/source-discovery-topics';
import controls from './admin-controls.module.css';
import {
  automationGenerationIds,
  generationSummaryLabel,
  sourceAutomationAllSourcesRejected,
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
type RunView = AutomationRunView & { generationProgress?: AutomationGenerationProgress };
type Dashboard = {
  configs: ConfigView[];
  runs: RunView[];
  configDeletionAvailable: boolean;
  automaticPublicationAvailable?: boolean;
  localSchedulingAvailable?: boolean;
};
const publicationMode = (config: {
  publicationMode?: 'manual' | 'automatic';
}): 'manual' | 'automatic' => (config.publicationMode === 'automatic' ? 'automatic' : 'manual');
const publicationLabel = (config: { publicationMode?: 'manual' | 'automatic' }) =>
  publicationMode(config) === 'automatic' ? '检查合格后自动发布' : '人工审核后发布';
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
    ? { discovery: { keywords: [], lookbackDays: 2, maxSources: 8 }, publicationMode: 'manual' }
    : {}),
});
const errors: Record<string, string> = {
  not_configured: '此功能尚未完成数据库、权限和预算配置。',
  execution_disabled: '配置可保存，但任务执行尚未启用；本次未启动任务。',
  automatic_publication_unavailable:
    '自动发布服务尚未就绪。可以关闭定时并保存配置；启用服务后再启动，或改为人工审核后发布。',
  revision_conflict: '配置已由其他会话修改，请刷新后核对。',
  request_id_conflict: '请求编号与已有任务不匹配，请先核对任务。',
  task_active: '该配置已有正在执行的任务，请查看列表。',
  config_in_use:
    '该配置还有排队、执行中、尚未结束的结果未知任务，或未释放的执行锁，暂不能删除。已结束且无执行锁的历史待核对任务不会阻止删除。',
  config_deletion_unavailable: '删除功能尚未完成数据库升级和权限核验；现有配置仍可保存。',
  not_found: '配置不存在或已被删除，请刷新列表核对。',
  commit_unknown: '操作提交结果未确认，请刷新列表核对，不要新建替代配置。',
  budget_exceeded: '今日或单次预算不足，任务未启动。',
  profile_not_ready: '所选模型配置未就绪。',
  source_url_invalid: '来源链接格式或地址不符合导入规则。',
  discovery_input_too_large: '本次检索范围或排除提示过长，未调用 AI；请缩小关键词范围后重试。',
  discovery_connection_unsupported:
    '自动联网发现需要分阶段配置的“分析”模型使用 OpenRouter 连接；生成使用“提取”模型。',
  discovery_topic_invalid: '所选领域已失效，请重新选择。',
  discovery_topics_not_ready:
    '采集领域尚未全部启用，未调用 AI。请查看任务详情中的缺失领域，同步领域目录后重新启动。',
  discovery_search_unconfirmed:
    '供应商未确认实际联网检索，已停止后续生成；请核对原任务，不要重复调用。',
  discovery_invalid_output: '检索结果格式不符合要求，未用于生成；费用仍保留。',
  discovery_all_sources_rejected: '返回的来源全部未通过校验，未启动导入和生成；检索费用仍保留。',
  discovery_provider_error: '供应商返回错误结果，已停止后续生成；请核对诊断信息与费用。',
  discovery_output_truncated: '检索输出达到长度上限，结果不完整，未用于生成；费用仍保留。',
  discovery_unavailable: '联网发现未完成，请核对模型权限、连接与原任务。',
  capability_failed: '分析模型不支持所需工具或上下文容量，请选择兼容模型。',
  provider_rejected: '供应商拒绝请求，请核对搜索权限、模型与账户额度。',
  timeout: '供应商响应超时，结果未知；请核对原任务和费用，不要直接重试。',
  insight_stale: '证据信号已改变或撤回，请重新生成报告。',
  insight_topic_not_leaf:
    '专题范围包含父级或不可用方向。请重新选择当前可用的跟踪专题；旧配置可停用或删除，原报告不会自动改换专题。',
  insight_topic_not_tracked:
    '专题未达跟踪条件：须为非一级的最细分专题，并累计至少 10 条直接关联的公开信号。请重新选择；旧配置可停用或删除，原报告及其归属保留。',
  insight_insufficient_evidence:
    '近 30 天内符合范围的公开信号不足 2 条，或部分所选专题缺少对应证据。本次检查未调用 AI。',
  insight_input_too_large: '专题证据超出模型输入上限，未调用 AI；请减少所选专题后重试。',
  insight_provider_failed:
    '专题模型准备、调用或报告校验未完成；费用及依据以本行显示为准，请核对原任务，不要直接重试。',
  insight_output_truncated:
    '专题报告达到输出长度上限，内容不完整。请先核对本次费用，建议将分阶段配置中“分析”的输出上限调整为 8192，再保存并选择新修订；系统不会自动重试。',
  insight_structured_output_invalid:
    '专题模型返回的内容不符合报告结构要求；请核对原任务与费用，系统不会自动重试。',
  invalid_insight_citation:
    '专题报告的信号引用未通过校验，不能公开；请核对原任务与费用，系统不会自动重试。',
  invalid_insight: '专题报告内容未通过校验，不能公开；请核对原任务与费用，系统不会自动重试。',
  insight_unexpected_tool_call:
    '专题模型返回了本次分析不支持的工具调用，未取得可用报告；请核对原任务与费用，系统不会自动重试。',
  insight_sensitive_output:
    '专题报告未通过敏感信息检查，不能公开；请核对原任务与费用，系统不会自动重试。',
  insight_provider_timeout:
    '专题模型响应超时，调用结果及费用需核对；请保留原任务，系统不会自动重试。',
  dispatch_unknown: '任务已保存，但派发结果未知；请先刷新核对。',
};
async function api<T>(body?: unknown, signal?: AbortSignal, id?: string): Promise<T> {
  const response = await fetch(
    `/api/admin/automation${id ? `?id=${encodeURIComponent(id)}` : ''}`,
    {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? '操作结果未确认，请刷新列表核对。');
  return result;
}
const money = (microusd: number) => `$${(microusd / 1_000_000).toFixed(4)}`;
function RunCost({ row }: { row: RunView }) {
  const rejectedWithoutCharge =
    row.snapshot.kind === 'source_collection' &&
    row.status === 'failed' &&
    row.phase === 'discovery_rejected' &&
    row.error_code === 'provider_rejected' &&
    row.charged_microusd === 0 &&
    row.cost_source === 'estimate';
  return (
    <>
      {money(row.charged_microusd)}
      {rejectedWithoutCharge ? (
        <small>请求拒绝，未计费</small>
      ) : row.cost_source === 'reserve' ? (
        <>
          <small>预算暂占用</small>
          <small>实际费用未知，尚无供应商费用回执</small>
        </>
      ) : (
        <small>
          {row.cost_source === 'provider'
            ? '供应商回执'
            : row.cost_source === 'estimate'
              ? '估算'
              : '未结算'}
        </small>
      )}
      {row.snapshot.kind === 'source_collection' ? (
        <small>仅含检索，不含导入和生成费用</small>
      ) : null}
    </>
  );
}
const time = (date: string | Date | null) => (date ? new Date(date).toLocaleString('zh-CN') : '—');
const utcTime = (date: string | Date) =>
  `${new Date(date).toLocaleString('zh-CN', { timeZone: 'UTC', hour12: false })} UTC`;
function TopicReport({
  result,
  topics,
  insightLeafTopicIds,
}: {
  result: Record<string, unknown>;
  topics: Topic[];
  insightLeafTopicIds?: string[] | undefined;
}) {
  const report = result.report as
    | {
        title?: string;
        summary?: string;
        sections?: { heading: string; body: string; signalIds: string[] }[];
        uncertainties?: string[];
      }
    | undefined;
  if (!report) return <p>报告结构不可用，请勿确认公开。</p>;
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const topicIds = Array.isArray(result.topicIds)
    ? result.topicIds.filter((id): id is string => typeof id === 'string')
    : [];
  return (
    <div className={styles.report}>
      <h3>{report.title}</h3>
      <TopicInsightTags
        topics={topicIds.map((id) => ({
          id,
          name: topicNames.get(id),
          isLeaf: insightLeafTopicIds?.includes(id),
        }))}
        linked
      />
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
const insightDiagnosticCodes = new Set([
  'insight_output_truncated',
  'insight_structured_output_invalid',
  'invalid_insight_citation',
  'invalid_insight',
  'insight_unexpected_tool_call',
  'insight_sensitive_output',
  'insight_provider_failed',
  'insight_provider_timeout',
]);
const insightDiagnosticFields: Record<string, string> = {
  report: '整份报告',
  title: '标题',
  summary: '摘要',
  sections: '报告章节',
  'sections.item': '章节条目',
  'sections.heading': '章节标题',
  'sections.body': '章节正文',
  'sections.signalIds': '章节信号引用',
  uncertainties: '不确定性列表',
  'uncertainties.item': '不确定性条目',
};
const insightDiagnosticReasons: Record<string, string> = {
  wrong_type: '字段类型不符合要求',
  empty: '内容为空',
  too_long: '内容超过长度上限',
  invalid_count: '条目数量不符合要求',
  invalid_fields: '包含缺失或多余字段',
  reasoning_markup: '包含不允许的思考过程标记',
  control_character: '包含不允许的控制字符',
  invalid_citation: '信号引用不符合要求',
};
const insightFinishReasons = new Set([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
]);
function TopicResult({
  result,
  topics,
  insightLeafTopicIds,
}: {
  result: Record<string, unknown>;
  topics: Topic[];
  insightLeafTopicIds?: string[] | undefined;
}) {
  const value = result.providerDiagnostic;
  const diagnostic =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const code =
    typeof diagnostic?.code === 'string' && insightDiagnosticCodes.has(diagnostic.code)
      ? diagnostic.code
      : null;
  const field =
    typeof diagnostic?.field === 'string' &&
    Object.hasOwn(insightDiagnosticFields, diagnostic.field)
      ? insightDiagnosticFields[diagnostic.field]
      : null;
  const reason =
    typeof diagnostic?.reason === 'string' &&
    Object.hasOwn(insightDiagnosticReasons, diagnostic.reason)
      ? insightDiagnosticReasons[diagnostic.reason]
      : null;
  const finishReason =
    typeof diagnostic?.finishReason === 'string' &&
    insightFinishReasons.has(diagnostic.finishReason)
      ? diagnostic.finishReason
      : null;
  return (
    <>
      {code ? (
        <div className={styles.report}>
          <h3>专题分析诊断</h3>
          <p>{errors[code]}</p>
          {field ? <p>问题字段：{field}</p> : null}
          {reason ? <p>校验原因：{reason}</p> : null}
          {finishReason ? <p>供应商结束标记：{finishReason}</p> : null}
        </div>
      ) : null}
      {result.report && typeof result.report === 'object' ? (
        <TopicReport result={result} topics={topics} insightLeafTopicIds={insightLeafTopicIds} />
      ) : (
        <p>本次结果未保存合格报告，不能公开。</p>
      )}
    </>
  );
}
function SourceResult({
  result,
  progress,
  allSourcesRejected,
  summaryOnly = false,
}: {
  result: Record<string, unknown>;
  progress?: AutomationGenerationProgress;
  allSourcesRejected: boolean;
  summaryOnly?: boolean;
}) {
  const discovery = result.discovery as
    | {
        searchRequests?: number | null;
        searchEvidence?: 'search_count' | 'provider_url_citations';
        duplicates?: number;
        rejected?: number;
        articles?: {
          url: string;
          title: string;
          publishedAt: string;
          alternatives?: { url: string; title: string; publishedAt: string }[];
        }[];
        articleCount?: number | null;
        validation?: unknown;
      }
    | undefined;
  const ids = automationGenerationIds(result);
  const diagnostics = discoveryDiagnosticItems(result.discoveryDiagnostics);
  const missingTopics = discoveryMissingTopicNames(result.discoveryMissingTopics);
  const validation = discoveryValidationItems(discovery?.validation);
  const missingRejectionReasons =
    typeof discovery?.rejected === 'number' &&
    Number.isSafeInteger(discovery.rejected) &&
    discovery.rejected > validation.rejections.length;
  const sourceFailures = automationSourceFailureItems(result.sourceFailures);
  const sourceFallbacks = readAutomationSourceFallbacks(result.sourceFallbacks);
  const recoveryBatchId = parseImportRecoveryBatchId(result.batchId);
  // A recorded failed attempt may have been replaced; only the final unresolved
  // source count requires manual recovery. Receipts remain available below.
  const hasUnresolvedSources = typeof result.failed === 'number' && result.failed > 0;
  const searchRequests = discovery?.searchRequests;
  const knownSearchCount =
    typeof searchRequests === 'number' &&
    Number.isSafeInteger(searchRequests) &&
    searchRequests >= 0;
  return (
    <div className={styles.report}>
      {!summaryOnly && missingTopics.length ? (
        <p>尚未启用的领域：{missingTopics.join('、')}。本次未调用 AI，采集范围没有缩小。</p>
      ) : null}
      {summaryOnly && allSourcesRejected ? (
        <p>来源全部未通过校验，未启动资料导入和候选生成。</p>
      ) : null}
      {!summaryOnly && diagnostics.length ? (
        <details>
          <summary>查看检索诊断（脱敏）</summary>
          <ul>
            {diagnostics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>仅显示结构回执，不保存原始回答、思考过程或密钥；查看不会重新调用 AI。</p>
        </details>
      ) : null}
      {!summaryOnly && discovery ? (
        <>
          <p>
            {knownSearchCount ? `实际检索 ${searchRequests} 次` : '搜索次数未返回'}
            {!knownSearchCount && discovery.searchEvidence === 'provider_url_citations'
              ? ' · 已收到有效来源引用'
              : ''}{' '}
            · 选中 {discovery.articles?.length ?? '待核对'} 篇原文 · 已有或重复{' '}
            {discovery.duplicates ?? '待核对'} 项 · 不符合规则 {discovery.rejected ?? '待核对'} 项
          </p>
          {validation.summary.length || missingRejectionReasons ? (
            <details>
              <summary>查看来源校验原因（脱敏）</summary>
              {validation.summary.length ? (
                <ul>
                  {validation.summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {validation.rejections.length ? (
                <ul>
                  {validation.rejections.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {missingRejectionReasons ? (
                <p>
                  {discovery.validation === undefined
                    ? '此历史任务未记录逐条拒绝原因，无法追溯具体规则。'
                    : '部分逐条拒绝原因未记录或不可读取，无法确认具体规则。'}
                </p>
              ) : null}
              <p>一条来源可能违反多项规则；仅显示条目序号和规则分类，不展示被拒绝的原文内容。</p>
            </details>
          ) : null}
          <details>
            <summary>查看发现的来源</summary>
            <ul>
              {discovery.articles?.map((article) => (
                <li key={article.url}>
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    {article.title}
                  </a>{' '}
                  · {article.publishedAt}
                  {article.alternatives?.length ? (
                    <ul>
                      {article.alternatives.map((alternative) => (
                        <li key={alternative.url}>
                          同事件备用来源：
                          <a href={alternative.url} target="_blank" rel="noopener noreferrer">
                            {alternative.title}
                          </a>{' '}
                          · {alternative.publishedAt}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      {!summaryOnly && recoveryBatchId ? (
        <Link className={controls.button} href={`/admin/imports?batchId=${recoveryBatchId}`}>
          {hasUnresolvedSources ? '查看失败资料 / 导入替代来源' : '查看导入批次'} ·{' '}
          {recoveryBatchId}
        </Link>
      ) : null}
      {!summaryOnly && sourceFallbacks.length ? (
        <details>
          <summary>查看备用来源尝试（{sourceFallbacks.length} 项）</summary>
          <ul>
            {sourceFallbacks.map((fallback) => (
              <li key={`${fallback.primaryItemId}:${fallback.batchId}`}>
                原始来源：
                <a href={fallback.originalUrl} target="_blank" rel="noopener noreferrer">
                  {fallback.originalUrl}
                </a>
                <br />
                备用来源：
                <a href={fallback.url} target="_blank" rel="noopener noreferrer">
                  {fallback.url}
                </a>{' '}
                <Link href={`/admin/imports?batchId=${fallback.batchId}`}>
                  查看备用导入批次 · {fallback.batchId}
                </Link>
              </li>
            ))}
          </ul>
          <p>
            备用来源来自同一次检索，每个事件最多尝试 2 个，不追加付费搜索。此处仅记录导入尝试，
            不表示候选已生成或已发布；请以关联生成任务的最新状态为准。原始失败记录继续保留。
          </p>
        </details>
      ) : null}
      {!summaryOnly && hasUnresolvedSources && recoveryBatchId ? (
        <p>
          仅处理未完成的资料，无需重新执行联网检索。可导入可访问的替代链接，或上传获准使用的文档；
          解析完成后再选择资料并确认生成。原采集任务与费用保留，不会自动改为成功或自动调用 AI。
          {!sourceFailures.length
            ? '此历史任务未保存逐条处理原因，请查看原导入批次；不会重新抓取来补诊断。'
            : ''}
        </p>
      ) : null}
      {!summaryOnly && sourceFailures.length ? (
        <details>
          <summary>查看来源处理失败原因（脱敏）</summary>
          <ul>
            {sourceFailures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
          <p>仅显示已确认的原文导入失败或候选创建拒绝原因；查看不会重新导入或调用 AI。</p>
        </details>
      ) : null}
      {summaryOnly && progress?.total ? (
        <p>
          候选任务 {progress.total} 项 · 已完成 {progress.completed} 项 · 排队 {progress.pending} 项
          · 生成中 {progress.running} 项 · 失败 {progress.failed} 项 · 取消 {progress.cancelled} 项
          · 待核对 {progress.unknown + progress.unavailable} 项。
          <br />
          {progress.knownCandidates > 0 || progress.candidateCountComplete
            ? `已确认生成 ${progress.knownCandidates} 条候选`
            : '候选数量尚未确认'}
          {progress.candidateCountComplete ? '。' : '（仅统计已读取的完成结果，其余结果待核对）。'}
          是否自动发布取决于任务创建时的发布方式；检查未通过的候选在任务内处理。请以最新发布状态为准。
        </p>
      ) : null}
      {summaryOnly ? (
        <ul>
          {ids.map((id) => {
            const task = progress?.tasks.find((row) => row.id === id);
            return (
              <li key={id}>
                <Link href={`/admin/signal-generation/${id}`}>查看生成任务 · {id}</Link>
                <span>{task ? generationSummaryLabel(task) : '已登记，结果待核对'}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {summaryOnly &&
      typeof result.failed === 'number' &&
      Number.isSafeInteger(result.failed) &&
      result.failed > 0 ? (
        <p>
          资料或候选登记未完成：{result.failed} 项。
          {ids.length ? '候选任务仍需各自完成生成与发布检查。' : ''}
        </p>
      ) : null}
    </div>
  );
}

function AutomationResultDetails({
  row,
  topics,
  insightLeafTopicIds,
  onDetailRead,
}: {
  row: RunView;
  topics: Topic[];
  insightLeafTopicIds?: string[] | undefined;
  onDetailRead?: (detail: AutomationRunView) => void;
}) {
  const [detail, setDetail] = useState<AutomationRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function close() {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setDetail(null);
    setError('');
  }
  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const next = await api<{ run: AutomationRunView }>(undefined, controller.signal, row.id);
      if (next?.run?.id !== row.id || next.run.snapshot?.kind !== row.snapshot.kind)
        throw new Error('返回的详情与当前任务不一致，已保留原详情；请刷新列表后核对。');
      if (!controller.signal.aborted) {
        setDetail(next.run);
        onDetailRead?.(next.run);
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : '详情读取失败，请重试。');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  return (
    <div>
      <button type="button" disabled={loading} onClick={() => void load()}>
        {loading
          ? '读取详情中…'
          : detail
            ? '刷新详情'
            : row.snapshot.kind === 'topic_insight'
              ? row.status === 'unknown'
                ? '查看待核对结果'
                : row.status === 'failed'
                  ? '查看失败详情'
                  : '阅读私有报告'
              : '查看采集详情'}
      </button>
      {detail ? (
        <button type="button" onClick={close}>
          收起详情
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {detail ? (
        <>
          <p>详情按需读取，不自动刷新，也不会调用 AI。</p>
          {detail.result ? (
            detail.snapshot.kind === 'topic_insight' ? (
              <TopicResult
                result={detail.result}
                topics={topics}
                insightLeafTopicIds={insightLeafTopicIds}
              />
            ) : (
              <SourceResult
                result={detail.result}
                allSourcesRejected={sourceAutomationAllSourcesRejected(detail)}
              />
            )
          ) : (
            <p>此任务尚无可查看的结果。</p>
          )}
        </>
      ) : null}
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
  insightLeafTopicIds,
  insightTrackedTopicIds,
  insightTopicsLoadError = false,
  localMode = false,
  localRealAiMode = false,
}: {
  kind: Kind;
  configured: boolean;
  executionEnabled: boolean;
  executionReadiness?: { ready: boolean; checks: { key: string; ready: boolean }[] };
  loadError: boolean;
  initial: Dashboard;
  profiles: Profile[];
  topics: Topic[];
  insightLeafTopicIds?: string[];
  insightTrackedTopicIds?: string[];
  insightTopicsLoadError?: boolean;
  localMode?: boolean;
  localRealAiMode?: boolean;
}) {
  const localRealExecution = localMode && localRealAiMode;
  const localSourceManual = localRealExecution && kind === 'source_collection';
  const localTopicExecution = localRealExecution && kind === 'topic_insight';
  const manualExecutionAllowed = executionEnabled && (!localMode || localRealExecution);
  const [state, setState] = useState(initial);
  const [readTopicDetails, setReadTopicDetails] = useState<Record<string, AutomationRunView>>({});
  const localSchedulingAllowed = localRealExecution && state.localSchedulingAvailable === true;
  const insightTopicsReady = insightTrackedTopicIds !== undefined && !insightTopicsLoadError;
  const insightTrackedIds = new Set(insightTrackedTopicIds ?? []);
  const insightChoices = insightTopicsReady
    ? topics.filter((topic) => insightTrackedIds.has(topic.id))
    : [];
  function validInsightTopicIds(topicIds: unknown): boolean {
    return (
      insightTopicsReady &&
      Array.isArray(topicIds) &&
      topicIds.length > 0 &&
      topicIds.length <= 5 &&
      new Set(topicIds).size === topicIds.length &&
      topicIds.every((id) => typeof id === 'string' && insightTrackedIds.has(id))
    );
  }
  function validInsightTopics(config: AutomationConfig): boolean {
    return config.kind !== 'topic_insight' || validInsightTopicIds(config.topicIds);
  }
  function topicPublicationIssue(row: RunView): string | null {
    if (!insightTopicsReady) return '跟踪专题目录未就绪，暂不能确认公开；已公开报告仍可撤回。';
    const detail = readTopicDetails[row.id];
    if (!detail) return '请先阅读报告，核对报告的真实专题范围后再确认公开。';
    if (
      detail.status !== 'completed' ||
      !detail.result?.report ||
      typeof detail.result.report !== 'object' ||
      Array.isArray(detail.result.report)
    )
      return '报告尚未完成或结构不可用，不能确认公开。';
    if (!validInsightTopicIds(detail.result.topicIds))
      return '报告专题未达当前跟踪条件，或归属未确认，暂不能确认公开；原报告及其真实归属保留。';
    return null;
  }
  function draftForMode(config: AutomationConfig): AutomationConfig {
    const normalized =
      config.kind === 'source_collection'
        ? { ...config, publicationMode: publicationMode(config) }
        : config;
    return localMode && !localSchedulingAllowed
      ? { ...normalized, enabled: false, frequency: 'manual' }
      : normalized;
  }
  function profileReady(row: ConfigView): boolean {
    return profiles.some(
      (profile) =>
        profile.id === row.config.profileId &&
        profile.revision === row.config.profileRevision &&
        profile.ready,
    );
  }
  function canRun(row: ConfigView): boolean {
    return (
      configured &&
      manualExecutionAllowed &&
      validInsightTopics(row.config) &&
      (!localMode || profileReady(row)) &&
      (row.config.kind !== 'source_collection' ||
        publicationMode(row.config) !== 'automatic' ||
        state.automaticPublicationAvailable === true)
    );
  }
  const [editing, setEditing] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<AutomationConfig>(() => draftForMode(blank(kind)));
  const outdatedTopicIds =
    kind === 'topic_insight' && insightTopicsReady
      ? draft.topicIds.filter((id) => !insightTrackedIds.has(id))
      : [];
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [summaryReadFailures, setSummaryReadFailures] = useState(0);
  const createId = useRef<string | null>(null);
  const requestIds = useRef<
    Record<string, { id: string; revision: number; publicationMode: 'manual' | 'automatic' }>
  >({});
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
      draftForMode(
        row
          ? kind === 'source_collection' && !row.config.discovery
            ? {
                ...row.config,
                sourceUrls: [],
                enabled: false,
                discovery: { keywords: [], lookbackDays: 2, maxSources: 8 },
              }
            : row.config
          : blank(kind),
      ),
    );
    createId.current = null;
    setMessage('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured || !validInsightTopics(draft)) return;
    const savedDraft = draftForMode(draft);
    if (
      savedDraft.kind === 'source_collection' &&
      publicationMode(savedDraft) === 'automatic' &&
      !window.confirm(
        `确认将“${savedDraft.name}”保存为自动发布？之后按此配置新建的任务会将检查合格的公开网页信号直接发布到${localMode ? '本地信号列表' : '网站'}，无需逐条审核；上传原件、受保护链接及未通过检查的候选不会自动公开。历史任务不变。本次仅保存配置，不立即启动采集、调用 AI 或发布。`,
      )
    )
      return;
    createId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ config: ConfigView }>({
        action: 'save',
        request: {
          id: editing?.id ?? createId.current,
          expectedRevision: editing?.revision ?? 0,
          config: savedDraft.discovery
            ? {
                ...savedDraft,
                topicIds: [],
                discovery: {
                  ...savedDraft.discovery,
                  keywords: savedDraft.discovery.keywords
                    .map((word) => word.trim())
                    .filter(Boolean),
                },
              }
            : savedDraft,
          consent: true,
        },
      });
      createId.current = null;
      delete requestIds.current[result.config.id];
      setEditing(result.config);
      setDraft(draftForMode(result.config.config));
      await refresh();
      setMessage(
        `配置已保存为 r${result.config.revision}。${localSchedulingAllowed && result.config.enabled ? '本地定时已开启，将从下一个计划时点执行；本次保存不会立即启动任务。' : '保存配置不会启动任务。'}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存结果未确认');
    } finally {
      setBusy(false);
    }
  }
  async function run(row: ConfigView) {
    if (
      busy ||
      !canRun(row) ||
      !window.confirm(
        localSourceManual
          ? `确认启动本地采集“${row.config.name}”？将联网搜索、获取原文，并将资料发送给所选 AI 供应商，可能产生检索和模型费用。结果仅保存在本地，不同步生产；${publicationMode(row.config) === 'automatic' ? '检查合格的公开网页信号会直接发布到本地信号列表，无需逐条审核' : '生成候选需人工审核后发布'}。本次仅手动执行，不改变定时设置。`
          : localTopicExecution
            ? `确认生成本地专题洞察“${row.config.name}”？将近 30 天内所选专题的 2–100 条当前公开信号发送给所选配置的“分析”模型，可能产生模型费用，并与本地联网采集共用自动任务预算。报告先保存在本地，须阅读并单独确认后才在本地公开，不同步生产。本次仅手动执行，不改变定时设置。`
            : `确认启动“${row.config.name}”？运行可能产生导入或模型费用。${row.config.kind === 'source_collection' && publicationMode(row.config) === 'automatic' ? '检查合格的公开网页信号会直接发布，无需逐条审核。' : '结果需人工确认后发布。'}结果需在任务列表中核对。`,
      )
    )
      return;
    const previous = requestIds.current[row.id];
    if (
      !previous ||
      previous.revision !== row.revision ||
      previous.publicationMode !== publicationMode(row.config)
    ) {
      requestIds.current[row.id] = {
        id: crypto.randomUUID(),
        revision: row.revision,
        publicationMode: publicationMode(row.config),
      };
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ run: RunView }>({
        action: 'trigger',
        request: {
          configId: row.id,
          expectedRevision: row.revision,
          requestId: requestIds.current[row.id]!.id,
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
  async function disableSchedule(row: ConfigView) {
    if (busy || !configured || !row.enabled || row.config.kind !== 'topic_insight') return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ config: ConfigView }>({
        action: 'save',
        request: {
          id: row.id,
          expectedRevision: row.revision,
          config: { ...row.config, enabled: false },
          consent: true,
        },
      });
      if (editing?.id === row.id) {
        setEditing(result.config);
        setDraft(draftForMode(result.config.config));
      }
      await refresh();
      setMessage('定时已停用，原专题范围和历史报告保留；已开始的任务不会因此取消。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停用结果未确认，请刷新列表核对。');
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
        `确认删除“${row.config.name}”吗？配置将从列表隐藏并停止后续调度，不能在页面恢复。历史任务、候选、结果和费用仍然保留，不会撤回已公开的信号或专题，也不会取消已有子任务。已结束且无执行锁的历史待核对任务允许保留后删除配置；删除不表示这些任务已核对成功。若有排队、执行中、尚未结束的结果未知任务，或未释放的执行锁，将拒绝删除。本操作不调用 AI。`,
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
      row.status !== 'completed' ||
      (confirm && topicPublicationIssue(row) !== null) ||
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
    !refreshFailed &&
    (runs.some(
      (row) =>
        row.status === 'queued' || row.status === 'running' || row.generationProgress?.active,
    ) ||
      (summaryReadFailed && summaryReadFailures < 3));
  useEffect(() => {
    if (!shouldRefresh) return;
    return startVisiblePolling({
      poll: async (signal) => {
        const sequence = ++refreshSequence.current;
        const next = await api<Dashboard>(undefined, signal);
        if (!signal.aborted && sequence === refreshSequence.current) {
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
      },
      onError: () => {
        setRefreshFailed(true);
        setSummaryReadFailures((count) => count + 1);
      },
    });
  }, [shouldRefresh, kind]);
  const checkLabels: Record<string, string> = {
    storage: '配置存储',
    execution: kind === 'topic_insight' ? '专题生成开关' : '自动执行开关',
    budget: '自动任务共享预算',
    import: '资料导入服务',
    generation: '信号生成服务',
  };
  return (
    <main className={`section-shell ${styles.main}`}>
      <header className={styles.header}>
        <p className="kicker">管理后台 · 自动任务</p>
        <h1>{kind === 'source_collection' ? '自动采集配置' : '专题洞察配置'}</h1>
        {localMode ? (
          <p role="status">
            {localSourceManual
              ? `本地真实采集：运行会联网搜索、获取原文，并将资料发送给所选 AI 供应商，可能产生检索与模型费用。配置、资料和候选仅保存在本地，不同步生产；是否发布到本地信号列表由配置中的发布方式决定。${localSchedulingAllowed ? '可自行选择频率并勾选“允许定时执行”，保存后开启本地定时；新配置默认关闭。' : '本地定时保持关闭；保存配置不会启动采集。'}`
              : localTopicExecution
                ? `本地专题洞察：使用所选配置的“分析”模型，将近 30 天内所选专题的 2–100 条当前公开信号发送给 AI 供应商，可能产生模型费用。报告附信号引用，先私有保存，阅读后须单独确认公开，也可撤回；本地公开内容不自动同步生产。${localSchedulingAllowed ? '可自行选择频率并勾选“允许定时执行”，保存后开启本地定时；新配置默认关闭。' : '本地定时保持关闭；保存配置不会生成报告。'}`
                : kind === 'topic_insight'
                  ? '本地配置模式：可保存和修订模型草稿及专题配置，可阅读已有报告，并人工确认公开或撤回；这些操作不调用 AI。当前模式不执行专题生成或定时任务，不同步生产。'
                  : '本地配置模式：可选择未完成能力测试的模型草稿，保存和修订仅写入本机数据库。当前模式不执行采集或定时任务；不会联网搜索、调用 AI 或同步生产。'}
          </p>
        ) : null}
        {localRealExecution ? (
          <p>
            本地联网采集与专题分析共用自动任务预算：每次 $5、UTC 每日合计 $10；专题没有额外日额度。
            信号生成另计每批 $5、UTC 每日 $10，能力测试另计。 系统预算与预留不等于供应商最终账单。
          </p>
        ) : null}
        {!localMode ? (
          <p>
            {kind === 'source_collection'
              ? '选择 AI 配置，自动搜索网站科技范围内的互联网信息、获取原文、去重并生成候选；无需指定领域或填写网址。可选择人工审核后发布，或检查合格后自动发布。'
              : '选择 1–5 个跟踪专题，使用“分析”模型读取近 30 天的 2–100 条当前公开信号，生成附有引用的私有报告，阅读后单独确认公开，亦可撤回。'}
          </p>
        ) : null}
        {loadError ? (
          <p role="alert">
            任务列表读取失败，已停用操作；请检查专用数据库连接及权限，不要将空列表当作没有任务。
          </p>
        ) : !configured ? (
          <p role="status">
            配置存储尚未就绪，暂不能保存；请配置专用数据库连接并完成迁移及权限核验。
            {kind === 'source_collection'
              ? '填写关键词或开启执行不能解决存储问题。'
              : '选择专题或开启执行不能解决存储问题。'}
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
        {kind === 'topic_insight' && !insightTopicsReady ? (
          <p role="alert">
            跟踪专题目录或公开信号读取失败，已阻止新建、修订、生成和新确认公开；请刷新页面重试。
            历史报告仍可阅读，已有配置可通过列表尝试停用或删除。
          </p>
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
              aria-describedby={localMode ? 'local-schedule-help' : undefined}
              disabled={localMode && !localSchedulingAllowed}
              value={draft.frequency}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  frequency: e.target.value as AutomationConfig['frequency'],
                  ...(localSchedulingAllowed && e.target.value === 'manual'
                    ? { enabled: false }
                    : {}),
                })
              }
            >
              <option value="manual">仅手动</option>
              <option value="daily">
                {localSchedulingAllowed ? '每日 00:00（UTC）' : '每日（UTC）'}
              </option>
              <option value="weekly">
                {localSchedulingAllowed ? '每周一 00:00（UTC）' : '每周一（UTC）'}
              </option>
            </select>
          </label>
          {localMode ? (
            <p id="local-schedule-help" className={styles.full}>
              {localSchedulingAllowed
                ? '每日在 UTC 00:00、每周在周一 UTC 00:00 执行。勾选并保存后，从下一个计划时点开始，不会立即执行。计算机和本地开发服务须保持运行；停止服务或休眠期间暂停，恢复后不会逐日补跑。选择“仅手动”会关闭定时；仍可点击“立即运行”。'
                : localRealExecution
                  ? '本地只允许手动启动；已有配置的定时计划不会执行，保存时保持定时关闭。'
                  : '本地草稿不执行任务；已有配置的定时计划不会执行，保存时保持定时关闭。'}
            </p>
          ) : null}
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
              <option value="">
                {localMode ? '选择本地模型配置（可选草稿）' : '选择已就绪配置'}
              </option>
              {profiles
                .filter((row) => localMode || row.ready)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · r{row.revision}
                    {localMode && !row.ready ? ' · 草稿，未验证' : ''}
                  </option>
                ))}
            </select>
          </label>
          {kind === 'source_collection' ? (
            <>
              <label>
                发布方式
                <select
                  aria-label="发布方式"
                  aria-describedby="publication-mode-help"
                  value={publicationMode(draft)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      publicationMode: event.target.value === 'automatic' ? 'automatic' : 'manual',
                    })
                  }
                >
                  <option value="manual">人工审核后发布</option>
                  <option value="automatic">检查合格后自动发布</option>
                </select>
              </label>
              <div
                id="publication-mode-help"
                className={`${styles.full} ${styles.publicationHelp}`}
              >
                <p>
                  自动发布仅适用于新任务中检查合格的公开网页信号；原件、受保护链接和缺项候选不会自动公开。
                  {localMode ? '本地发布仅写入本机数据库，不同步生产。' : ''}
                  保存配置不会立即启动任务或发布。历史任务只遵循创建时的配置快照。
                </p>
                {publicationMode(draft) === 'automatic' &&
                state.automaticPublicationAvailable !== true ? (
                  <p role="status">
                    自动发布服务尚未就绪：仍可保存配置，但不能启动该配置或开启定时执行。
                    {draft.enabled ? '请先取消“允许定时执行”再保存。' : ''}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
          {localRealExecution ? (
            <p className={styles.full}>
              可保存未验证的模型草稿；立即运行{localSchedulingAllowed ? '和开启定时' : ''}
              必须选用当前修订已通过能力测试的配置。修改模型配置后，请重新选择并保存当前修订。
            </p>
          ) : null}
          {kind === 'source_collection' && draft.discovery ? (
            <>
              <p className={styles.full}>
                使用所选配置的“分析”模型（OpenRouter，须支持工具调用）联网发现，使用“提取”模型生成信号；各自的费用分别记账。检索不使用分析阶段的报告提示词。手动网址／文件请使用导入页面。
              </p>
              {editing && !editing.config.discovery ? (
                <p className={styles.full}>
                  {localMode && !localSchedulingAllowed
                    ? '此为旧固定网址配置。保存后将转为联网发现并关闭原计划；本地仅支持手动启动，请确认检索范围。'
                    : '此为旧固定网址配置。保存后将转为联网发现并关闭原计划；无需指定领域，请确认检索范围及是否启用定时执行。'}
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
                每次最多采集事件数量
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
                每次采集累计最多 24 条搜索候选，从中选入最多 8
                篇原文；数量为上限，合格后才生成／发布，所有领域由系统安排。
              </p>
              <p className={styles.full}>
                每次最多搜索 3 次。每事件读取 1 篇首选原文，访问失败后最多依次尝试 2
                篇同次检索的备用原文，成功即停止；不追加付费检索，也不重复创建该事件的生成任务。
                原文均不可用或没有新信息时不编造候选。采集、导入、生成分别遵守服务器配置的预算；
                {localMode
                  ? localSchedulingAllowed
                    ? '本地定时须勾选并保存后才会启用；手动启动前仍需确认联网与计费。是否发布到本地信号列表按发布方式执行。'
                    : '本地定时关闭，手动启动前仍需确认联网与计费；是否发布到本地信号列表按发布方式执行。'
                  : '启用计划即授权按此范围和发布方式定期执行。'}
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
              <legend>跟踪专题（至少 1 个，最多 5 个）</legend>
              <p>
                只列出当前启用、非一级且没有下级的专题，并须累计至少 10
                条直接关联的公开信号，按信号去重，不限日期。
              </p>
              <p>
                本次分析另要求近 30 天内合计 2–100 条公开信号，且每个所选专题均有对应证据；累计达到
                10 条不代表近期证据充足。
              </p>
              {outdatedTopicIds.length ? (
                <div role="status">
                  <p>
                    专题未达跟踪条件：
                    {outdatedTopicIds
                      .map((id) => topics.find((topic) => topic.id === id)?.name ?? id)
                      .join('、')}
                    。
                    请清除旧范围后重新选择；系统不会猜测或更改专题归属。只需停止原计划时，请使用列表中的“停用定时”。
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft({ ...draft, topicIds: [], enabled: false })}
                  >
                    清除旧范围并重新选择
                  </button>
                </div>
              ) : null}
              {insightTopicsReady && insightChoices.length === 0 ? (
                <p>
                  暂无满足跟踪条件的专题；须为已启用的非一级叶子，且累计至少 10
                  条直接关联的公开信号。
                </p>
              ) : null}
              <div className={styles.topics}>
                {insightChoices.map((topic) => (
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
              aria-describedby={localMode ? 'local-schedule-help' : undefined}
              checked={draft.enabled}
              disabled={
                (localMode && !localSchedulingAllowed) ||
                (localSchedulingAllowed && draft.frequency === 'manual') ||
                !configured ||
                (!draft.enabled &&
                  (!executionEnabled ||
                    !validInsightTopics(draft) ||
                    (localRealExecution &&
                      !profiles.some(
                        (profile) =>
                          profile.id === draft.profileId &&
                          profile.revision === draft.profileRevision &&
                          profile.ready,
                      )) ||
                    (kind === 'source_collection' &&
                      publicationMode(draft) === 'automatic' &&
                      state.automaticPublicationAvailable !== true)))
              }
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            允许定时执行（可能产生费用）
          </label>
          <button
            type="submit"
            disabled={!configured || busy || !draft.profileId || !validInsightTopics(draft)}
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
                  {kind === 'source_collection' ? <th>发布方式</th> : null}
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
                    <td>
                      {localMode && !localSchedulingAllowed ? 'manual' : row.config.frequency}
                      {localSchedulingAllowed && row.enabled && row.next_run_at ? (
                        <small>下次计划：{utcTime(row.next_run_at)}</small>
                      ) : null}
                    </td>
                    {kind === 'source_collection' ? <td>{publicationLabel(row.config)}</td> : null}
                    <td>
                      {kind === 'topic_insight' && !validInsightTopics(row.config)
                        ? insightTopicsReady
                          ? '专题未达跟踪条件 · 不能运行'
                          : '专题目录未就绪 · 不能运行'
                        : localRealExecution
                          ? !profileReady(row)
                            ? '模型未就绪 · 不能运行'
                            : manualExecutionAllowed
                              ? localSchedulingAllowed
                                ? row.enabled
                                  ? '本地定时开启'
                                  : '本地定时关闭'
                                : '本地仅手动 · 定时关闭'
                              : '执行未就绪 · 定时关闭'
                          : localMode
                            ? '本地草稿 · 不执行'
                            : row.enabled
                              ? '定时开启'
                              : '仅手动'}
                      {kind === 'source_collection' &&
                      publicationMode(row.config) === 'automatic' &&
                      state.automaticPublicationAvailable !== true ? (
                        <small>自动发布未就绪 · 不能运行</small>
                      ) : null}
                    </td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => edit(row)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={busy || !canRun(row)}
                        onClick={() => void run(row)}
                      >
                        立即运行
                      </button>
                      {kind === 'topic_insight' && row.enabled ? (
                        <button
                          type="button"
                          disabled={busy || !configured}
                          onClick={() => void disableSchedule(row)}
                        >
                          停用定时
                        </button>
                      ) : null}
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
          <p>
            每 15 秒自动读取任务摘要，不调用
            AI；后台标签页暂停，返回后立即更新。报告与来源详情仅在点击时读取。
          </p>
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
                  <th>费用与预算</th>
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
                    <td>
                      <span>{row.snapshot.name}</span>
                      {kind === 'source_collection' ? (
                        <small>任务快照：{publicationLabel(row.snapshot)}</small>
                      ) : null}
                    </td>
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
                      <RunCost row={row} />
                    </td>
                    <td>
                      {row.snapshot.kind === 'topic_insight' &&
                      (row.status === 'failed' ||
                        ((row.status === 'completed' || row.status === 'unknown') &&
                          row.result)) ? (
                        <>
                          <AutomationResultDetails
                            key={`${row.id}:${row.status}:${row.phase}`}
                            row={row}
                            topics={topics}
                            insightLeafTopicIds={insightLeafTopicIds}
                            onDetailRead={(detail) =>
                              setReadTopicDetails((current) => ({ ...current, [row.id]: detail }))
                            }
                          />
                          {row.status === 'completed' ? (
                            <>
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  row.publication_status === 'published' ||
                                  topicPublicationIssue(row) !== null
                                }
                                onClick={() => void publish(row, true)}
                              >
                                确认公开
                              </button>
                              {row.publication_status !== 'published' &&
                              topicPublicationIssue(row) ? (
                                <p>{topicPublicationIssue(row)}</p>
                              ) : null}
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
                          ) : row.status === 'unknown' ? (
                            <p>已保留结果供核对；任务结果仍未知，不能公开，请勿重复生成。</p>
                          ) : null}
                        </>
                      ) : row.snapshot.kind === 'source_collection' && row.result ? (
                        <>
                          <SourceResult
                            result={row.result}
                            summaryOnly
                            allSourcesRejected={sourceAutomationAllSourcesRejected(row)}
                            {...(row.generationProgress
                              ? { progress: row.generationProgress }
                              : {})}
                          />
                          <AutomationResultDetails
                            key={`${row.id}:${row.status}:${row.phase}`}
                            row={row}
                            topics={topics}
                            insightLeafTopicIds={insightLeafTopicIds}
                          />
                        </>
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
