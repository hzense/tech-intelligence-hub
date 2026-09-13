import { describe, expect, it } from 'vitest';
import {
  fingerprintSignalPublicationRequest,
  parseSignalPublicationHead,
  parseSignalPublicationReceipt,
  parseSignalPublicationRequest,
  planSignalPublicationProjection,
  planSignalPublicationTransition,
  signalPublicationMaximumRevision,
} from '../src/signal-publication-transition.mjs';

function request(overrides = {}) {
  return {
    request_key: 'req-1',
    signal_id: 'signal-a',
    action: 'publish',
    target_version: 1,
    expected_revision: 0,
    reason_code: 'initial_publication',
    ...overrides,
  };
}
function head(overrides = {}) {
  return {
    signal_id: 'signal-a',
    publication_revision: 1,
    content_version: 1,
    status: 'published',
    ...overrides,
  };
}
function receipt(overrides = {}) {
  return {
    request_key: 'req-1',
    request_fingerprint: '05a5c153b7a5728c9e47ad82d88a3be3c289825fa211e90171481692e35830bd',
    signal_id: 'signal-a',
    expected_revision: 0,
    publication_revision: 1,
    content_version: 1,
    status: 'published',
    reason_code: 'initial_publication',
    ...overrides,
  };
}
function transition(currentHead, nextRequest, previousReceipt = null) {
  return planSignalPublicationTransition(
    { head: currentHead, receipt: previousReceipt },
    nextRequest,
  );
}

describe('strict private publication commands and fingerprints', () => {
  it('has a fixed canonical SHA-256 vector independent of object order or request-key spelling', () => {
    expect(fingerprintSignalPublicationRequest(request())).toBe(receipt().request_fingerprint);
    const reordered = Object.fromEntries(Object.entries(request()).reverse());
    expect(fingerprintSignalPublicationRequest(reordered)).toBe(receipt().request_fingerprint);
    expect(fingerprintSignalPublicationRequest(request({ request_key: 'another-key' }))).toBe(
      receipt().request_fingerprint,
    );
    for (const change of [
      { signal_id: 'signal-b' },
      { target_version: 2 },
      { expected_revision: 1 },
      { reason_code: 'republication' },
      { action: 'withdraw', reason_code: 'operator_request' },
    ]) {
      expect(fingerprintSignalPublicationRequest(request(change))).not.toBe(
        receipt().request_fingerprint,
      );
    }
  });

  it.each(['A', 'a'.repeat(200), 'Signal:1.with_underscore-2'])(
    'accepts exact ASCII request token %s',
    (key) => {
      expect(parseSignalPublicationRequest(request({ request_key: key })).request_key).toBe(key);
    },
  );

  it.each([
    '',
    ' ',
    '\t\n',
    '-prefix',
    '_prefix',
    'key\n',
    'key\r\n',
    'key\0',
    'key with space',
    '请求',
    'a'.repeat(201),
    null,
    undefined,
    123,
  ])('rejects malformed request token %j', (key) => {
    expect(() => parseSignalPublicationRequest(request({ request_key: key }))).toThrow(TypeError);
  });

  it.each([0, -1, 1.1, '1', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid content version %j',
    (version) => {
      expect(() => parseSignalPublicationRequest(request({ target_version: version }))).toThrow(
        TypeError,
      );
    },
  );

  it.each([-1, 0.1, '0', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid expected revision %j',
    (revision) => {
      expect(() => parseSignalPublicationRequest(request({ expected_revision: revision }))).toThrow(
        TypeError,
      );
    },
  );

  it.each(['reason', 'authorized', 'is_admin', 'source_url', 'summary', 'private_document'])(
    'rejects uncontracted caller field %s',
    (field) => {
      expect(() =>
        parseSignalPublicationRequest({ ...request(), [field]: 'must not be published' }),
      ).toThrow(TypeError);
    },
  );

  it('requires every field and rejects arbitrary reasons, missing inputs or unknown action/status', () => {
    for (const field of Object.keys(request())) {
      const value = request();
      delete value[field];
      expect(() => parseSignalPublicationRequest(value)).toThrow(TypeError);
    }
    for (const invalid of [
      null,
      [],
      new Date(),
      {},
      { ...request(), reason_code: 'because this private interview says so' },
      { ...request(), action: 'restore' },
      { ...request(), action: 'withdraw' },
    ]) {
      expect(() => parseSignalPublicationRequest(invalid)).toThrow(TypeError);
    }
    expect(() => parseSignalPublicationHead(head({ status: 'accepted' }))).toThrow(TypeError);
    expect(() => parseSignalPublicationHead(head({ publication_revision: 0 }))).toThrow(TypeError);
    expect(() => parseSignalPublicationHead(head({ content_version: null }))).toThrow(TypeError);
    expect(() => parseSignalPublicationHead({ ...head(), occurred_at: '2026-01-01' })).toThrow(
      TypeError,
    );
    expect(() => parseSignalPublicationRequest({ ...request(), [Symbol('hidden')]: true })).toThrow(
      TypeError,
    );
  });

  it('preserves signal identifiers byte-for-byte rather than trimming fingerprint input', () => {
    const literal = request({ signal_id: ' signal-a ' });
    expect(parseSignalPublicationRequest(literal).signal_id).toBe(' signal-a ');
    expect(fingerprintSignalPublicationRequest(literal)).not.toBe(receipt().request_fingerprint);
    for (const signalId of ['', ' ', '\t\n', null])
      expect(() => parseSignalPublicationRequest(request({ signal_id: signalId }))).toThrow(
        TypeError,
      );
  });

  it('validates permanent receipt fingerprints and their applied revision relationship', () => {
    expect(parseSignalPublicationReceipt(receipt())).toEqual(receipt());
    for (const change of [
      { request_fingerprint: '0'.repeat(64) },
      { request_fingerprint: receipt().request_fingerprint + '\n' },
      { publication_revision: 2 },
      { content_version: 2 },
      { reason_code: 'republication' },
      { status: 'withdrawn' },
      { expected_revision: signalPublicationMaximumRevision },
    ]) {
      expect(() => parseSignalPublicationReceipt(receipt(change))).toThrow(TypeError);
    }
    expect(() =>
      parseSignalPublicationReceipt({ ...receipt(), summary: 'Do not publish me' }),
    ).toThrow(TypeError);
  });
});

describe('revision-ordered private publication transitions', () => {
  it('plans initial publication with any positive content version without declaring authorization', () => {
    for (const version of [1, 17, signalPublicationMaximumRevision]) {
      const result = transition(null, request({ target_version: version }));
      expect(result.outcome).toBe('apply');
      expect(result.head).toEqual(head({ content_version: version }));
      expect(parseSignalPublicationReceipt(result.event)).toEqual(result.event);
      expect(result).not.toHaveProperty('authorized');
      expect(result).not.toHaveProperty('eligible');
      expect(result.event).not.toHaveProperty('summary');
      expect(result.event).not.toHaveProperty('event_id');
      expect(result.event).not.toHaveProperty('occurred_at');
    }
  });

  it('separates content versions from revisions across publish, withdraw, republish and correction', () => {
    const first = transition(null, request({ target_version: 3 }));
    const withdrawal = transition(
      first.head,
      request({
        request_key: 'withdraw-1',
        action: 'withdraw',
        target_version: 3,
        expected_revision: 1,
        reason_code: 'factual_error',
      }),
    );
    expect(withdrawal.head).toEqual(
      head({ content_version: 3, publication_revision: 2, status: 'withdrawn' }),
    );
    const republish = transition(
      withdrawal.head,
      request({
        request_key: 'republish-1',
        target_version: 4,
        expected_revision: 2,
        reason_code: 'republication',
      }),
    );
    expect(republish.head).toEqual(head({ content_version: 4, publication_revision: 3 }));
    const correction = transition(
      republish.head,
      request({
        request_key: 'correction-1',
        target_version: 6,
        expected_revision: 3,
        reason_code: 'content_correction',
      }),
    );
    expect(correction.head).toEqual(head({ content_version: 6, publication_revision: 4 }));
    expect(
      [first, withdrawal, republish, correction].every((result) =>
        parseSignalPublicationReceipt(result.event),
      ),
    ).toBe(true);
  });

  it.each(['factual_error', 'privacy', 'evidence_revoked', 'operator_request'])(
    'supports the safe withdrawal code %s',
    (reasonCode) => {
      expect(
        transition(
          head(),
          request({
            action: 'withdraw',
            target_version: 1,
            expected_revision: 1,
            reason_code: reasonCode,
          }),
        ).head,
      ).toEqual(head({ publication_revision: 2, status: 'withdrawn' }));
    },
  );

  it('refuses a first withdrawal and a new request that pretends to withdraw an already-withdrawn head', () => {
    const withdrawal = request({ action: 'withdraw', reason_code: 'operator_request' });
    expect(transition(null, withdrawal)).toEqual({
      outcome: 'rejected',
      reason: 'withdraw_requires_published_head',
    });
    expect(
      transition(head({ status: 'withdrawn', publication_revision: 2 }), {
        ...withdrawal,
        request_key: 'new-withdrawal',
        expected_revision: 2,
      }),
    ).toEqual({ outcome: 'rejected', reason: 'already_withdrawn' });
  });

  it.each(['published', 'withdrawn'])(
    'never revives or republishes the same or older content when %s',
    (status) => {
      for (const targetVersion of [1, 2]) {
        expect(
          transition(
            head({ content_version: 2, status }),
            request({
              target_version: targetVersion,
              expected_revision: 1,
              reason_code: status === 'published' ? 'content_correction' : 'republication',
            }),
          ),
        ).toEqual({ outcome: 'rejected', reason: 'content_version_not_increasing' });
      }
    },
  );

  it.each([0, 1, 2])('requires the publish reason code dictated by head state %s', (stateIndex) => {
    const states = [null, head(), head({ status: 'withdrawn' })];
    const required = ['initial_publication', 'content_correction', 'republication'];
    for (const reasonCode of required) {
      const result = transition(
        states[stateIndex],
        request({
          target_version: 3,
          expected_revision: stateIndex === 0 ? 0 : 1,
          reason_code: reasonCode,
        }),
      );
      if (reasonCode === required[stateIndex]) expect(result.outcome).toBe('apply');
      else expect(result).toEqual({ outcome: 'rejected', reason: 'reason_code_mismatch' });
    }
  });

  it.each([1, 3])('refuses withdrawal aimed at non-current content version %s', (targetVersion) => {
    expect(
      transition(
        head({ content_version: 2 }),
        request({
          action: 'withdraw',
          reason_code: 'privacy',
          expected_revision: 1,
          target_version: targetVersion,
        }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'withdraw_target_mismatch' });
  });

  it.each([0, 1, 3, signalPublicationMaximumRevision])(
    'conflicts stale expected revision %s rather than mutating',
    (expectedRevision) => {
      const current = head({ publication_revision: 2, content_version: 1 });
      expect(
        transition(
          current,
          request({
            expected_revision: expectedRevision,
            target_version: 2,
            reason_code: 'content_correction',
          }),
        ),
      ).toEqual({ outcome: 'conflict', reason: 'stale_revision' });
    },
  );

  it('fails closed at int32 revision exhaustion but may still replay an earlier receipt', () => {
    const current = head({ publication_revision: signalPublicationMaximumRevision });
    expect(
      transition(
        current,
        request({
          expected_revision: signalPublicationMaximumRevision,
          target_version: 2,
          reason_code: 'content_correction',
        }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'revision_exhausted' });
    expect(
      transition(
        current,
        request({
          expected_revision: signalPublicationMaximumRevision,
          action: 'withdraw',
          reason_code: 'privacy',
        }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'revision_exhausted' });
    expect(transition(current, request(), receipt()).outcome).toBe('replay');
  });

  it('replays a permanent receipt as historical applied data without resurrecting a withdrawn head', () => {
    const current = head({ publication_revision: 2, status: 'withdrawn' });
    const result = transition(current, request(), receipt());
    expect(result).toEqual({
      outcome: 'replay',
      receipt: receipt(),
      current_head: current,
      current_head_unchanged: true,
    });
    expect(result).not.toHaveProperty('head');
    expect(result).not.toHaveProperty('event');
    expect(result.receipt.status).toBe('published');
    expect(result.current_head.status).toBe('withdrawn');
    expect(
      transition(head({ publication_revision: 4, content_version: 9 }), request(), receipt())
        .receipt,
    ).toEqual(receipt());
  });

  it('replays an exact withdrawal retry but does not count it as a new revision', () => {
    const command = request({
      request_key: 'withdraw-key',
      action: 'withdraw',
      expected_revision: 1,
      reason_code: 'evidence_revoked',
    });
    const result = transition(head(), command);
    expect(transition(result.head, command, result.event)).toEqual({
      outcome: 'replay',
      receipt: result.event,
      current_head: result.head,
      current_head_unchanged: true,
    });
  });

  it.each([
    { signal_id: 'signal-b' },
    { action: 'withdraw', reason_code: 'privacy' },
    { target_version: 2 },
    { expected_revision: 1 },
    { reason_code: 'republication' },
  ])('conflicts a reused request key with changed semantic payload %j', (change) => {
    const command = request(change);
    expect(transition(null, command, receipt())).toEqual({
      outcome: 'conflict',
      reason: 'request_key_reused',
    });
  });

  it('rejects wrong lookup projections and does not treat a new key as an existing receipt retry', () => {
    expect(() => transition(head({ signal_id: 'signal-b' }), request())).toThrow(
      'different Signal',
    );
    expect(() => transition(null, request(), receipt({ request_key: 'other-key' }))).toThrow(
      'request_key',
    );
    expect(transition(head(), request({ request_key: 'new-key' }))).toEqual({
      outcome: 'conflict',
      reason: 'stale_revision',
    });
    expect(() => planSignalPublicationTransition({ head: null }, request())).toThrow(TypeError);
    expect(() =>
      planSignalPublicationTransition({ head: null, receipt: null, authorized: true }, request()),
    ).toThrow(TypeError);
  });

  it('is deterministic, does not mutate inputs and needs no clock, UUID or external service', () => {
    const current = head();
    const command = request({
      target_version: 2,
      expected_revision: 1,
      reason_code: 'content_correction',
    });
    const before = JSON.parse(JSON.stringify({ current, command }));
    const result = transition(current, command);
    expect(transition(current, command)).toEqual(result);
    result.head.status = 'withdrawn';
    result.event.reason_code = 'privacy';
    expect({ current, command }).toEqual(before);
    const storedReceipt = receipt();
    const replay = transition(current, request(), storedReceipt);
    replay.receipt.reason_code = 'privacy';
    replay.current_head.status = 'withdrawn';
    expect(storedReceipt).toEqual(receipt());
    expect(current).toEqual(head());
  });
});

describe('revision-aware public projection planning without consumption', () => {
  it('plans upsert for matching current publication and delete for the later same-content withdrawal', () => {
    expect(
      planSignalPublicationProjection({ event: head(), head: head(), consumer_revision: 0 }),
    ).toEqual({
      outcome: 'apply',
      operation: 'upsert',
      signal_id: 'signal-a',
      content_version: 1,
      publication_revision: 1,
      consumer_revision: 1,
    });
    const withdrawn = head({ status: 'withdrawn', publication_revision: 2 });
    expect(
      planSignalPublicationProjection({ event: withdrawn, head: withdrawn, consumer_revision: 1 }),
    ).toEqual({
      outcome: 'apply',
      operation: 'delete',
      signal_id: 'signal-a',
      content_version: 1,
      publication_revision: 2,
      consumer_revision: 2,
    });
  });

  it.each([0, 1, 2])(
    'never lets a late publish revive a withdrawal at consumer revision %s',
    (consumerRevision) => {
      const withdrawn = head({ publication_revision: 2, status: 'withdrawn' });
      expect(
        planSignalPublicationProjection({
          event: head(),
          head: withdrawn,
          consumer_revision: consumerRevision,
        }),
      ).toEqual({ outcome: 'ignore', reason: 'stale_event' });
      expect(
        planSignalPublicationProjection({
          event: head({ content_version: 999 }),
          head: withdrawn,
          consumer_revision: consumerRevision,
        }),
      ).toEqual({ outcome: 'ignore', reason: 'stale_event' });
    },
  );

  it('does not let an old withdrawal delete a newer republication', () => {
    expect(
      planSignalPublicationProjection({
        event: head({ publication_revision: 2, status: 'withdrawn' }),
        head: head({ publication_revision: 3, content_version: 2 }),
        consumer_revision: 3,
      }),
    ).toEqual({ outcome: 'ignore', reason: 'stale_event' });
  });

  it('waits on missing or not-yet-visible head state rather than trusting a publish event', () => {
    expect(
      planSignalPublicationProjection({ event: head(), head: null, consumer_revision: 0 }),
    ).toEqual({ outcome: 'deferred', reason: 'missing_head' });
    expect(
      planSignalPublicationProjection({
        event: head({ publication_revision: 3, content_version: 2 }),
        head: head({ publication_revision: 2, status: 'withdrawn' }),
        consumer_revision: 1,
      }),
    ).toEqual({ outcome: 'deferred', reason: 'event_ahead_of_head' });
  });

  it.each([{ status: 'withdrawn' }, { content_version: 2 }])(
    'conflicts equal-revision event content that disagrees with current head %j',
    (change) => {
      expect(
        planSignalPublicationProjection({
          event: head(change),
          head: head(),
          consumer_revision: 0,
        }),
      ).toEqual({ outcome: 'conflict', reason: 'event_head_mismatch' });
      expect(
        planSignalPublicationProjection({
          event: head(change),
          head: head(),
          consumer_revision: 1,
        }),
      ).toEqual({ outcome: 'conflict', reason: 'event_head_mismatch' });
    },
  );

  it('detects wrong Signal mapping, already-consumed revision and checkpoint ahead of authoritative head', () => {
    expect(
      planSignalPublicationProjection({
        event: head({ signal_id: 'signal-b' }),
        head: head(),
        consumer_revision: 0,
      }),
    ).toEqual({ outcome: 'conflict', reason: 'signal_mismatch' });
    expect(
      planSignalPublicationProjection({ event: head(), head: head(), consumer_revision: 1 }),
    ).toEqual({ outcome: 'ignore', reason: 'already_consumed' });
    expect(
      planSignalPublicationProjection({ event: head(), head: head(), consumer_revision: 2 }),
    ).toEqual({ outcome: 'conflict', reason: 'consumer_ahead_of_head' });
  });

  it.each([-1, null, undefined, '1', 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid consumer revision %j',
    (revision) => {
      expect(() =>
        planSignalPublicationProjection({
          event: head(),
          head: head(),
          consumer_revision: revision,
        }),
      ).toThrow(TypeError);
    },
  );

  it('requires minimal projections, forbids private event payloads and leaves input untouched', () => {
    const state = { event: head(), head: head(), consumer_revision: 0 };
    const before = JSON.parse(JSON.stringify(state));
    expect(planSignalPublicationProjection(state).outcome).toBe('apply');
    expect(state).toEqual(before);
    expect(() => planSignalPublicationProjection({ ...state, authorized: true })).toThrow(
      TypeError,
    );
    expect(() =>
      planSignalPublicationProjection({
        ...state,
        event: { ...head(), summary: 'Private document text' },
      }),
    ).toThrow(TypeError);
    expect(() => planSignalPublicationProjection({ event: head(), head: head() })).toThrow(
      TypeError,
    );
    expect(() => planSignalPublicationProjection({ ...state, event: null })).toThrow(TypeError);
  });
});
