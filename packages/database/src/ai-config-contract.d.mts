export class AiConfigError extends Error {
  readonly code: string;
}
export const aiConfigErrorCodes: readonly string[];
export function parseAiConnectionCreate(
  request: unknown,
  allowedHosts: readonly string[] | ReadonlySet<string>,
): AiConnectionCreateRequest;
export function parseAiConnectionUpdate(
  request: unknown,
  allowedHosts: readonly string[] | ReadonlySet<string>,
): AiConnectionUpdateRequest;
export function parseAiProfileSave(request: unknown): AiProfileSaveRequest;
export function parseAiProbeRequest(request: unknown): AiProbeRequest;
import type {
  AiConnectionCreateRequest,
  AiConnectionUpdateRequest,
  AiProfileSaveRequest,
  AiProbeRequest,
} from './ai-config-store.mjs';
