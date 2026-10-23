import { readImportFetchDiagnostic } from '../../../packages/ingestion/src/import-fetch-diagnostic.mjs';
import type { ImportFetchDiagnostic } from '../../../packages/ingestion/src/import-fetch-diagnostic.mjs';
import { importFetchFailureMessage } from './import-recovery.ts';

/** Private, bounded receipts for confirmed import failures and candidate refusals. */
export const automationSourceFailureLimit = 8;
const failureLabels = {
  duplicate_source: '来源已有候选任务',
  source_unavailable: '原文不可用于生成',
  cancelled: '任务已取消',
  profile_not_ready: '模型配置未就绪',
  revision_conflict: '配置版本已改变',
  capability_failed: '模型能力不满足要求',
  invalid_configuration: '生成配置无效',
  invalid_snapshot: '生成快照无效',
  invalid_request: '候选任务参数无效',
  budget_exceeded: '生成预算不足',
  task_deleted: '候选任务已删除',
  request_id_conflict: '候选任务编号冲突',
  not_configured: '生成服务未配置',
  database_unavailable: '生成数据库不可用',
} as const;
export type AutomationSourceFailureCode = keyof typeof failureLabels;
const importFailureLabels = {
  fetch_failed: '原文抓取失败',
  parse_failed: '原文解析失败',
  unsupported_content: '原文格式不支持',
  limit_exceeded: '原文超过处理上限',
  ocr_required: '原文需要 OCR',
  source_unavailable: '原文已不可用',
  cancelled: '导入已取消',
  import_failed: '导入失败，具体原因未记录',
} as const;
interface CandidateSourceFailure {
  itemId: string;
  phase: 'create_candidate';
  code: AutomationSourceFailureCode;
}
interface ImportSourceFailure {
  itemId: string;
  phase: 'import_source';
  code: keyof typeof importFailureLabels;
  fetchDiagnostic?: ImportFetchDiagnostic;
}
export type AutomationSourceFailure = CandidateSourceFailure | ImportSourceFailure;
export function automationSourceFailureCode(value: unknown): AutomationSourceFailureCode | null {
  return typeof value === 'string' && Object.hasOwn(failureLabels, value)
    ? (value as AutomationSourceFailureCode)
    : null;
}
const itemIdIsValid = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === 36 &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

/** Never expose arbitrary stored keys, error text or unrecognized outcomes. */
export function readAutomationSourceFailures(value: unknown): AutomationSourceFailure[] {
  if (!Array.isArray(value)) return [];
  const result: AutomationSourceFailure[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, automationSourceFailureLimit)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (!itemIdIsValid(entry.itemId)) continue;
    let receipt: AutomationSourceFailure;
    if (entry.phase === 'create_candidate') {
      const code = automationSourceFailureCode(entry.code);
      if (!code) continue;
      receipt = { itemId: entry.itemId, phase: 'create_candidate', code };
    } else if (
      entry.phase === 'import_source' &&
      typeof entry.code === 'string' &&
      Object.hasOwn(importFailureLabels, entry.code)
    ) {
      const code = entry.code as ImportSourceFailure['code'];
      const diagnostic =
        code === 'fetch_failed' ? readImportFetchDiagnostic(entry.fetchDiagnostic) : undefined;
      receipt = {
        itemId: entry.itemId,
        phase: 'import_source',
        code,
        ...(diagnostic ? { fetchDiagnostic: diagnostic } : {}),
      };
    } else continue;
    if (seen.has(entry.itemId)) continue;
    seen.add(entry.itemId);
    result.push(receipt);
  }
  return result;
}
export function appendAutomationSourceFailure(
  value: unknown,
  itemId: string,
  code: AutomationSourceFailureCode,
): AutomationSourceFailure[] {
  const current = readAutomationSourceFailures(value);
  if (!itemIdIsValid(itemId) || !automationSourceFailureCode(code)) return current;
  return [
    ...current.filter((entry) => entry.itemId !== itemId),
    {
      itemId,
      phase: 'create_candidate' as const,
      code,
    },
  ].slice(-automationSourceFailureLimit);
}
/** Only terminal, confirmed import outcomes may become failure receipts. */
export function appendAutomationImportFailure(
  value: unknown,
  itemId: string,
  outcome: { status: string; error_code?: unknown; fetch_diagnostic?: unknown },
): AutomationSourceFailure[] {
  const current = readAutomationSourceFailures(value);
  if (!itemIdIsValid(itemId) || !['failed', 'cancelled'].includes(outcome.status)) return current;
  const code: ImportSourceFailure['code'] =
    outcome.status === 'cancelled'
      ? 'cancelled'
      : typeof outcome.error_code === 'string' &&
          Object.hasOwn(importFailureLabels, outcome.error_code)
        ? (outcome.error_code as ImportSourceFailure['code'])
        : 'import_failed';
  return readAutomationSourceFailures(
    [
      ...current.filter((entry) => entry.itemId !== itemId),
      { itemId, phase: 'import_source', code, fetchDiagnostic: outcome.fetch_diagnostic },
    ].slice(-automationSourceFailureLimit),
  );
}
export function automationSourceFailureItems(value: unknown): string[] {
  return readAutomationSourceFailures(value).map((failure) => {
    if (failure.phase === 'create_candidate')
      return `资料 ${failure.itemId} · 创建候选任务：${failureLabels[failure.code]}（${failure.code}）`;
    return `资料 ${failure.itemId} · 导入原文：${
      failure.code === 'fetch_failed'
        ? importFetchFailureMessage(failure.fetchDiagnostic)
        : importFailureLabels[failure.code]
    }（${failure.code}）`;
  });
}
