/** Structural receipts only: never retain prompts, answers, citations or provider messages. */
import {
  decodeDiscoveryOutput,
  type DiscoveryOutputFormat,
  type DiscoveryOutputIssue,
} from './source-discovery-output.ts';
import {
  discoveryRejectionReasons,
  type DiscoveryRejectionReason,
} from './source-discovery-rejections.ts';

export const discoverySearchLimit = 3;
const finishReasons = [
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
  'function_call',
] as const;
type FinishReason = (typeof finishReasons)[number] | 'other' | 'missing';
type SearchCountStatus = 'missing' | 'invalid' | 'zero' | 'confirmed' | 'exceeded';
export interface DiscoveryDiagnostics {
  version: 1;
  responseId: string | null;
  searchRequests: number | null;
  searchCountStatus: SearchCountStatus;
  finishReason: FinishReason;
  choiceCount: number | null;
  annotationCount: number | null;
  providerError: boolean;
  providerErrorCode: number | null;
  // Optional for compatibility with historical version 1 receipts.
  outputFormat?: DiscoveryOutputFormat;
  outputIssue?: DiscoveryOutputIssue | null;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const responseId = (value: unknown): string | null =>
  typeof value === 'string' && /^gen-\d{10,16}-[a-zA-Z0-9]{8,64}$/.test(value) ? value : null;
const finishReason = (value: unknown): FinishReason =>
  value === undefined || value === null
    ? 'missing'
    : finishReasons.includes(value as (typeof finishReasons)[number])
      ? (value as FinishReason)
      : 'other';
const errorCode = (value: unknown): number | null => {
  const code = count(value);
  return code !== null && code >= 400 && code <= 599 ? code : null;
};

export function readDiscoveryDiagnostics(body: unknown): DiscoveryDiagnostics {
  const envelope = record(body);
  const choices = Array.isArray(envelope.choices) ? envelope.choices : null;
  const choice = record(choices?.[0]);
  const message = record(choice.message);
  const usage = record(envelope.usage);
  const malformedUsage =
    (envelope.usage !== undefined && !isRecord(envelope.usage)) ||
    (usage.server_tool_use !== undefined && !isRecord(usage.server_tool_use));
  const rawCount = record(usage.server_tool_use).web_search_requests;
  const searchRequests = count(rawCount);
  const output = decodeDiscoveryOutput(message.content);
  return {
    version: 1,
    responseId: responseId(envelope.id),
    searchRequests,
    searchCountStatus: malformedUsage
      ? 'invalid'
      : rawCount === undefined
        ? 'missing'
        : searchRequests === null
          ? 'invalid'
          : searchRequests === 0
            ? 'zero'
            : searchRequests > discoverySearchLimit
              ? 'exceeded'
              : 'confirmed',
    finishReason: finishReason(choice.finish_reason),
    choiceCount: choices?.length ?? null,
    annotationCount: Array.isArray(message.annotations) ? message.annotations.length : null,
    providerError:
      envelope.error != null || choice.error != null || choice.finish_reason === 'error',
    providerErrorCode: errorCode(record(envelope.error ?? choice.error).code),
    outputFormat: output.format,
    outputIssue: output.issue,
  };
}

/** Defensive readback of the private JSON receipt; unknown fields never reach the page. */
export function discoveryDiagnosticItems(value: unknown): string[] {
  const row = record(value);
  if (row.version !== 1) return [];
  const labels: Record<SearchCountStatus, string> = {
    missing: '供应商未返回搜索次数',
    invalid: '搜索次数格式异常',
    zero: '供应商确认搜索 0 次',
    confirmed: '搜索次数已确认',
    exceeded: '搜索次数超过上限',
  };
  const status =
    typeof row.searchCountStatus === 'string' && Object.hasOwn(labels, row.searchCountStatus)
      ? labels[row.searchCountStatus as SearchCountStatus]
      : '搜索回执不可读';
  const requests = count(row.searchRequests);
  const reason = row.finishReason === 'missing' ? 'missing' : finishReason(row.finishReason);
  const id = responseId(row.responseId);
  const code = errorCode(row.providerErrorCode);
  const formats: Record<DiscoveryOutputFormat, string> = {
    json: 'JSON',
    json_fence: 'JSON 代码块',
    invalid: '无法解析为 JSON',
    non_text: '未返回文本',
  };
  const issues: Record<DiscoveryOutputIssue, string> = {
    content_not_text: '未返回文本内容',
    invalid_json: 'JSON 格式无效',
    invalid_root: '顶层必须为仅含 articles 的对象',
    invalid_articles: 'articles 必须为数组',
    too_many_articles: '原文条目超过 8 条上限',
  };
  return [
    `搜索回执：${status}${requests === null ? '' : `（${requests} 次，上限 ${discoverySearchLimit} 次）`}`,
    `结束原因：${reason}`,
    `响应选项：${count(row.choiceCount) ?? '未返回'} · 引用条目：${count(row.annotationCount) ?? '未返回'}`,
    ...(typeof row.outputFormat === 'string' && Object.hasOwn(formats, row.outputFormat)
      ? [`输出格式：${formats[row.outputFormat as DiscoveryOutputFormat]}`]
      : []),
    ...(typeof row.outputIssue === 'string' && Object.hasOwn(issues, row.outputIssue)
      ? [`结构校验：${issues[row.outputIssue as DiscoveryOutputIssue]}`]
      : []),
    ...(row.providerError === true ? [`供应商错误：${code ?? '未提供标准错误码'}`] : []),
    ...(id ? [`供应商响应 ID：${id}`] : []),
  ];
}

const rejectionLabels: Record<DiscoveryRejectionReason, string> = {
  invalid_article: '条目不是有效对象',
  invalid_url: '来源网址无效或不安全',
  uncited_url: '来源网址与供应商引用不匹配',
  non_article_url: '来源是列表或订阅页，需要单篇原文地址',
  unexpected_fields: '条目包含不允许的字段',
  invalid_title: '标题为空、过长或含控制字符',
  invalid_date_format: '发布日期须为 YYYY-MM-DD 格式',
  invalid_date: '发布日期不是有效日期',
  date_out_of_window: '发布日期不在采集时间范围内',
};
const boundedCount = (value: unknown, limit: number): number | null => {
  const result = count(value);
  return result !== null && result <= limit ? result : null;
};

/** Only bounded indices and known reason enums are presented, never rejected content. */
export function discoveryValidationItems(value: unknown): {
  summary: string[];
  rejections: string[];
} {
  const row = record(value);
  if (row.version !== 1) return { summary: [], rejections: [] };
  const returnedCount = boundedCount(row.returnedCount, 8);
  const validCitationCount = boundedCount(row.validCitationCount, 1000);
  if (returnedCount === null) return { summary: [], rejections: [] };
  const seen = new Set<number>();
  const reasonCounts = new Map<DiscoveryRejectionReason, number>();
  const rejections: string[] = [];
  for (const entry of (Array.isArray(row.rejections) ? row.rejections : []).slice(0, 8)) {
    const item = record(entry);
    const index = boundedCount(item.index, 7);
    if (index === null || index >= returnedCount || seen.has(index)) continue;
    const reasons = [
      ...new Set(
        (Array.isArray(item.reasons) ? item.reasons : [])
          .slice(0, discoveryRejectionReasons.length)
          .filter(
            (reason): reason is DiscoveryRejectionReason =>
              typeof reason === 'string' && Object.hasOwn(rejectionLabels, reason),
          ),
      ),
    ];
    if (!reasons.length) continue;
    seen.add(index);
    for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    rejections.push(
      `第 ${index + 1} 条：${reasons.map((reason) => rejectionLabels[reason]).join('；')}`,
    );
  }
  // Derive totals from accepted diagnostic rows instead of trusting stored arbitrary keys/counts.
  return {
    summary: [
      `返回条目：${returnedCount} 条 · 有效引用网址：${validCitationCount ?? '未记录'}${validCitationCount === null ? '' : ' 个'}`,
      ...discoveryRejectionReasons
        .filter((reason) => reasonCounts.has(reason))
        .map((reason) => `${rejectionLabels[reason]}：${reasonCounts.get(reason)} 条`),
    ],
    rejections,
  };
}
