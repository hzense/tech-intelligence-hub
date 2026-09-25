import type {
  AiAllowedHosts,
  AiConnectionCreateRequest,
  AiConnectionSettings,
  AiConnectionUpdateRequest,
  AiProfileSaveRequest,
  AiProbeKind,
  AiProbeRequest,
} from './ai-config-store.mjs';

export class AiConfigError extends Error {
  constructor(code?: string);
  readonly code: string;
}
export const aiConfigErrorCodes: readonly string[];
export const AI_PROBE_OUTPUT_TOKENS: number;
export const AI_PROFILE_MAX_OUTPUT_TOKENS: number;
export function aiFail(code?: string): never;
export function aiObject(
  value: unknown,
  required: readonly string[],
  optional?: readonly string[],
): Record<string, unknown>;
export function aiText(value: unknown, max?: number, options?: { empty?: boolean }): string;
export function aiUuid(value: unknown): string;
export function aiModelId(value: unknown): string;
export function aiInteger(value: unknown, min: number, max: number): number;
export function parseAiSettings(value: unknown): AiConnectionSettings;
export function validateAiBaseUrl(value: unknown, allowedHosts: AiAllowedHosts): string;
export function parseAiApiKey(value: unknown): string;
export function parseAiConnectionCreate(
  request: unknown,
  allowedHosts: AiAllowedHosts,
): AiConnectionCreateRequest;
export function parseAiConnectionUpdate(
  request: unknown,
  allowedHosts: AiAllowedHosts,
): AiConnectionUpdateRequest;
export function parseAiProfileSave(request: unknown): AiProfileSaveRequest;
export const aiProbeKinds: readonly AiProbeKind[];
export function parseAiProbeRequest(request: unknown): AiProbeRequest;
