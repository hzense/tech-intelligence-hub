// Presentation only: never reconcile tasks, release budgets, or invoke the model here.
export type GenerationSummary = {
  id: string;
  status: string;
  progress_phase: string | null;
  candidate_count: number | null;
};
export type AutomationGenerationProgress = {
  tasks: GenerationSummary[];
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  unknown: number;
  unavailable: number;
  pending: number;
  running: number;
  knownCandidates: number;
  candidateCountComplete: boolean;
  active: boolean;
  readFailed: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function automationGenerationIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const ids = (result as { generationIds?: unknown }).generationIds;
  if (!Array.isArray(ids)) return [];
  return [
    ...new Set(ids.filter((id): id is string => typeof id === 'string' && uuid.test(id))),
  ].slice(0, 8);
}
export function summarizeAutomationGenerations(
  result: unknown,
  rows: readonly GenerationSummary[] | null,
): AutomationGenerationProgress {
  const byId = new Map((rows ?? []).map((row) => [row.id, row]));
  const tasks = automationGenerationIds(result).map((id): GenerationSummary => {
    const row = byId.get(id);
    if (!row) return { id, status: 'unavailable', progress_phase: null, candidate_count: null };
    return {
      id,
      status: row.status,
      progress_phase: row.progress_phase,
      candidate_count:
        row.status === 'completed' &&
        Number.isSafeInteger(row.candidate_count) &&
        row.candidate_count! >= 0
          ? row.candidate_count
          : null,
    };
  });
  const count = (status: string) => tasks.filter((task) => task.status === status).length;
  return {
    tasks,
    total: tasks.length,
    completed: count('completed'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    unknown: tasks.filter(
      (task) =>
        !['completed', 'failed', 'cancelled', 'pending', 'running', 'unavailable'].includes(
          task.status,
        ),
    ).length,
    unavailable: count('unavailable'),
    pending: count('pending'),
    running: count('running'),
    knownCandidates: tasks.reduce((sum, task) => sum + (task.candidate_count ?? 0), 0),
    candidateCountComplete:
      tasks.length > 0 &&
      tasks.every((task) => task.status === 'completed' && task.candidate_count !== null),
    readFailed: tasks.length > 0 && rows === null,
    active: tasks.some(
      (task) =>
        task.status === 'running' ||
        (task.status === 'pending' && task.progress_phase === 'queued'),
    ),
  };
}

export function generationSummaryLabel(task: GenerationSummary): string {
  if (task.status === 'completed')
    return task.candidate_count === null
      ? '生成完成，候选数量待核对'
      : `已生成 ${task.candidate_count} 条私有候选`;
  if (task.status === 'failed') return '生成失败，需核对原任务';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'unavailable') return '记录不可读取或已隐藏，请核对原任务';
  if (task.status === 'pending')
    return task.progress_phase === 'queued' ? '排队中' : '待排队，请核对原任务';
  if (task.status === 'running') {
    const phases: Record<string, string> = {
      preparing: '准备资料',
      generating: 'AI 生成中',
      validating: '校验结果',
      saving: '保存候选',
    };
    return phases[task.progress_phase ?? ''] ?? '生成中';
  }
  return '结果未知，需人工核对';
}

export function sourceAutomationLabel(run: {
  status: string;
  phase: string;
  generationProgress?: AutomationGenerationProgress;
}): string {
  if (run.status === 'queued') return '等待采集';
  if (run.status === 'running') {
    const phases: Record<string, string> = {
      queued: '准备采集',
      preparing: '准备采集',
      discovering: '联网发现',
      sources_discovered: '发现完成',
      importing_sources: '导入原文',
      creating_candidates: '登记候选任务',
      dispatching_candidates: '派发候选任务',
    };
    return phases[run.phase] ?? '采集中';
  }
  if (run.status === 'unknown') return '采集结果未知，请核对原任务';
  if (run.status === 'failed') return '采集失败';
  if (run.status === 'cancelled') return '已取消';
  if (run.phase === 'no_new_sources') return '采集完成，无新来源';
  const progress = run.generationProgress;
  if (!progress?.total) return '采集结束，未确认生成候选';
  if (progress.active) return '候选生成中';
  if (progress.unknown || progress.unavailable || progress.pending) return '生成结果待核对';
  if (progress.failed || progress.cancelled)
    return progress.completed ? '部分生成完成' : '生成未完成';
  if (!progress.candidateCountComplete) return '候选数量待核对';
  return progress.knownCandidates > 0 ? '私有候选已生成' : '生成完成（无合格候选）';
}
