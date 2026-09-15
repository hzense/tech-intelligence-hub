export class ImportIOError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
/** Limits apply to actual bytes, including absent or dishonest Content-Length. */
export async function readImportBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  timeout = 15000,
): Promise<Buffer> {
  if (!stream) throw new ImportIOError('invalid_request');
  const reader = stream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new ImportIOError('limit_exceeded'));
    }, timeout);
  });
  try {
    return await Promise.race([
      expired,
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new ImportIOError('limit_exceeded');
          chunks.push(value);
        }
        return Buffer.concat(chunks);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function readImportJSON(request: Request, limit = 262144): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new ImportIOError('invalid_request');
  try {
    return JSON.parse((await readImportBytes(request.body, limit, 10000)).toString('utf8'));
  } catch (error) {
    if (error instanceof ImportIOError) throw error;
    throw new ImportIOError('invalid_request');
  }
}
export const importHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
export function importResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: importHeaders });
}
