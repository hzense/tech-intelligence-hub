/** Background step deadline; independent of the request and capability probe.
 * Requires a verified 1800s Workflow step runtime; leaves 5 minutes for bookkeeping.
 * Database lease is 32 minutes. No provider retries or token-limit changes.
 */
export const generationTimeoutMs = 1_500_000;

export const generationDiagnosticCodes = [
  'generation_timeout',
  'generation_provider_rejected',
  'generation_network_error',
  'generation_dns_failed',
  'generation_blocked_target',
  'generation_redirect_blocked',
  'generation_response_too_large',
  'generation_invalid_response',
  'generation_invalid_configuration',
  'generation_invalid_output',
  'generation_output_rejected',
  'generation_sdk_error',
] as const;
export type GenerationDiagnosticCode = (typeof generationDiagnosticCodes)[number];

/** Never propagate arbitrary error strings supplied by a transport or model. */
export function safeGenerationDiagnosticCode(value: unknown): GenerationDiagnosticCode | null {
  return generationDiagnosticCodes.find((code) => code === value) ?? null;
}

export function generationElapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}
