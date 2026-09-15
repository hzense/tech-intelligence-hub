import { Resolver } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isPublicAiAddress } from './ai-provider-transport.ts';
import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';
import { ImportIOError } from './import-io.ts';

export async function resolveImportHost(host: string) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const resolve = async (family: 4 | 6) => {
    try {
      return (await (family === 4 ? resolver.resolve4(host) : resolver.resolve6(host))).map(
        (address) => ({ address, family }),
      );
    } catch (error) {
      if (['ENODATA', 'ENOTFOUND'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
      throw new ImportIOError('fetch_failed');
    }
  };
  const addresses = (await Promise.all([resolve(4), resolve(6)])).flat();
  if (!addresses.length || addresses.some((x) => !isPublicAiAddress(x.address)))
    throw new ImportIOError('fetch_failed');
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
function fetchHop(url: URL, address: { address: string; family: number }) {
  return new Promise<{ bytes: Buffer; type: string; location?: string }>((resolve, reject) => {
    const timer = setTimeout(() => req.destroy(new ImportIOError('fetch_failed')), 15000);
    const req = httpsRequest(
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
        if (
          res.statusCode !== 200 ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
        ) {
          clearTimeout(timer);
          res.destroy();
          reject(new ImportIOError('fetch_failed'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 25 * 1024 * 1024) req.destroy(new ImportIOError('limit_exceeded'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({
            bytes: Buffer.concat(chunks),
            type: ((res.headers['content-type'] ?? '').split(';')[0] ?? '').trim().toLowerCase(),
          });
        });
        res.on('error', () => {
          clearTimeout(timer);
          reject(new ImportIOError('fetch_failed'));
        });
      },
    );
    req.on('error', () => {
      clearTimeout(timer);
      reject(new ImportIOError('fetch_failed'));
    });
    req.end();
  });
}
export async function fetchImportURL(
  input: string,
  dependencies = { resolve: resolveImportHost, hop: fetchHop },
) {
  let url = assertImportFetchURL(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const address = await dependencies.resolve(url.hostname);
    if (!isPublicAiAddress(address.address)) throw new ImportIOError('fetch_failed');
    const result = await dependencies.hop(url, address);
    if (result.location) {
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
}
