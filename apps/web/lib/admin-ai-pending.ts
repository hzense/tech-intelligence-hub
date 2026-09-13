import type { AiProbeRequest } from '../../../packages/database/src/ai-config-store.mjs';

export const pendingAiProbeStorageKey = 'hzense.ai.pending-probe.v1';
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageFactory = () => PendingStorage;
export type PendingAiProbeState =
  { available: true; request: AiProbeRequest | null } | { available: false; request: null };

const browserStorage: StorageFactory = () => globalThis.sessionStorage;
const kinds = ['models', 'connection', 'structured_output', 'tool_calling'] as const;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)?.[0] ===
    value;

function dataObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const names = Reflect.ownKeys(value);
  if (names.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[String(key)] = descriptor.value;
  }
  return result;
}

/** Reconstruct only the non-secret, idempotent request fields, never arbitrary JSON. */
function safeRequest(value: unknown): AiProbeRequest | null {
  const row = dataObject(value, ['id', 'connection_id', 'connection_revision', 'kind', 'model_id']);
  if (
    !row ||
    !uuid(row.id) ||
    !uuid(row.connection_id) ||
    typeof row.connection_revision !== 'number' ||
    !Number.isSafeInteger(row.connection_revision) ||
    row.connection_revision < 1 ||
    row.connection_revision > 2147483647 ||
    typeof row.kind !== 'string' ||
    !(kinds as readonly string[]).includes(row.kind)
  )
    return null;
  const request = {
    id: row.id,
    connection_id: row.connection_id,
    connection_revision: row.connection_revision,
    kind: row.kind as AiProbeRequest['kind'],
  };
  if (row.kind === 'models') return Object.hasOwn(row, 'model_id') ? null : request;
  const model = row.model_id;
  if (
    typeof model !== 'string' ||
    model.length > 200 ||
    model.match(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)?.[0] !== model
  )
    return null;
  return { ...request, model_id: model };
}

/** Call after hydration. Invalid or unavailable storage keeps paid actions closed. */
export function readPendingAiProbe(storage: StorageFactory = browserStorage): PendingAiProbeState {
  try {
    const raw = storage().getItem(pendingAiProbeStorageKey);
    if (raw === null) return { available: true, request: null };
    if (typeof raw !== 'string' || raw.length > 1024) return { available: false, request: null };
    const envelope = dataObject(JSON.parse(raw), ['version', 'request']);
    const request = envelope?.version === 1 ? safeRequest(envelope.request) : null;
    return request ? { available: true, request } : { available: false, request: null };
  } catch {
    return { available: false, request: null };
  }
}

/** Must succeed before a paid POST; inability to retain the request ID is fatal. */
export function persistPendingAiProbe(
  value: AiProbeRequest,
  storage: StorageFactory = browserStorage,
): boolean {
  try {
    const request = safeRequest(value);
    if (!request) return false;
    const target = storage();
    const serialized = JSON.stringify({ version: 1, request });
    const existing = target.getItem(pendingAiProbeStorageKey);
    if (existing !== null && existing !== serialized) return false;
    target.setItem(pendingAiProbeStorageKey, serialized);
    return target.getItem(pendingAiProbeStorageKey) === serialized;
  } catch {
    return false;
  }
}

/** A failed removal must not reopen new-test controls. */
export function clearPendingAiProbe(storage: StorageFactory = browserStorage): boolean {
  try {
    const target = storage();
    target.removeItem(pendingAiProbeStorageKey);
    return target.getItem(pendingAiProbeStorageKey) === null;
  } catch {
    return false;
  }
}
