import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getAdminSession, getAdminOrigin } from '@/lib/server/admin-auth';
import { importConfig, uploadItem, uploadLocalImport } from '@/lib/server/import-service';
import {
  assertLocalDevelopmentRequest,
  isLocalDevelopment,
  localRequestMatchesOrigin,
} from '@/lib/local-development';
import { importResponse, readImportJSON } from '@/lib/import-io';
import { importError } from '@/lib/admin-import-core';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return importResponse({ error: 'unauthorized' }, 401);
    const origin = getAdminOrigin();
    if (
      !origin ||
      (isLocalDevelopment()
        ? !localRequestMatchesOrigin(request, origin)
        : new URL(request.url).origin !== origin) ||
      request.headers.get('origin') !== origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return importResponse({ error: 'forbidden' }, 403);
    const config = importConfig();
    if (config.mode === 'local') {
      assertLocalDevelopmentRequest(request);
      const query = new URL(request.url).searchParams;
      if (
        query.size !== 2 ||
        query.getAll('batchId').length !== 1 ||
        query.getAll('itemId').length !== 1
      )
        return importResponse({ error: 'invalid_request' }, 400);
      return importResponse(
        await uploadLocalImport(
          session.user.id,
          query.get('batchId')!,
          query.get('itemId')!,
          request,
        ),
      );
    }
    const body = (await readImportJSON(request, 16384)) as HandleUploadBody;
    if (body?.type !== 'blob.generate-client-token')
      return importResponse({ error: 'invalid_request' }, 400);
    const result = await handleUpload({
      request,
      body,
      token: config.token,
      onUploadCompleted: async () => {
        throw new Error('wrong_callback_route');
      },
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const value = JSON.parse(clientPayload ?? 'null');
        const item = await uploadItem(session.user.id, value.batchId, value.itemId);
        if (pathname !== `imports/${value.batchId}/${item.id}`) throw new Error('invalid_path');
        return {
          maximumSizeInBytes: item.declaration.size!,
          allowedContentTypes: ['application/octet-stream'],
          validUntil: Date.now() + 5 * 60000,
          addRandomSuffix: false,
          allowOverwrite: false,
          callbackUrl: `${origin}/api/imports/blob`,
          tokenPayload: JSON.stringify({
            owner: session.user.id,
            batchId: value.batchId,
            itemId: item.id,
          }),
        };
      },
    });
    return importResponse(result);
  } catch (error) {
    return importError(error);
  }
}
