/** Structural receipts only: never retain prompts, answers, citations or provider messages. */
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
  return [
    `搜索回执：${status}${requests === null ? '' : `（${requests} 次，上限 ${discoverySearchLimit} 次）`}`,
    `结束原因：${reason}`,
    `响应选项：${count(row.choiceCount) ?? '未返回'} · 引用条目：${count(row.annotationCount) ?? '未返回'}`,
    ...(row.providerError === true ? [`供应商错误：${code ?? '未提供标准错误码'}`] : []),
    ...(id ? [`供应商响应 ID：${id}`] : []),
  ];
}
