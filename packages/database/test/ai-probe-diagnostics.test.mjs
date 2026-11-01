import { describe, expect, it } from 'vitest';
import {
  parseAiProbeDiagnostics,
  isConfirmedAiProbeRejection,
  parseAiProbeAccounting,
} from '../src/ai-probe-diagnostics.mjs';

const rejection = {
  version: 1,
  stage: 'model_request',
  reason: 'invalid_request',
  http_status: 400,
  rejection_confirmed: true,
};
const outcome = {
  success: false,
  error_code: 'provider_rejected',
  input_tokens: null,
  output_tokens: null,
  diagnostics: rejection,
};

describe('safe AI capability-test receipts', () => {
  it('retains only a versioned, bounded diagnostic contract', () => {
    expect(parseAiProbeDiagnostics(rejection)).toEqual(rejection);
    expect(
      parseAiProbeDiagnostics({
        version: 1,
        stage: 'response_validation',
        reason: 'invalid_tool_call',
      }),
    ).toEqual({ version: 1, stage: 'response_validation', reason: 'invalid_tool_call' });
    for (const invalid of [
      null,
      [],
      'provider_rejected',
      { ...rejection, version: '1' },
      { ...rejection, stage: 'https://provider.example/private' },
      { ...rejection, reason: 'raw provider text and secret' },
      { ...rejection, message: 'raw provider text and secret' },
      { ...rejection, http_status: '400' },
      { ...rejection, rejection_confirmed: 'true' },
      { ...rejection, http_status: undefined },
      { ...rejection, stage: 'response_validation' },
      { ...rejection, http_status: 408 },
      { ...rejection, http_status: 500 },
    ])
      expect(parseAiProbeDiagnostics(invalid)).toBeNull();
  });

  it('does not interpret historical codes, incomplete receipts or observed usage as a free refusal', () => {
    expect(isConfirmedAiProbeRejection(outcome)).toBe(true);
    expect(isConfirmedAiProbeRejection({ ...outcome, input_tokens: 0, output_tokens: 0 })).toBe(
      true,
    );
    for (const patch of [
      { diagnostics: undefined },
      { diagnostics: { ...rejection, rejection_confirmed: false } },
      { diagnostics: { ...rejection, http_status: 503 } },
      { error_code: 'timeout' },
      { success: true },
      { input_tokens: 1 },
      { output_tokens: 1 },
      { input_tokens: undefined },
      { provider_cost_microusd: 1 },
      { provider_cost_microusd: -1 },
    ])
      expect(isConfirmedAiProbeRejection({ ...outcome, ...patch })).toBe(false);
  });

  it('rejects unversioned accounting and arbitrary provider prose', () => {
    for (const source of ['provider', 'request_rejected', 'estimate'])
      expect(parseAiProbeAccounting({ version: 1, source })).toEqual({ version: 1, source });
    for (const invalid of [
      { source: 'provider' },
      { version: '1', source: 'provider' },
      { version: 1, source: 'free' },
      { version: 1, source: 'provider', raw: 'secret' },
    ])
      expect(parseAiProbeAccounting(invalid)).toBeNull();
  });

  it('never invokes accessors or allows values to change between validation and copying', () => {
    let reads = 0;
    const reason = { ...rejection };
    Object.defineProperty(reason, 'reason', {
      enumerable: true,
      get() {
        return ++reads === 1 ? 'invalid_request' : 'sensitive-provider-body';
      },
    });
    const source = { version: 1 };
    Object.defineProperty(source, 'source', {
      enumerable: true,
      get() {
        reads++;
        return 'provider';
      },
    });
    expect(parseAiProbeDiagnostics(reason)).toBeNull();
    expect(parseAiProbeAccounting(source)).toBeNull();
    expect(reads).toBe(0);
    expect(parseAiProbeDiagnostics({ ...rejection, [Symbol('secret')]: 'private' })).toBeNull();
    expect(parseAiProbeDiagnostics(Object.assign(Object.create(null), rejection))).toEqual(
      rejection,
    );
  });
});
