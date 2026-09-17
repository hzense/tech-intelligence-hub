import { Resolver } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Buffer } from 'node:buffer';

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
  constructor(code: AiProbeErrorCode) {
    super(code);
    this.name = 'AiProbeError';
    this.code = code;
  }
}
const fail = (code: AiProbeErrorCode): never => {
  throw new AiProbeError(code);
};
export const aiResponseMaximumBytes = 1_048_576;

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
          finish(new AiProbeError(code));
          response.destroy();
          request.destroy();
        };
        if (status >= 300 && status < 400) return stop('redirect_blocked');
        if (status < 200 || status >= 300) return stop('provider_rejected');
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
    requestPurpose?: 'probe' | 'signal-generation';
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
  const requestMaximumBytes = config.requestPurpose === 'signal-generation' ? 256 * 1024 : 32_768;
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
      }),
      signal,
    );
    if (response.status >= 300 && response.status < 400) return fail('redirect_blocked');
    if (!response.ok) return fail('provider_rejected');
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
