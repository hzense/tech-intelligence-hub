import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { importConfig, confirmImportUpload } from '@/lib/server/import-service';
import { importResponse, readImportJSON } from '@/lib/import-io';
import { importError } from '@/lib/admin-import-core';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = (await readImportJSON(request, 16384)) as HandleUploadBody;
    if (body?.type !== 'blob.upload-completed') return importResponse({ error: 'forbidden' }, 403);
    const result = await handleUpload({
      request,
      body,
      token: importConfig().token,
      onBeforeGenerateToken: async () => {
        throw new Error('forbidden');
      },
      // Called by SDK only after its signed callback verification. Never fetch blob.url.
      onUploadCompleted: async ({ tokenPayload, blob }) => {
        const value = JSON.parse(tokenPayload ?? 'null');
        if (blob.pathname !== `imports/${value.batchId}/${value.itemId}`)
          throw new Error('invalid_path');
        await confirmImportUpload(value.owner, value.batchId, value.itemId);
      },
    });
    return importResponse(result);
  } catch (error) {
    return importError(error);
  }
}
