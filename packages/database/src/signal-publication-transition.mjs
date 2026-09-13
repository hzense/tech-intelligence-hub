import { createHash } from 'node:crypto';

export const signalPublicationMaximumRevision = 2_147_483_647;
export const signalPublicationReasonCodes = Object.freeze({
  publish: Object.freeze(['initial_publication', 'content_correction', 'republication']),
  withdraw: Object.freeze(['factual_error', 'privacy', 'evidence_revoked', 'operator_request']),
});

function strictObject(input, fields, label) {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(input, key))
  )
    throw new TypeError(`${label} must contain exactly: ${fields.join(', ')}`);
  return input;
}
function nonblank(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new TypeError(`${label} must be nonblank text`);
  return value;
}
function integer(value, minimum, label) {
  if (!Number.isInteger(value) || value < minimum || value > signalPublicationMaximumRevision) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} through ${signalPublicationMaximumRevision}`,
    );
  }
  return value;
}
function member(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`${label} is not a supported code`);
  return value;
}
function requestKey(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) ||
    /[^A-Za-z0-9._:-]/.test(value)
  ) {
    throw new TypeError(
      'request_key must be a 1..200 character ASCII token starting with a letter or digit',
    );
  }
  return value;
}

/** Strict JSON-like command. No authorization flag or arbitrary publication payload is accepted. */
export function parseSignalPublicationRequest(input) {
  const row = strictObject(
    input,
    ['request_key', 'signal_id', 'action', 'target_version', 'expected_revision', 'reason_code'],
    'Publication request',
  );
  const action = member(row.action, ['publish', 'withdraw'], 'action');
  return {
    request_key: requestKey(row.request_key),
    signal_id: nonblank(row.signal_id, 'signal_id'),
    action,
    target_version: integer(row.target_version, 1, 'target_version'),
    expected_revision: integer(row.expected_revision, 0, 'expected_revision'),
    reason_code: member(row.reason_code, signalPublicationReasonCodes[action], 'reason_code'),
  };
}

/** SHA-256 of fixed-order UTF-8 JSON; keys, generated event IDs and clocks are not in the payload. */
export function fingerprintSignalPublicationRequest(input) {
  const request = parseSignalPublicationRequest(input);
  return createHash('sha256')
    .update(
      JSON.stringify({
        signal_id: request.signal_id,
        action: request.action,
        target_version: request.target_version,
        expected_revision: request.expected_revision,
        reason_code: request.reason_code,
      }),
      'utf8',
    )
    .digest('hex');
}

/** Minimal row projection only; event_id and occurred_at remain adapter-owned database fields. */
export function parseSignalPublicationHead(input) {
  const row = strictObject(
    input,
    ['signal_id', 'publication_revision', 'content_version', 'status'],
    'Publication head',
  );
  return {
    signal_id: nonblank(row.signal_id, 'signal_id'),
    publication_revision: integer(row.publication_revision, 1, 'publication_revision'),
    content_version: integer(row.content_version, 1, 'content_version'),
    status: member(row.status, ['published', 'withdrawn'], 'status'),
  };
}

/** Validate the permanent outbox receipt's semantic projection, including its canonical fingerprint. */
export function parseSignalPublicationReceipt(input) {
  const row = strictObject(
    input,
    [
      'request_key',
      'request_fingerprint',
      'signal_id',
      'expected_revision',
      'publication_revision',
      'content_version',
      'status',
      'reason_code',
    ],
    'Publication receipt',
  );
  const head = parseSignalPublicationHead({
    signal_id: row.signal_id,
    publication_revision: row.publication_revision,
    content_version: row.content_version,
    status: row.status,
  });
  const request = parseSignalPublicationRequest({
    request_key: row.request_key,
    signal_id: row.signal_id,
    action: row.status === 'published' ? 'publish' : 'withdraw',
    target_version: row.content_version,
    expected_revision: row.expected_revision,
    reason_code: row.reason_code,
  });
  if (head.publication_revision !== request.expected_revision + 1) {
    throw new TypeError('Receipt publication_revision must equal expected_revision + 1');
  }
  if (
    typeof row.request_fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.request_fingerprint) ||
    row.request_fingerprint.length !== 64 ||
    row.request_fingerprint !== fingerprintSignalPublicationRequest(request)
  ) {
    throw new TypeError('Receipt fingerprint does not match its canonical request');
  }
  return {
    request_key: request.request_key,
    request_fingerprint: row.request_fingerprint,
    signal_id: head.signal_id,
    expected_revision: request.expected_revision,
    publication_revision: head.publication_revision,
    content_version: head.content_version,
    status: head.status,
    reason_code: request.reason_code,
  };
}

/**
 * Plan a private state transition, NOT eligibility, review, lease or authorization.
 * The adapter must lock and persist the head plus permanent outbox receipt atomically.
 * Replaying a receipt returns historical applied data, never a request to restore it
 * as the current head. Versions identify content; revisions order publish/withdraw.
 */
export function planSignalPublicationTransition(stateInput, requestInput) {
  const state = strictObject(stateInput, ['head', 'receipt'], 'Publication state');
  const request = parseSignalPublicationRequest(requestInput);
  const head = state.head === null ? null : parseSignalPublicationHead(state.head);
  const receipt = state.receipt === null ? null : parseSignalPublicationReceipt(state.receipt);
  if (head !== null && head.signal_id !== request.signal_id)
    throw new TypeError('Head belongs to a different Signal');
  const fingerprint = fingerprintSignalPublicationRequest(request);

  if (receipt !== null) {
    if (receipt.request_key !== request.request_key)
      throw new TypeError('Receipt lookup does not match request_key');
    if (receipt.request_fingerprint !== fingerprint)
      return { outcome: 'conflict', reason: 'request_key_reused' };
    return {
      outcome: 'replay',
      receipt,
      current_head: head,
      current_head_unchanged: true,
    };
  }
  const currentRevision = head?.publication_revision ?? 0;
  if (request.expected_revision !== currentRevision)
    return { outcome: 'conflict', reason: 'stale_revision' };
  if (currentRevision === signalPublicationMaximumRevision)
    return { outcome: 'rejected', reason: 'revision_exhausted' };

  if (request.action === 'withdraw') {
    if (head === null) return { outcome: 'rejected', reason: 'withdraw_requires_published_head' };
    if (head.status === 'withdrawn') return { outcome: 'rejected', reason: 'already_withdrawn' };
    if (request.target_version !== head.content_version)
      return { outcome: 'rejected', reason: 'withdraw_target_mismatch' };
  } else {
    if (head !== null && request.target_version <= head.content_version)
      return { outcome: 'rejected', reason: 'content_version_not_increasing' };
    const requiredReason =
      head === null
        ? 'initial_publication'
        : head.status === 'published'
          ? 'content_correction'
          : 'republication';
    if (request.reason_code !== requiredReason)
      return { outcome: 'rejected', reason: 'reason_code_mismatch' };
  }
  const nextHead = {
    signal_id: request.signal_id,
    publication_revision: currentRevision + 1,
    content_version: request.target_version,
    status: request.action === 'publish' ? 'published' : 'withdrawn',
  };
  return {
    outcome: 'apply',
    head: nextHead,
    event: {
      request_key: request.request_key,
      request_fingerprint: fingerprint,
      signal_id: nextHead.signal_id,
      expected_revision: request.expected_revision,
      publication_revision: nextHead.publication_revision,
      content_version: nextHead.content_version,
      status: nextHead.status,
      reason_code: request.reason_code,
    },
  };
}

/**
 * Pure revision-aware projection plan. Consumers must separately persist their
 * checkpoint atomically with the projection. This function neither consumes an
 * event nor grants publication, and deliberately accepts no private payload.
 */
export function planSignalPublicationProjection(input) {
  const state = strictObject(input, ['event', 'head', 'consumer_revision'], 'Projection state');
  const event = parseSignalPublicationHead(state.event);
  const head = state.head === null ? null : parseSignalPublicationHead(state.head);
  const consumerRevision = integer(state.consumer_revision, 0, 'consumer_revision');
  if (head === null) return { outcome: 'deferred', reason: 'missing_head' };
  if (head.signal_id !== event.signal_id) return { outcome: 'conflict', reason: 'signal_mismatch' };
  if (consumerRevision > head.publication_revision)
    return { outcome: 'conflict', reason: 'consumer_ahead_of_head' };
  if (event.publication_revision > head.publication_revision)
    return { outcome: 'deferred', reason: 'event_ahead_of_head' };
  if (event.publication_revision < head.publication_revision)
    return { outcome: 'ignore', reason: 'stale_event' };
  if (event.content_version !== head.content_version || event.status !== head.status)
    return { outcome: 'conflict', reason: 'event_head_mismatch' };
  if (consumerRevision === head.publication_revision)
    return { outcome: 'ignore', reason: 'already_consumed' };
  return {
    outcome: 'apply',
    operation: head.status === 'published' ? 'upsert' : 'delete',
    signal_id: head.signal_id,
    content_version: head.content_version,
    publication_revision: head.publication_revision,
    consumer_revision: head.publication_revision,
  };
}
