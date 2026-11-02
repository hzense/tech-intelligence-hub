import { timingSafeEqual } from 'node:crypto';
import { NeonUsageError, type NeonUsageDashboard } from './neon-usage-core.ts';
import { importResponse } from './import-io.ts';

type Dependencies<Session> = {
  authenticate(): Promise<Session | null>;
  origin(): string | null;
  dashboard(session: Session): Promise<NeonUsageDashboard>;
  sample(): Promise<'sampled' | 'recent'>;
};
const status = (error: unknown) =>
  error instanceof NeonUsageError && error.code === 'provider_rate_limited' ? 429 : 503;
const errorCode = (error: unknown) =>
  error instanceof NeonUsageError ? error.code : 'storage_unavailable';

export function createNeonUsageAdminHandler<Session>(deps: Dependencies<Session>) {
  return async (request: Request) => {
    if (!['GET', 'POST'].includes(request.method))
      return importResponse({ error: 'method_not_allowed' }, 405);
    const session = await deps.authenticate();
    if (!session) return importResponse({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
    if (
      request.method === 'POST' &&
      (!deps.origin() ||
        request.headers.get('origin') !== deps.origin() ||
        request.headers.get('sec-fetch-site') === 'cross-site')
    )
      return importResponse({ error: 'forbidden' }, 403);
    try {
      if (request.method === 'POST') await deps.sample();
      return importResponse(await deps.dashboard(session));
    } catch (error) {
      return importResponse({ error: errorCode(error) }, status(error));
    }
  };
}

/** Separate scope from automation/AI cron secrets. Never accepts an arbitrary target or API key. */
export function createNeonUsageScheduledHandler(deps: {
  secret(): string | undefined;
  sample(): Promise<'sampled' | 'recent'>;
}) {
  return async (request: Request) => {
    if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
    const secret = deps.secret();
    const actual = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret ?? ''}`;
    if (
      !secret ||
      secret.length < 32 ||
      secret.length > 512 ||
      /[^\x21-\x7e]/.test(secret) ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return importResponse({ error: 'unauthorized' }, 401);
    if (new URL(request.url).search) return importResponse({ error: 'invalid_request' }, 400);
    try {
      return importResponse({ status: await deps.sample() });
    } catch (error) {
      return importResponse({ error: errorCode(error) }, status(error));
    }
  };
}
