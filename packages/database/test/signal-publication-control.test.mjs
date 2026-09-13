import { describe, expect, it, vi } from 'vitest';
import {
  PublicationControlError,
  assertPublicationLease,
  assertPublicationPolicy,
  controlMaximumFence,
  parsePublicationControlContext,
  parsePublicationControlRequest,
} from '../src/signal-publication-control.mjs';

const runId = '00000000-0000-0000-0000-000000000001';
const taskId = '00000000-0000-0000-0000-000000000002';
const principalId = '00000000-0000-0000-0000-000000000003';
const ownerId = '00000000-0000-0000-0000-000000000004';
const otherId = '00000000-0000-0000-0000-000000000005';

function request(operation = 'gate', overrides = {}) {
  const inputs = {
    create: {
      run_id: runId,
      task_id: taskId,
      principal_id: principalId,
      original_intent: 'auto_publish',
    },
    claim: { run_id: runId, lease_owner: ownerId, lease_seconds: 60 },
    renew: { run_id: runId, lease_owner: ownerId, fencing_token: 1, lease_seconds: 60 },
    cancel: { run_id: runId },
    complete: { run_id: runId, lease_owner: ownerId, fencing_token: 1 },
    gate: { run_id: runId, lease_owner: ownerId, fencing_token: 1 },
  };
  return { ...inputs[operation], ...overrides };
}

function context() {
  return {
    control: { publication_enabled: true },
    task: { task_id: taskId, policy: 'auto_publish', publication_enabled: true },
    authorization: { task_id: taskId, principal_id: principalId, can_publish: true },
    run: {
      run_id: runId,
      task_id: taskId,
      principal_id: principalId,
      original_intent: 'auto_publish',
      status: 'running',
      fencing_token: 1,
      lease_owner: ownerId,
      lease_expires_at: new Date('2026-09-13T10:01:00.000Z'),
      created_at: new Date('2026-09-13T10:00:00.000Z'),
    },
    now: new Date('2026-09-13T10:00:30.000Z'),
  };
}

function expectCode(callback, code) {
  expect(callback).toThrowError(PublicationControlError);
  expect(callback).toThrowError(expect.objectContaining({ code, message: code }));
}

describe('private publication control command boundary', () => {
  it.each(['create', 'claim', 'renew', 'cancel', 'complete', 'gate'])(
    'accepts only the exact %s shape and returns a separate plain command',
    (operation) => {
      const input = request(operation);
      expect(parsePublicationControlRequest(input, operation)).toEqual(input);
      expect(parsePublicationControlRequest(input, operation)).not.toBe(input);
      expect(
        parsePublicationControlRequest(Object.assign(Object.create(null), input), operation),
      ).toEqual(input);
      for (const key of Object.keys(input)) {
        const missing = { ...input };
        delete missing[key];
        expectCode(
          () => parsePublicationControlRequest(missing, operation),
          'invalid_control_request',
        );
      }
      for (const extra of [
        'authorized',
        'now',
        'current_time',
        'is_admin',
        'source_url',
        'payload',
      ]) {
        expectCode(
          () => parsePublicationControlRequest({ ...input, [extra]: true }, operation),
          'invalid_control_request',
        );
      }
    },
  );

  it.each([null, undefined, {}, [], 'gate', new Date(), Object.create({ run_id: runId })])(
    'rejects malformed command containers %j',
    (input) =>
      expectCode(() => parsePublicationControlRequest(input, 'cancel'), 'invalid_control_request'),
  );

  it.each(['publish', 'toString', '__proto__', '', null, undefined, {}])(
    'rejects unknown operation %j without exposing caller data',
    (operation) =>
      expectCode(
        () => parsePublicationControlRequest(request(), operation),
        'invalid_control_request',
      ),
  );

  it('rejects symbols, custom prototypes and accessors without evaluating getters', () => {
    const getter = vi.fn(() => runId);
    const accessor = Object.defineProperty({}, 'run_id', { get: getter, enumerable: true });
    for (const value of [
      { ...request('cancel'), [Symbol('secret')]: true },
      Object.assign(Object.create({ authorized: true }), request('cancel')),
      accessor,
    ]) {
      expectCode(() => parsePublicationControlRequest(value, 'cancel'), 'invalid_control_request');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('normalizes malformed reflection failures instead of exposing caller-controlled exceptions', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('private caller data');
        },
      },
    );
    for (const input of [revoked.proxy, trapped]) {
      expectCode(() => parsePublicationControlRequest(input, 'cancel'), 'invalid_control_request');
      expectCode(() => assertPublicationLease(context(), input), 'invalid_control_request');
      expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
    }
  });

  it('accepts opaque lowercase UUIDs, including zero and non-versioned fixture identifiers', () => {
    for (const identifier of [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]) {
      const create = request('create', {
        run_id: identifier,
        task_id: identifier,
        principal_id: identifier,
      });
      expect(parsePublicationControlRequest(create, 'create')).toEqual(create);
      expect(
        parsePublicationControlRequest(request('claim', { lease_owner: identifier }), 'claim')
          .lease_owner,
      ).toBe(identifier);
    }
  });

  it.each([
    '',
    ' ',
    'not-a-uuid',
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
    '00000000000000000000000000000001',
    `${runId}\n`,
    `${runId}\r\n`,
    `${runId}\0`,
    ` ${runId}`,
    `${runId} `,
    runId.slice(0, 35),
    null,
    undefined,
    1,
  ])('rejects malformed UUID %j for every identifier field', (identifier) => {
    for (const key of ['run_id', 'task_id', 'principal_id']) {
      expectCode(
        () => parsePublicationControlRequest(request('create', { [key]: identifier }), 'create'),
        'invalid_control_request',
      );
    }
    expectCode(
      () => parsePublicationControlRequest(request('claim', { lease_owner: identifier }), 'claim'),
      'invalid_control_request',
    );
  });

  it.each(['auto_publish', 'review_required', 'preview_only'])(
    'records original intent %s without equating parsing with publication permission',
    (intent) => {
      const parsed = parsePublicationControlRequest(
        request('create', { original_intent: intent }),
        'create',
      );
      expect(parsed.original_intent).toBe(intent);
      expect(parsed).not.toHaveProperty('authorized');
    },
  );

  it.each(['approved', 'AUTO_PUBLISH', true, 1, null, undefined])(
    'rejects invalid intent %j',
    (intent) => {
      expectCode(
        () =>
          parsePublicationControlRequest(request('create', { original_intent: intent }), 'create'),
        'invalid_control_request',
      );
    },
  );

  it.each([0, -1, 1.5, '1', true, null, undefined, NaN, Infinity, 2_147_483_648])(
    'rejects invalid fencing token %j',
    (token) => {
      for (const operation of ['renew', 'gate', 'complete']) {
        expectCode(
          () =>
            parsePublicationControlRequest(request(operation, { fencing_token: token }), operation),
          'invalid_control_request',
        );
      }
    },
  );

  it.each([0, -1, 1.5, '1', true, null, undefined, NaN, Infinity, 901])(
    'rejects invalid lease duration %j',
    (duration) => {
      for (const operation of ['claim', 'renew']) {
        expectCode(
          () =>
            parsePublicationControlRequest(
              request(operation, { lease_seconds: duration }),
              operation,
            ),
          'invalid_control_request',
        );
      }
    },
  );

  it('accepts both exact numeric bounds without coercion', () => {
    for (const fence of [1, controlMaximumFence]) {
      for (const seconds of [1, 900]) {
        const input = request('renew', { fencing_token: fence, lease_seconds: seconds });
        expect(parsePublicationControlRequest(input, 'renew')).toEqual(input);
      }
    }
  });
});

describe('locked private publication policy snapshot', () => {
  it('returns no authorization claim when all current controls permit publication', () => {
    const input = context();
    expect(assertPublicationPolicy(input)).toBeUndefined();
    expect(parsePublicationControlContext(input)).toEqual(input);
    const parsed = parsePublicationControlContext(input);
    parsed.run.created_at.setUTCFullYear(2000);
    parsed.run.lease_expires_at.setUTCFullYear(2000);
    parsed.now.setUTCFullYear(2000);
    expect(input.run.created_at.getUTCFullYear()).toBe(2026);
    expect(input.run.lease_expires_at.getUTCFullYear()).toBe(2026);
    expect(input.now.getUTCFullYear()).toBe(2026);
  });

  it.each([
    ['control', 'publication_enabled', false, 'publication_disabled'],
    ['task', 'publication_enabled', false, 'task_disabled'],
    ['task', 'policy', 'review_required', 'policy_disallows_publication'],
    ['task', 'policy', 'preview_only', 'policy_disallows_publication'],
    ['run', 'original_intent', 'review_required', 'intent_disallows_publication'],
    ['run', 'original_intent', 'preview_only', 'intent_disallows_publication'],
    ['authorization', 'can_publish', false, 'authorization_revoked'],
  ])('denies %s.%s=%j with %s', (table, field, value, code) => {
    const input = context();
    input[table][field] = value;
    expectCode(() => assertPublicationPolicy(input), code);
  });

  it('fails closed on missing rows, missing fields and uncontracted snapshot fields', () => {
    for (const table of ['control', 'task', 'authorization', 'run']) {
      for (const value of [null, undefined, [], {}, false]) {
        const input = context();
        input[table] = value;
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
      for (const field of Object.keys(context()[table])) {
        const input = context();
        delete input[table][field];
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
      const extra = context();
      extra[table].authorized = true;
      expectCode(() => assertPublicationPolicy(extra), 'invalid_control_state');
    }
    expectCode(
      () => assertPublicationPolicy({ ...context(), authorized: true }),
      'invalid_control_state',
    );
  });

  it('rejects boolean strings and malformed enum values instead of treating them as truthy', () => {
    for (const [table, field] of [
      ['control', 'publication_enabled'],
      ['task', 'publication_enabled'],
      ['authorization', 'can_publish'],
    ]) {
      for (const value of ['true', 'false', 1, 0, null, undefined]) {
        const input = context();
        input[table][field] = value;
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
    }
    for (const [table, field] of [
      ['task', 'policy'],
      ['run', 'original_intent'],
      ['run', 'status'],
    ]) {
      for (const value of ['approved', 'queued', 'AUTO_PUBLISH', true, null, undefined]) {
        const input = context();
        input[table][field] = value;
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
    }
  });

  it('requires matching canonical task and principal references across all rows', () => {
    for (const [table, field] of [
      ['task', 'task_id'],
      ['authorization', 'task_id'],
      ['authorization', 'principal_id'],
      ['run', 'task_id'],
      ['run', 'principal_id'],
    ]) {
      for (const value of [otherId, 'malformed-uuid']) {
        const input = context();
        input[table][field] = value;
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
    }
    for (const field of ['run_id', 'lease_owner']) {
      const input = context();
      input.run[field] = `${runId}\n`;
      expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
    }
  });

  it('requires finite, bounded Date instances for creation, expiry and trusted now', () => {
    for (const field of ['created_at', 'lease_expires_at', 'now']) {
      for (const value of [
        null,
        undefined,
        '2026-09-13T10:00:00Z',
        Date.now(),
        new Date(NaN),
        Object.create(Date.prototype),
        new Date('0000-01-01T00:00:00Z'),
        new Date('+010000-01-01T00:00:00Z'),
        Object.assign(new Date(), { authorized: true }),
      ]) {
        const input = context();
        if (field === 'now') input.now = value;
        else input.run[field] = value;
        expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
      }
    }
    for (const value of [new Date('0001-01-01T00:00:00Z'), new Date('9999-12-31T23:59:59.999Z')]) {
      const input = context();
      input.now = value;
      expect(assertPublicationPolicy(input)).toBeUndefined();
    }
  });

  it('rejects accessor-based state before invoking any getter', () => {
    const input = context();
    const getter = vi.fn(() => true);
    Object.defineProperty(input.control, 'publication_enabled', { get: getter });
    expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', 0],
    ['cancelled', 0],
    ['cancelled', 1],
    ['completed', 1],
  ])(
    'allows a structurally valid %s run with fence %s through the independent policy check',
    (status, fence) => {
      const input = context();
      Object.assign(input.run, {
        status,
        fencing_token: fence,
        lease_owner: null,
        lease_expires_at: null,
      });
      expect(assertPublicationPolicy(input)).toBeUndefined();
      expectCode(() => assertPublicationLease(input, request()), 'run_not_running');
    },
  );

  it.each([
    { status: 'pending', fencing_token: 1, lease_owner: null, lease_expires_at: null },
    { status: 'pending', fencing_token: 0 },
    { status: 'running', fencing_token: 0 },
    { status: 'running', lease_owner: null },
    { status: 'running', lease_expires_at: null },
    { status: 'completed', fencing_token: 0, lease_owner: null, lease_expires_at: null },
    { status: 'completed', fencing_token: 1 },
    { status: 'cancelled', fencing_token: 0 },
    { fencing_token: 2_147_483_648 },
    { fencing_token: -1 },
    { fencing_token: '1' },
  ])('rejects inconsistent lifecycle state %j', (overrides) => {
    const input = context();
    Object.assign(input.run, overrides);
    expectCode(() => assertPublicationPolicy(input), 'invalid_control_state');
    expectCode(() => assertPublicationLease(input, request()), 'invalid_control_state');
  });
});

describe('private publication lease and fencing checks', () => {
  it('passes valid complete/gate and renew commands without a permission return value', () => {
    for (const operation of ['complete', 'gate', 'renew']) {
      expect(assertPublicationLease(context(), request(operation))).toBeUndefined();
    }
  });

  it.each([
    [{ run_id: otherId }, 'run_mismatch'],
    [{ lease_owner: otherId }, 'lease_owner_mismatch'],
    [{ fencing_token: 2 }, 'stale_fencing_token'],
    [{ fencing_token: controlMaximumFence }, 'stale_fencing_token'],
  ])('denies a mismatched lease command %j', (overrides, code) => {
    expectCode(() => assertPublicationLease(context(), request('gate', overrides)), code);
  });

  it('accepts the last representable fence and rejects overflowing state or command', () => {
    const input = context();
    input.run.fencing_token = controlMaximumFence;
    expect(
      assertPublicationLease(input, request('gate', { fencing_token: controlMaximumFence })),
    ).toBeUndefined();
    expectCode(
      () =>
        assertPublicationLease(input, request('gate', { fencing_token: controlMaximumFence + 1 })),
      'invalid_control_request',
    );
    input.run.fencing_token = controlMaximumFence + 1;
    expectCode(() => assertPublicationLease(input, request()), 'invalid_control_state');
  });

  it.each([-1, 0, 1])('uses expiry > database now at a %s ms boundary', (offset) => {
    const input = context();
    input.run.lease_expires_at = new Date(input.now.getTime() + offset);
    if (offset > 0) expect(assertPublicationLease(input, request())).toBeUndefined();
    else expectCode(() => assertPublicationLease(input, request()), 'lease_expired');
  });

  it('uses only the supplied database snapshot and rejects clock claims in the command', () => {
    const input = context();
    const localClock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('local clock used');
    });
    try {
      expect(assertPublicationLease(input, request())).toBeUndefined();
      expect(localClock).not.toHaveBeenCalled();
      for (const field of ['now', 'current_time', 'lease_expires_at', 'authorized']) {
        expectCode(
          () => assertPublicationLease(input, request('gate', { [field]: true })),
          'invalid_control_request',
        );
      }
    } finally {
      localClock.mockRestore();
    }
  });

  it('keeps lease and current publication policy checks independent', () => {
    const input = context();
    input.control.publication_enabled = false;
    input.task.publication_enabled = false;
    input.authorization.can_publish = false;
    expect(assertPublicationLease(input, request())).toBeUndefined();
    expectCode(() => assertPublicationPolicy(input), 'publication_disabled');
  });

  it('never embeds unsupported caller strings in an error', () => {
    const error = new PublicationControlError('private payload must not escape');
    expect(error.code).toBe('invalid_control_state');
    expect(error.message).toBe('invalid_control_state');
    expect(error.stack).not.toContain('private payload must not escape');
  });
});
