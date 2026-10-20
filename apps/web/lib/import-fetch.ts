import { Resolver } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isPublicAiAddress } from './ai-provider-transport.ts';
import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';
import { ImportIOError, importFetchDiagnostic, type ImportFetchDiagnostic } from './import-io.ts';

export async function resolveImportHost(
  host: string,
  resolver = new Resolver({ timeout: 2000, tries: 1 }),
) {
  const resolve = async (family: 4 | 6) => {
    try {
      return (await (family === 4 ? resolver.resolve4(host) : resolver.resolve6(host))).map(
        (address) => ({ address, family }),
      );
    } catch (error) {
      if (['ENODATA', 'ENOTFOUND'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
      throw new ImportIOError('fetch_failed', { reason: 'dns' });
    }
  };
  const addresses = (await Promise.all([resolve(4), resolve(6)])).flat();
  if (!addresses.length) throw new ImportIOError('fetch_failed', { reason: 'dns' });
  if (addresses.some((x) => !isPublicAiAddress(x.address))) throw new ImportIOError('fetch_failed');
  return addresses[0]!;
}
export function assertImportFetchURL(input: string) {
  const v = validateImportManifest(
    { urlLines: input },
    { capabilities: { urlFetch: true, parsers: ['html', 'text', 'pdf'] } },
  );
  if (!v.valid || v.urls.length !== 1) throw new ImportIOError('fetch_failed');
  return new URL(v.urls[0]!.canonicalUrl!);
}
export function fetchImportHop(
  url: URL,
  address: { address: string; family: number },
  request = httpsRequest,
) {
  return new Promise<{ bytes: Buffer; type: string; location?: string }>((resolve, reject) => {
    let req: ReturnType<typeof httpsRequest> | undefined;
    const timer = setTimeout(() => {
      const error = new ImportIOError('fetch_failed', { reason: 'timeout' });
      reject(error);
      req?.destroy(error);
    }, 15000);
    const networkError = (error: unknown) => {
      clearTimeout(timer);
      reject(
        error instanceof ImportIOError
          ? error
          : new ImportIOError('fetch_failed', { reason: 'network' }),
      );
    };
    try {
      req = request(
        url,
        {
          agent: false,
          rejectUnauthorized: true,
          servername: url.hostname,
          lookup: (_host, options, cb) => {
            if (options.all) cb(null, [address]);
            else cb(null, address.address, address.family);
          },
          headers: {
            'User-Agent': 'HZense-Import/1.0',
            Accept: 'text/html,text/plain,application/pdf',
            'Accept-Encoding': 'identity',
          },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
            clearTimeout(timer);
            res.destroy();
            if (!res.headers.location) reject(new ImportIOError('fetch_failed'));
            else resolve({ bytes: Buffer.alloc(0), type: '', location: res.headers.location });
            return;
          }
          if (res.statusCode !== 200) {
            clearTimeout(timer);
            res.destroy();
            reject(
              new ImportIOError(
                'fetch_failed',
                res.statusCode
                  ? { reason: 'http_status', status: res.statusCode }
                  : { reason: 'network' },
              ),
            );
            return;
          }
          if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
            clearTimeout(timer);
            res.destroy();
            reject(new ImportIOError('fetch_failed', { reason: 'encoding' }));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 25 * 1024 * 1024) {
              const error = new ImportIOError('limit_exceeded');
              clearTimeout(timer);
              // Settle first: destroy may emit a response error before the request error.
              reject(error);
              req?.destroy(error);
            } else chunks.push(chunk);
          });
          res.on('end', () => {
            clearTimeout(timer);
            resolve({
              bytes: Buffer.concat(chunks),
              type: ((res.headers['content-type'] ?? '').split(';')[0] ?? '').trim().toLowerCase(),
            });
          });
          res.on('error', networkError);
        },
      );
      req.on('error', networkError);
      req.end();
    } catch (error) {
      networkError(error);
    }
  });
}
export async function fetchImportURL(
  input: string,
  dependencies = { resolve: resolveImportHost, hop: fetchImportHop },
  options: {
    allowRedirects?: boolean;
    onDiagnostic?: (diagnostic: ImportFetchDiagnostic) => void;
  } = {},
) {
  try {
    let url = assertImportFetchURL(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = await dependencies.resolve(url.hostname);
      if (!isPublicAiAddress(address.address)) throw new ImportIOError('fetch_failed');
      const result = await dependencies.hop(url, address);
      if (result.location) {
        // Independent source verification must not attribute another origin's
        // response to the originally reviewed URL. Ordinary imports keep redirects.
        if (options.allowRedirects === false) throw new ImportIOError('fetch_failed');
        url = assertImportFetchURL(new URL(result.location, url).href);
        continue;
      }
      const format = (
        {
          'text/html': 'html',
          'text/plain': 'text',
          'text/markdown': 'markdown',
          'text/csv': 'csv',
          'application/pdf': 'pdf',
        } as Record<string, string>
      )[result.type];
      if (!format || !result.bytes.length) throw new ImportIOError('unsupported_content');
      return { bytes: result.bytes, format };
    }
    throw new ImportIOError('fetch_failed');
  } catch (error) {
    const diagnostic = importFetchDiagnostic(error);
    if (diagnostic) {
      // Diagnostic logging is best-effort; it must never alter the failure or accounting.
      try {
        options.onDiagnostic?.(diagnostic);
      } catch {
        // A failed log sink must not replace the original import error.
      }
    }
    throw error;
  }
}
