export const controlMaximumFence = 2_147_483_647;

const errorCodes = new Set([
  'invalid_control_request',
  'invalid_control_state',
  'publication_disabled',
  'task_disabled',
  'policy_disallows_publication',
  'intent_disallows_publication',
  'authorization_revoked',
  'run_not_running',
  'lease_owner_mismatch',
  'stale_fencing_token',
  'lease_expired',
  'run_mismatch',
  'run_not_found',
  'task_not_found',
  'authorization_not_found',
  'control_not_found',
  'run_identity_conflict',
  'run_terminal',
  'lease_active',
  'task_lease_active',
  'fencing_exhausted',
  'lease_not_extended',
  'transaction_required',
  'unsupported_isolation',
  'run_changed',
]);

/** Fixed, payload-free failures; unknown error values never reach messages or codes. */
export class PublicationControlError extends Error {
  constructor(code) {
    const safeCode = errorCodes.has(code) ? code : 'invalid_control_state';
    super(safeCode);
    this.name = 'PublicationControlError';
    this.code = safeCode;
  }
}

const policies = ['auto_publish', 'review_required', 'preview_only'];
const statuses = ['pending', 'running', 'cancelled', 'completed'];
const requestFields = Object.freeze({
  create: ['run_id', 'task_id', 'principal_id', 'original_intent'],
  claim: ['run_id', 'lease_owner', 'lease_seconds'],
  renew: ['run_id', 'lease_owner', 'fencing_token', 'lease_seconds'],
  cancel: ['run_id'],
  complete: ['run_id', 'lease_owner', 'fencing_token'],
  gate: ['run_id', 'lease_owner', 'fencing_token'],
});

function reject(code) {
  throw new PublicationControlError(code);
}

function strictObject(input, fields, code) {
  try {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      reject(code);
    }
    const keys = Reflect.ownKeys(input);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== 'string' || !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(input, key))
    ) {
      reject(code);
    }
    // Do not execute getters while parsing a caller command or adapter projection.
    const result = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(code);
      result[field] = descriptor.value;
    }
    return result;
  } catch {
    // A revoked Proxy or reflection trap must not leak caller-controlled errors.
    reject(code);
  }
}

function uuid(value, code) {
  if (
    typeof value !== 'string' ||
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) {
    reject(code);
  }
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function member(value, values, code) {
  if (!values.includes(value)) reject(code);
  return value;
}

function boolean(value, code) {
  if (typeof value !== 'boolean') reject(code);
  return value;
}

function date(value, code) {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Date.prototype ||
      Reflect.ownKeys(value).length !== 0
    ) {
      reject(code);
    }
    const time = Date.prototype.getTime.call(value);
    const year = Date.prototype.getUTCFullYear.call(value);
    if (!Number.isFinite(time) || year < 1 || year > 9999) reject(code);
    return new Date(time);
  } catch {
    reject(code);
  }
}

/**
 * Parse only an operation's exact command. IDs are opaque identifiers, not
 * authenticated claims. No permission flags, payloads or caller clock are accepted.
 */
export function parsePublicationControlRequest(input, operation) {
  const code = 'invalid_control_request';
  if (typeof operation !== 'string' || !Object.hasOwn(requestFields, operation)) reject(code);
  const row = strictObject(input, requestFields[operation], code);
  const parsed = { run_id: uuid(row.run_id, code) };
  if (operation === 'create') {
    parsed.task_id = uuid(row.task_id, code);
    parsed.principal_id = uuid(row.principal_id, code);
    parsed.original_intent = member(row.original_intent, policies, code);
  } else if (operation !== 'cancel') {
    parsed.lease_owner = uuid(row.lease_owner, code);
    if (operation !== 'claim') {
      parsed.fencing_token = integer(row.fencing_token, 1, controlMaximumFence, code);
    }
    if (operation === 'claim' || operation === 'renew') {
      parsed.lease_seconds = integer(row.lease_seconds, 1, 900, code);
    }
  }
  return parsed;
}

/**
 * Validate an adapter-owned, locked database snapshot. This pure parser cannot
 * authenticate that provenance. `now` must come from the same transaction's
 * database clock, never a command or application clock.
 */
export function parsePublicationControlContext(input) {
  const code = 'invalid_control_state';
  const row = strictObject(input, ['control', 'task', 'authorization', 'run', 'now'], code);
  const control = strictObject(row.control, ['publication_enabled'], code);
  control.publication_enabled = boolean(control.publication_enabled, code);
  const task = strictObject(row.task, ['task_id', 'policy', 'publication_enabled'], code);
  task.task_id = uuid(task.task_id, code);
  task.policy = member(task.policy, policies, code);
  task.publication_enabled = boolean(task.publication_enabled, code);
  const authorization = strictObject(
    row.authorization,
    ['task_id', 'principal_id', 'can_publish'],
    code,
  );
  authorization.task_id = uuid(authorization.task_id, code);
  authorization.principal_id = uuid(authorization.principal_id, code);
  authorization.can_publish = boolean(authorization.can_publish, code);
  const run = strictObject(
    row.run,
    [
      'run_id',
      'task_id',
      'principal_id',
      'original_intent',
      'status',
      'fencing_token',
      'lease_owner',
      'lease_expires_at',
      'created_at',
    ],
    code,
  );
  run.run_id = uuid(run.run_id, code);
  run.task_id = uuid(run.task_id, code);
  run.principal_id = uuid(run.principal_id, code);
  run.original_intent = member(run.original_intent, policies, code);
  run.status = member(run.status, statuses, code);
  run.fencing_token = integer(run.fencing_token, 0, controlMaximumFence, code);
  run.created_at = date(run.created_at, code);
  if (run.status === 'running') {
    integer(run.fencing_token, 1, controlMaximumFence, code);
    run.lease_owner = uuid(run.lease_owner, code);
    run.lease_expires_at = date(run.lease_expires_at, code);
  } else {
    if (run.lease_owner !== null || run.lease_expires_at !== null) reject(code);
    if (run.status === 'pending' && run.fencing_token !== 0) reject(code);
    if (run.status === 'completed' && run.fencing_token === 0) reject(code);
  }
  if (
    task.task_id !== run.task_id ||
    authorization.task_id !== run.task_id ||
    authorization.principal_id !== run.principal_id
  ) {
    reject(code);
  }
  return { control, task, authorization, run, now: date(row.now, code) };
}

/**
 * Check the current policy snapshot. Passing returns no authorization token and
 * does not qualify evidence or perform publication. A private adapter must lock
 * and re-read this state within the mutation transaction.
 */
export function assertPublicationPolicy(context) {
  const { control, task, authorization, run } = parsePublicationControlContext(context);
  if (!control.publication_enabled) reject('publication_disabled');
  if (!task.publication_enabled) reject('task_disabled');
  if (task.policy !== 'auto_publish') reject('policy_disallows_publication');
  if (run.original_intent !== 'auto_publish') reject('intent_disallows_publication');
  if (!authorization.can_publish) reject('authorization_revoked');
}

/** Check a live lease against a locked database snapshot, without reading a local clock. */
export function assertPublicationLease(context, request) {
  const { run, now } = parsePublicationControlContext(context);
  let operation;
  try {
    operation =
      request !== null && typeof request === 'object' && Object.hasOwn(request, 'lease_seconds')
        ? 'renew'
        : 'gate';
  } catch {
    reject('invalid_control_request');
  }
  const command = parsePublicationControlRequest(request, operation);
  if (command.run_id !== run.run_id) reject('run_mismatch');
  if (run.status !== 'running') reject('run_not_running');
  if (command.lease_owner !== run.lease_owner) reject('lease_owner_mismatch');
  if (command.fencing_token !== run.fencing_token) reject('stale_fencing_token');
  if (run.lease_expires_at.getTime() <= now.getTime()) reject('lease_expired');
}
