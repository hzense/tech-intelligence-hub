import { isGenerationRecordId } from './signal-generation-id.ts';

export type GenerationProgressReceipt = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  error_code?: string | null;
  progress_phase?: string | null;
  progress_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  reserved_microusd?: number | string;
  charged_microusd?: number | string;
};

/** A partial, owner-scoped status receipt must never replace a full task record. */
export async function fetchGenerationProgress(ids: string[], signal: AbortSignal) {
  if (!ids.length || ids.length > 50 || ids.some((id) => !isGenerationRecordId(id)))
    throw new Error('invalid_progress_request');
  const requested = new Set(ids);
  const response = await fetch(
    `/api/admin/signal-generation?progress=${encodeURIComponent([...requested].join(','))}`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error('progress_unavailable');
  const payload = await response.json();
  if (!Array.isArray(payload?.runs) || payload.runs.length !== requested.size)
    throw new Error('progress_identity_mismatch');
  const seen = new Set<string>();
  return payload.runs.map((row: Record<string, unknown>): GenerationProgressReceipt => {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.id !== 'string' ||
      !requested.has(row.id) ||
      seen.has(row.id) ||
      typeof row.status !== 'string' ||
      !['pending', 'running', 'completed', 'failed', 'unknown', 'cancelled'].includes(row.status)
    )
      throw new Error('progress_identity_mismatch');
    seen.add(row.id);
    const receipt: GenerationProgressReceipt = {
      id: row.id,
      status: row.status as GenerationProgressReceipt['status'],
    };
    for (const key of [
      'error_code',
      'progress_phase',
      'progress_at',
      'started_at',
      'finished_at',
    ] as const) {
      if (row[key] === null || typeof row[key] === 'string') receipt[key] = row[key];
      else if (row[key] !== undefined) throw new Error('invalid_progress_receipt');
    }
    if (typeof row.created_at === 'string') receipt.created_at = row.created_at;
    for (const key of ['reserved_microusd', 'charged_microusd'] as const) {
      if (typeof row[key] === 'string' || typeof row[key] === 'number') receipt[key] = row[key];
      else if (row[key] !== undefined) throw new Error('invalid_progress_receipt');
    }
    return receipt;
  });
}
