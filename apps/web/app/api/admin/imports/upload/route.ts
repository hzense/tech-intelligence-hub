import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getAdminSession } from '@/lib/server/admin-auth';
import { parseAdminAuthEnvironment } from '@/lib/admin-auth-policy';
import { importConfig, uploadItem } from '@/lib/server/import-service';
import { importResponse, readImportJSON } from '@/lib/import-io';
import { importError } from '@/lib/admin-import-core';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return importResponse({ error: 'unauthorized' }, 401);
    const origin = parseAdminAuthEnvironment(process.env)?.origin;
    if (
      !origin ||
      new URL(request.url).origin !== origin ||
      request.headers.get('origin') !== origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return importResponse({ error: 'forbidden' }, 403);
    const body = (await readImportJSON(request, 16384)) as HandleUploadBody;
    if (body?.type !== 'blob.generate-client-token')
      return importResponse({ error: 'invalid_request' }, 400);
    const config = importConfig();
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
