import { Resolver } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Buffer } from 'node:buffer';
import { readApiCostMicrousd } from './ai-response-cost.ts';
import {
  parseAiProbeDiagnostics,
  aiProbeRejectedStatuses,
  type AiProbeDiagnosticReason,
} from '../../../packages/database/src/ai-probe-diagnostics.mjs';

export const aiProbeErrorCodes = [
  'invalid_configuration',
  'invalid_model',
  'blocked_target',
  'dns_failed',
  'timeout',
  'network_error',
  'response_too_large',
  'redirect_blocked',
  'provider_rejected',
  'invalid_response',
  'capability_failed',
] as const;
export type AiProbeErrorCode = (typeof aiProbeErrorCodes)[number];
export class AiProbeError extends Error {
  readonly code: AiProbeErrorCode;
  readonly httpStatus: number | undefined;
  declare readonly reason?: AiProbeDiagnosticReason;
  declare readonly providerCostMicrousd?: number | null;
  declare readonly rejectionConfirmed?: boolean;
  declare readonly inputTokens?: number | null;
  declare readonly outputTokens?: number | null;
  constructor(code: AiProbeErrorCode, httpStatus?: number, details?: AiRejectionDetails) {
    super(code);
    this.name = 'AiProbeError';
    this.code = code;
    // Preserve only the protocol status, never provider error text, headers or URLs.
    this.httpStatus =
      typeof httpStatus === 'number' &&
      Number.isInteger(httpStatus) &&
      httpStatus >= 100 &&
      httpStatus <= 599
        ? httpStatus
        : undefined;
    const reason = parseAiProbeDiagnostics({
      version: 1,
      stage: 'model_request',
      reason: details?.reason,
    })?.reason;
    if (reason) this.reason = reason;
    for (const key of ['providerCostMicrousd', 'inputTokens', 'outputTokens'] as const) {
      const value = details?.[key];
      if (
        value === null ||
        (typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          (key === 'providerCostMicrousd' || value <= 2_147_483_647))
      )
        this[key] = value;
    }
    if (typeof details?.rejectionConfirmed === 'boolean')
      this.rejectionConfirmed = details.rejectionConfirmed;
  }
}
interface AiRejectionDetails {
  reason?: AiProbeDiagnosticReason;
  providerCostMicrousd?: number | null;
  rejectionConfirmed?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
}
const fail = (code: AiProbeErrorCode, httpStatus?: number): never => {
  throw new AiProbeError(code, httpStatus);
};
export const aiResponseMaximumBytes = 1_048_576;
export const aiRejectionMaximumBytes = 16_384;

function rejectionReason(status: number, body?: Record<string, unknown>): AiProbeDiagnosticReason {
  const error = body?.error;
  const message =
    error && typeof error === 'object' && !Array.isArray(error)
      ? (error as Record<string, unknown>).message
      : error;
  // Only classify bounded known patterns. The source text is never retained.
  if (typeof message === 'string' && [400, 404, 422].includes(status)) {
    if (/no (?:endpoints|providers) (?:found|available)|no matching provider/i.test(message))
      return 'no_matching_provider';
    if (/model[^\n]{0,160}(?:not found|does not exist|not available)/i.test(message))
      return 'model_not_found';
    if (
      /(?:unsupported|unrecognized|not supported)[^\n]{0,100}(?:parameter|tool_choice|reasoning)|(?:parameter|tool_choice|reasoning)[^\n]{0,100}(?:unsupported|not supported)/i.test(
        message,
      )
    )
      return 'unsupported_parameters';
  }
  if (status === 401) return 'authentication_failed';
  if (status === 402) return 'insufficient_credit';
  if (status === 403) return 'access_denied';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  if ([400, 405, 413, 415, 422].includes(status)) return 'invalid_request';
  return 'provider_rejected';
}

function unconfirmedRejection(status: number): AiProbeError {
  return new AiProbeError('provider_rejected', status, {
    reason: rejectionReason(status),
    rejectionConfirmed: false,
  });
}

function hasRecognizableError(body: Record<string, unknown>, status: number): boolean {
  const error = body.error;
  if (typeof error === 'string') return error.trim().length > 0;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const row = error as Record<string, unknown>;
  return (
    (typeof row.message === 'string' && row.message.trim().length > 0) ||
    row.code === status ||
    (typeof row.code === 'string' &&
      [
        'invalid_request_error',
        'invalid_api_key',
        'authentication_error',
        'permission_denied',
        'insufficient_quota',
        'insufficient_credits',
        'model_not_found',
        'rate_limit_exceeded',
        'rate_limit_error',
      ].includes(row.code))
  );
}

function hasContradictoryResult(body: Record<string, unknown>): boolean {
  // A non-2xx envelope can still contain a generated answer or an ambiguous
  // upstream result. Its presence must never be treated as proof of no work.
  return [
    'choices',
    'output',
    'outputs',
    'message',
    'messages',
    'content',
    'completion',
    'completions',
    'tool_calls',
    'function_call',
    'result',
    'results',
    'response',
    'data',
  ].some((key) => Object.hasOwn(body, key));
}

/** Probe-only summary. The complete bounded JSON is discarded after extracting
 * fixed categories and numeric usage; neither raw text nor provider metadata escapes.
 */
async function summarizeRejection(
  bytes: Uint8Array,
  status: number,
  url: URL,
): Promise<AiProbeError> {
  try {
    if (bytes.byteLength > aiRejectionMaximumBytes) return unconfirmedRejection(status);
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return unconfirmedRejection(status);
    const body = parsed as Record<string, unknown>;
    const usage = body.usage;
    const validUsage =
      usage === undefined || (usage !== null && typeof usage === 'object' && !Array.isArray(usage));
    const row = validUsage && usage ? (usage as Record<string, unknown>) : {};
    const usageKeys = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
    const tokenUsageValid = usageKeys.every(
      (key) =>
        row[key] === undefined || (Number.isSafeInteger(row[key]) && (row[key] as number) >= 0),
    );
    const knownUsageShape = Object.keys(row).every((key) => [...usageKeys, 'cost'].includes(key));
    const positiveTokens = usageKeys.some((key) => typeof row[key] === 'number' && row[key] > 0);
    const cost = await readApiCostMicrousd(Response.json(body), url.origin);
    const costValid = row.cost === undefined || cost !== null;
    const numberOrNull = (value: unknown) =>
      Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
    return new AiProbeError('provider_rejected', status, {
      reason: rejectionReason(status, body),
      providerCostMicrousd: cost,
      inputTokens: numberOrNull(row.prompt_tokens),
      outputTokens: numberOrNull(row.completion_tokens),
      rejectionConfirmed:
        aiProbeRejectedStatuses.includes(status) &&
        hasRecognizableError(body, status) &&
        !hasContradictoryResult(body) &&
        validUsage &&
        tokenUsageValid &&
        knownUsageShape &&
        costValid &&
        !positiveTokens &&
        (cost === null || cost === 0),
    });
  } catch {
    return unconfirmedRejection(status);
  }
}

function hostnameIsAllowedShape(host: string): boolean {
  return (
    host.length <= 253 &&
    host === host.toLowerCase() &&
    isIP(host) === 0 &&
    host.split('.').length >= 2 &&
    host
      .split('.')
      .every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
    !/^\d+(?:\.\d+)*$/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|arpa)$/.test(host)
  );
}

/** Reject normalization tricks before URL parsing; allow only an exact server allowlist. */
export function validateAiBaseUrl(value: string, allowedHosts: readonly string[]): URL {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    [...value].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126) ||
    /[%\\?#@]/.test(value) ||
    !value.startsWith('https://') ||
    !Array.isArray(allowedHosts) ||
    !allowedHosts.length ||
    allowedHosts.length > 50 ||
    allowedHosts.some((host) => typeof host !== 'string' || !hostnameIsAllowedShape(host))
  )
    return fail('blocked_target');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('blocked_target');
  }
  const authority = value.slice('https://'.length).split('/')[0];
  if (
    !hostnameIsAllowedShape(url.hostname) ||
    !allowedHosts.includes(url.hostname) ||
    ![url.hostname, `${url.hostname}:443`].includes(authority ?? '') ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return fail('blocked_target');
  const rawPath = value.slice('https://'.length + (authority?.length ?? 0));
  if (rawPath && (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(rawPath) || rawPath.includes('//')))
    return fail('blocked_target');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

// Conservative IANA special-purpose exclusions; exceptions inside reserved
// ranges are deliberately not accepted. IPv6 only accepts global unicast /3.
const deniedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  deniedV4.addSubnet(address, prefix, 'ipv4');
deniedV4.addAddress('168.63.129.16', 'ipv4'); // Azure platform/metadata virtual address.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  deniedV6.addSubnet(address, prefix, 'ipv6');
export function isPublicAiAddress(address: string): boolean {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  return family === 4
    ? !deniedV4.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}
export interface AiResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type AiResolver = (host: string, signal: AbortSignal) => Promise<AiResolvedAddress[]>;
const defaultResolver: AiResolver = async (host, signal) => {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) return fail('timeout');
    const records = await Promise.all(
      [resolver.resolve4(host), resolver.resolve6(host)].map(async (request, index) => {
        try {
          return (await request).map((address) => ({
            address,
            family: (index === 0 ? 4 : 6) as 4 | 6,
          }));
        } catch (error) {
          if (['ENODATA', 'ENOTFOUND'].includes((error as { code?: string }).code ?? '')) return [];
          return fail(signal.aborted ? 'timeout' : 'dns_failed');
        }
      }),
    );
    return records.flat();
  } finally {
    signal.removeEventListener('abort', cancel);
    resolver.cancel();
  }
};

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AiProbeError('timeout'));
    if (signal.aborted) {
      reject(new AiProbeError('timeout'));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export interface PinnedAiRequest {
  url: URL;
  address: AiResolvedAddress;
  method: 'GET' | 'POST';
  body: string | undefined;
  apiKey: string;
  signal: AbortSignal;
  /** Server-owned opt-in for capability probes, never supplied by the model or UI. */
  captureRejectionDiagnostics?: boolean;
}
export type AiWireRequest = (request: PinnedAiRequest) => Promise<Response>;

/** Explicit address lookup, no env proxy or shared connection pool, original TLS identity. */
export function pinnedAiRequestOptions(input: PinnedAiRequest): RequestOptions {
  const { url, address } = input;
  return {
    protocol: 'https:',
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: input.method,
    agent: false,
    servername: url.hostname,
    rejectUnauthorized: true,
    family: address.family,
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    },
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      ...(input.body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(input.body) }),
    },
  };
}

/** Injectable native request constructor keeps the streaming boundary testable. */
export function createAiWireRequest(
  makeRequest: typeof httpsRequest = httpsRequest,
): AiWireRequest {
  return (input) =>
    new Promise((resolve, reject) => {
      if (input.signal.aborted) {
        reject(new AiProbeError('timeout'));
        return;
      }
      let settled = false;
      const finish = (error: AiProbeError | null, response?: Response) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(response!);
      };
      const abort = () => {
        finish(new AiProbeError('timeout'));
        request.destroy();
      };
      const request = makeRequest(pinnedAiRequestOptions(input), (response) => {
        const status = response.statusCode ?? 0;
        const stop = (code: AiProbeErrorCode) => {
          finish(new AiProbeError(code, status));
          response.destroy();
          request.destroy();
        };
        if (status >= 300 && status < 400) return stop('redirect_blocked');
        if (status < 200 || status >= 300) {
          if (!input.captureRejectionDiagnostics) return stop('provider_rejected');
          const uncertain = () => {
            finish(unconfirmedRejection(status));
            response.destroy();
            request.destroy();
          };
          const length = response.headers['content-length'];
          if (
            !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') ||
            (response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity') ||
            (length && (!/^\d+$/.test(length) || Number(length) > aiRejectionMaximumBytes))
          )
            return uncertain();
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > aiRejectionMaximumBytes) return uncertain();
            chunks.push(chunk);
          });
          response.on('error', uncertain);
          response.on('aborted', uncertain);
          response.on('end', () => {
            if (settled) return;
            if (length && bytes !== Number(length)) return uncertain();
            void summarizeRejection(Buffer.concat(chunks), status, input.url).then((error) =>
              finish(error),
            );
          });
          return;
        }
        if (status === 204 || status === 205) return stop('invalid_response');
        if (
          !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        )
          return stop('invalid_response');
        const length = response.headers['content-length'];
        if (length && (!/^\d+$/.test(length) || Number(length) > aiResponseMaximumBytes))
          return stop('response_too_large');
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > aiResponseMaximumBytes) return stop('response_too_large');
          chunks.push(chunk);
        });
        response.on('error', () => stop('network_error'));
        response.on('aborted', () => stop('network_error'));
        response.on('end', () => {
          if (!settled)
            finish(
              null,
              new Response(Buffer.concat(chunks), {
                status,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
        });
      });
      request.on('error', () =>
        finish(new AiProbeError(input.signal.aborted ? 'timeout' : 'network_error')),
      );
      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) abort();
      else request.end(input.body);
    });
}
const defaultWireRequest = createAiWireRequest();

function redactJsonResponse(text: string, apiKey: string): string {
  // Parse before reserialization so JSON escape sequences cannot conceal an
  // echoed credential. Also handle keys embedded in serialized JSON strings.
  const variants: string[] = [apiKey];
  while (variants.length < 20) {
    const escaped = JSON.stringify(variants.at(-1)).slice(1, -1);
    if (escaped === variants.at(-1) || escaped.length > aiResponseMaximumBytes) break;
    variants.push(escaped);
  }
  const redact = (value: string) =>
    variants.reduceRight((current, secret) => current.split(secret).join('[REDACTED]'), value);
  try {
    const parsed: unknown = JSON.parse(text, (_key: string, value: unknown) => {
      if (typeof value === 'string') return redact(value);
      if (value && typeof value === 'object' && !Array.isArray(value))
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), item]));
      return value;
    });
    return JSON.stringify(parsed);
  } catch {
    return fail('invalid_response');
  }
}

/** Test injection is server-owned and never accepted from an admin/model request. */
export function createPinnedAiFetch(
  config: {
    baseUrl: string;
    allowedHosts: readonly string[];
    apiKey: string;
    signal: AbortSignal;
    requestPurpose?: 'probe' | 'signal-generation' | 'candidate-enrichment';
    captureRejectionDiagnostics?: boolean;
  },
  dependencies: { resolve?: AiResolver; request?: AiWireRequest } = {},
): typeof fetch {
  const base = validateAiBaseUrl(config.baseUrl, config.allowedHosts);
  if (
    typeof config.apiKey !== 'string' ||
    config.apiKey.length < 8 ||
    config.apiKey.length > 4096 ||
    [...config.apiKey].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)
  )
    return fail('invalid_configuration');
  const basePath = base.pathname.replace(/\/$/, '');
  const resolve = dependencies.resolve ?? defaultResolver;
  const request = dependencies.request ?? defaultWireRequest;
  // Server-owned presets: keep probes small while allowing a bounded source,
  // extraction prompt and schema after the SDK's JSON serialization.
  const requestMaximumBytes =
    config.requestPurpose === 'signal-generation'
      ? 3 * 1024 * 1024
      : config.requestPurpose === 'candidate-enrichment'
        ? 256 * 1024
        : 32_768;
  return async (input, init) => {
    if (!(typeof input === 'string' || input instanceof URL)) return fail('blocked_target');
    const raw = String(input);
    if (raw.includes('%') || raw.includes('\\')) return fail('blocked_target');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return fail('blocked_target');
    }
    const method = init?.method ?? 'GET';
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        (method === 'GET' && url.pathname === `${basePath}/models`) ||
        (method === 'POST' && url.pathname === `${basePath}/chat/completions`)
      )
    )
      return fail('blocked_target');
    if (
      (init?.body !== undefined && typeof init.body !== 'string') ||
      (typeof init?.body === 'string' && Buffer.byteLength(init.body) > requestMaximumBytes)
    )
      return fail('invalid_configuration');
    const signal = init?.signal ? AbortSignal.any([config.signal, init.signal]) : config.signal;
    let addresses: AiResolvedAddress[];
    try {
      addresses = await withAbort(resolve(base.hostname, signal), signal);
    } catch (error) {
      throw error instanceof AiProbeError ? error : new AiProbeError('dns_failed');
    }
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some(
        (item) => !isPublicAiAddress(item.address) || isIP(item.address) !== item.family,
      )
    )
      return fail('blocked_target');
    const response = await withAbort(
      request({
        url,
        address: addresses[0]!,
        method,
        body: init?.body as string | undefined,
        apiKey: config.apiKey,
        signal,
        ...(config.captureRejectionDiagnostics ? { captureRejectionDiagnostics: true } : {}),
      }),
      signal,
    );
    if (response.status >= 300 && response.status < 400)
      return fail('redirect_blocked', response.status);
    if (!response.ok) {
      if (!config.captureRejectionDiagnostics) return fail('provider_rejected', response.status);
      const length = response.headers.get('content-length');
      if (
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
        (response.headers.get('content-encoding') &&
          response.headers.get('content-encoding') !== 'identity') ||
        (length && (!/^\d+$/.test(length) || Number(length) > aiRejectionMaximumBytes)) ||
        !response.body
      ) {
        void response.body?.cancel().catch(() => {});
        throw unconfirmedRejection(response.status);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await withAbort(reader.read(), signal);
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > aiRejectionMaximumBytes) throw unconfirmedRejection(response.status);
          chunks.push(part.value);
        }
        if (length && bytes !== Number(length)) throw unconfirmedRejection(response.status);
        throw await summarizeRejection(Buffer.concat(chunks), response.status, url);
      } catch (error) {
        if (error instanceof AiProbeError) throw error;
        throw unconfirmedRejection(response.status);
      } finally {
        void reader.cancel().catch(() => {});
      }
    }
    // The wire implementation bounds streaming bytes; this repeats the bound for
    // test/custom transports and strips all provider headers before SDK parsing.
    const body = await withAbort(response.arrayBuffer(), signal);
    if (body.byteLength > aiResponseMaximumBytes) return fail('response_too_large');
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      return fail('invalid_response');
    }
    decoded = redactJsonResponse(decoded, config.apiKey);
    return new Response(decoded, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
