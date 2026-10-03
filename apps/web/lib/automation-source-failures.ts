/** Private, bounded receipts for confirmed candidate-creation refusals only. */
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
export interface AutomationSourceFailure {
  itemId: string;
  phase: 'create_candidate';
  code: AutomationSourceFailureCode;
}
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
    const code = automationSourceFailureCode(entry.code);
    if (!itemIdIsValid(entry.itemId) || entry.phase !== 'create_candidate' || !code) continue;
    if (seen.has(entry.itemId)) continue;
    seen.add(entry.itemId);
    result.push({ itemId: entry.itemId, phase: 'create_candidate', code });
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
export function automationSourceFailureItems(value: unknown): string[] {
  return readAutomationSourceFailures(value).map(
    ({ itemId, code }) => `资料 ${itemId} · 创建候选任务：${failureLabels[code]}（${code}）`,
  );
}
