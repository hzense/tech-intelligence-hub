import { timingSafeEqual } from 'node:crypto';
import { importPool, importQueue, runImportItem } from '@/lib/server/import-service';
import { expireImportAttempt } from '../../../../../../packages/database/src/import-store.mjs';
import { importResponse } from '@/lib/import-io';
import { importError } from '@/lib/admin-import-core';
import { ImportTaskError } from '../../../../../../packages/ingestion/src/import-task-contract.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;
export async function POST(request: Request) {
  const secret = process.env.HZENSE_IMPORT_WORKER_TOKEN;
  const token = request.headers.get('authorization') ?? '';
  const actual = Buffer.from(token),
    expected = Buffer.from(`Bearer ${secret ?? ''}`);
  if (
    !secret ||
    secret.length < 32 ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return importResponse({ error: 'unauthorized' }, 401);
  try {
    const queue = await importQueue();
    for (const item of queue) {
      if (item.status === 'running') {
        await expireImportAttempt({ pool: importPool, ...item });
        continue;
      }
      try {
        return importResponse(await runImportItem(item.owner, item.batchId, item.itemId));
      } catch (error) {
        if (
          !(error instanceof ImportTaskError) ||
          !['configuration_conflict', 'not_claimable', 'budget_exceeded'].includes(error.code)
        )
          throw error;
      }
    }
    return importResponse({ status: queue.length ? 'blocked_or_expired' : 'idle' });
  } catch (error) {
    return importError(error);
  }
}
