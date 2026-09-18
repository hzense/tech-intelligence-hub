import { safeImportConflictReason } from './import-conflict.ts';
export class ImportClientError extends Error {
  readonly code: string;
  constructor(code: string, reason?: unknown) {
    const safeReason = code === 'document_conflict' ? safeImportConflictReason(reason) : undefined;
    super(safeReason ? `${code}（${safeReason}）` : code);
    this.code = code;
  }
}
export function canUploadAfterConfirmError(error: unknown) {
  return error instanceof ImportClientError && error.code === 'source_unavailable';
}
export function importFailureHint(error: unknown) {
  if (error instanceof ImportClientError && error.code === 'source_expired')
    return '临时原件已过期，不能在原批次重传。请重新选择文件创建新批次。';
  return error instanceof ImportClientError && error.code === 'document_conflict'
    ? '原件校验冲突，已停止重传。请保留批次并联系管理员核查；不要重复创建批次。'
    : '请先核对任务状态；不要重复创建批次。';
}
