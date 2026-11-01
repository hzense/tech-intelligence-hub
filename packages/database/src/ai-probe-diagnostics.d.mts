export type AiProbeDiagnosticStage =
  'configuration' | 'model_catalog' | 'model_request' | 'response_validation';
export type AiProbeDiagnosticReason =
  | 'invalid_configuration'
  | 'invalid_model'
  | 'blocked_target'
  | 'dns_failed'
  | 'timeout'
  | 'network_error'
  | 'response_too_large'
  | 'redirect_blocked'
  | 'provider_rejected'
  | 'invalid_response'
  | 'capability_failed'
  | 'unsupported_parameters'
  | 'invalid_tool_call'
  | 'invalid_structured_output'
  | 'sentinel_mismatch'
  | 'invalid_request'
  | 'authentication_failed'
  | 'insufficient_credit'
  | 'access_denied'
  | 'model_not_found'
  | 'no_matching_provider'
  | 'rate_limited'
  | 'provider_unavailable';
export interface AiProbeDiagnostics {
  version: 1;
  stage: AiProbeDiagnosticStage;
  reason: AiProbeDiagnosticReason;
  http_status?: number;
  rejection_confirmed?: boolean;
}
export interface AiProbeAccounting {
  version: 1;
  source: 'provider' | 'request_rejected' | 'estimate';
}
export const aiProbeDiagnosticStages: readonly AiProbeDiagnosticStage[];
export const aiProbeDiagnosticReasons: readonly AiProbeDiagnosticReason[];
export const aiProbeRejectedStatuses: readonly number[];
export function parseAiProbeDiagnostics(value: unknown): AiProbeDiagnostics | null;
export function isConfirmedAiProbeRejection(value: unknown): boolean;
export function parseAiProbeAccounting(value: unknown): AiProbeAccounting | null;
