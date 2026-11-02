import { get, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import {
  NeonUsageError,
  neonUsageByteLimit,
  neonUsageProjectId,
  parseNeonUsageHistory,
} from './neon-usage-core.ts';
import type { NeonUsageStore } from './neon-usage-service.ts';
import { readImportBytes } from './import-io.ts';

export function createNeonUsageBlobStore(projectId: string, token: string): NeonUsageStore {
  if (!neonUsageProjectId(projectId)) throw new NeonUsageError('not_configured');
  const path = `neon-usage/${projectId}/history-v1.json`;
  const store: NeonUsageStore = {
    async read() {
      try {
        const result = await get(path, {
          token,
          access: 'private',
          useCache: false,
          headers: { 'Accept-Encoding': 'identity' },
          abortSignal: AbortSignal.timeout(5_000),
        });
        if (!result) return null;
        if (result.statusCode !== 200 || !result.blob.etag)
          throw new NeonUsageError('storage_unavailable');
        const bytes = await readImportBytes(result.stream, neonUsageByteLimit, 5_000);
        return {
          history: parseNeonUsageHistory(JSON.parse(bytes.toString('utf8')), projectId),
          version: result.blob.etag,
        };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw new NeonUsageError('storage_unavailable');
      }
    },
    async compareAndSwap(history, version) {
      const body = JSON.stringify(history);
      if (Buffer.byteLength(body) > neonUsageByteLimit)
        throw new NeonUsageError('storage_unavailable');
      try {
        await put(path, body, {
          token,
          access: 'private',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: version !== null,
          ...(version ? { ifMatch: version } : {}),
          abortSignal: AbortSignal.timeout(5_000),
        });
        return true;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return false;
        // A simultaneous first writer can create the object after our missing read.
        // Read a real validated object rather than interpreting provider error prose.
        if (version === null && (await store.read())) return false;
        throw new NeonUsageError('storage_unavailable');
      }
    },
  };
  return store;
}
