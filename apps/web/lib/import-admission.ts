import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';

export type ImportAdmissionCode =
  'worker_busy' | 'budget_exceeded' | 'configuration_conflict' | 'cancelled';

/** A deterministic refusal from the durable claim, before any external work. */
export class ImportAdmissionError extends ImportTaskError {
  declare code: ImportAdmissionCode;

  constructor(code: ImportAdmissionCode, reason?: string) {
    super(code, reason);
    this.name = 'ImportAdmissionError';
  }
}

export function importAdmissionCode(error: unknown): ImportAdmissionCode | null {
  if (!(error instanceof ImportAdmissionError)) return null;
  return ['worker_busy', 'budget_exceeded', 'configuration_conflict', 'cancelled'].includes(
    error.code,
  )
    ? error.code
    : null;
}
