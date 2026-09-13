import { readRuntimeReaderConfig, type RuntimeReaderEnvironment } from './runtime-reader-core.ts';

export class PublisherConfigurationError extends Error {
  constructor() {
    super('publisher_not_configured');
  }
}
export class PublicationOutcomeUnknownError extends Error {
  constructor() {
    super('publication_outcome_unknown');
  }
}

/** A separate credential, never DATABASE_URL/migrator or the public reader. */
export function readPublisherConfiguration(env: RuntimeReaderEnvironment): string {
  try {
    const value = env.HZENSE_PUBLISHER_DATABASE_URL;
    if (
      !value ||
      [...value].some(
        (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      ) ||
      !/^postgres(?:ql)?:\/\//.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (decodeURIComponent(url.username) !== 'hzense_publisher') throw new Error();
    // Reuse the strict approved production target/TLS/pooler contract. This URL
    // is only validated, never used to connect with the reader's identity.
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
    return value;
  } catch {
    throw new PublisherConfigurationError();
  }
}

const publicationFields = [
  'request_key',
  'signal_id',
  'source_version',
  'target_version',
  'expected_revision',
  'reason_code',
  'run_id',
  'lease_owner',
  'fencing_token',
];
const withdrawalFields = [
  'request_key',
  'signal_id',
  'target_version',
  'expected_revision',
  'reason_code',
];
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export type PublicationOperation = 'publish' | 'withdraw';

export function validPublicationCommand(
  value: unknown,
  operation: PublicationOperation,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const fields = operation === 'publish' ? publicationFields : withdrawalFields;
  if (
    Object.keys(command).length !== fields.length ||
    Object.keys(command).some((key) => !fields.includes(key))
  )
    return false;
  const matches = (key: string, expression: RegExp) =>
    typeof command[key] === 'string' &&
    (command[key] as string).match(expression)?.[0] === command[key];
  const integer = (key: string, minimum: number) =>
    Number.isInteger(command[key]) &&
    Number(command[key]) >= minimum &&
    Number(command[key]) <= 2_147_483_647;
  if (
    !matches('request_key', /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/) ||
    !matches('signal_id', slug) ||
    !integer('target_version', 1) ||
    !integer('expected_revision', 0)
  )
    return false;
  if (operation === 'withdraw')
    return ['factual_error', 'privacy', 'evidence_revoked', 'operator_request'].includes(
      String(command.reason_code),
    );
  return (
    integer('source_version', 1) &&
    Number(command.target_version) > Number(command.source_version) &&
    integer('fencing_token', 1) &&
    matches('run_id', uuid) &&
    matches('lease_owner', uuid) &&
    ['initial_publication', 'content_correction', 'republication'].includes(
      String(command.reason_code),
    )
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const maximum = 4096;
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new Error();
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

/** Dependencies are module-owned on the server; never supplied by request JSON. */
export function createPublicationHandler(dependencies: {
  authenticate: () => Promise<unknown>;
  origin: () => string | null;
  execute: (operation: PublicationOperation, command: Record<string, unknown>) => Promise<unknown>;
}) {
  return async (request: Request, operation: PublicationOperation): Promise<Response> => {
    if (request.method !== 'POST') return failure('method_not_allowed', 405);
    // Authenticate before parsing a body, reading private state or opening a pool.
    if (!(await dependencies.authenticate())) return failure('unauthorized', 401);
    const origin = dependencies.origin();
    if (
      !origin ||
      request.headers.get('origin') !== origin ||
      !['same-origin', null].includes(request.headers.get('sec-fetch-site'))
    )
      return failure('forbidden_origin', 403);
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      )
    )
      return failure('json_required', 415);
    let command: unknown;
    try {
      command = await readBoundedJson(request);
    } catch {
      return failure('invalid_command', 400);
    }
    if (!validPublicationCommand(command, operation)) return failure('invalid_command', 400);
    try {
      return Response.json(await dependencies.execute(operation, command), { headers });
    } catch (error) {
      if (error instanceof PublisherConfigurationError)
        return failure('publisher_not_configured', 503);
      if (error instanceof PublicationOutcomeUnknownError)
        return failure('publication_outcome_unknown', 503);
      // Never return raw PostgreSQL errors, URLs, evidence text or private reports.
      return failure('publication_not_applied', 409);
    }
  };
}
