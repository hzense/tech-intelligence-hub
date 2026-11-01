/** Safe, versioned probe receipts. Never accept provider prose, URLs or headers. */
export const aiProbeDiagnosticStages = Object.freeze([
  'configuration',
  'model_catalog',
  'model_request',
  'response_validation',
]);
export const aiProbeDiagnosticReasons = Object.freeze([
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
  'unsupported_parameters',
  'invalid_tool_call',
  'invalid_structured_output',
  'sentinel_mismatch',
  'invalid_request',
  'authentication_failed',
  'insufficient_credit',
  'access_denied',
  'model_not_found',
  'no_matching_provider',
  'rate_limited',
  'provider_unavailable',
]);
export const aiProbeRejectedStatuses = Object.freeze([
  400, 401, 402, 403, 404, 405, 413, 415, 422, 429,
]);

function record(value, allowed) {
  if (
    value === null ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptor, 'value'))
      return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export function parseAiProbeDiagnostics(value) {
  try {
    value = record(value, ['version', 'stage', 'reason', 'http_status', 'rejection_confirmed']);
    if (
      !value ||
      value.version !== 1 ||
      !aiProbeDiagnosticStages.includes(value.stage) ||
      !aiProbeDiagnosticReasons.includes(value.reason)
    )
      return null;
    if (
      value.http_status !== undefined &&
      (!Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599)
    )
      return null;
    if (
      value.rejection_confirmed !== undefined &&
      (typeof value.rejection_confirmed !== 'boolean' || value.http_status === undefined)
    )
      return null;
    if (
      value.rejection_confirmed === true &&
      (!aiProbeRejectedStatuses.includes(value.http_status) ||
        !['model_catalog', 'model_request'].includes(value.stage))
    )
      return null;
    return {
      version: 1,
      stage: value.stage,
      reason: value.reason,
      ...(value.http_status === undefined ? {} : { http_status: value.http_status }),
      ...(value.rejection_confirmed === undefined
        ? {}
        : { rejection_confirmed: value.rejection_confirmed }),
    };
  } catch {
    return null;
  }
}

/** A generic legacy error code or a server failure is not proof of non-execution. */
export function isConfirmedAiProbeRejection(outcome) {
  try {
    const diagnostic = parseAiProbeDiagnostics(outcome?.diagnostics);
    return (
      outcome?.success === false &&
      outcome.error_code === 'provider_rejected' &&
      diagnostic?.rejection_confirmed === true &&
      [null, 0].includes(outcome.input_tokens) &&
      [null, 0].includes(outcome.output_tokens) &&
      (outcome.provider_cost_microusd == null || outcome.provider_cost_microusd === 0)
    );
  } catch {
    return false;
  }
}

export function parseAiProbeAccounting(value) {
  try {
    value = record(value, ['version', 'source']);
    if (
      !value ||
      value.version !== 1 ||
      !['provider', 'request_rejected', 'estimate'].includes(value.source)
    )
      return null;
    return { version: 1, source: value.source };
  } catch {
    return null;
  }
}
