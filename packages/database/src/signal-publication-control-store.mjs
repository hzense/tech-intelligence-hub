import {
  PublicationControlError,
  assertPublicationLease,
  assertPublicationPolicy,
  controlMaximumFence,
  parsePublicationControlContext,
  parsePublicationControlRequest,
} from './signal-publication-control.mjs';

// PRIVATE control-plane primitives, not a Publisher or an authentication API.
// Principal IDs are durable references to be bound by a future trusted identity
// service, not caller-supplied proof of identity. No route, CLI, package-root
// export, Worker or new database grant exposes this module.
const runColumns = `run_id, task_id, principal_id, original_intent, status,
  fencing_token, lease_owner, lease_expires_at, created_at`;

function deny(code) {
  throw new PublicationControlError(code);
}

function one(result, code) {
  if (result.rows.length !== 1) deny(code);
  return result.rows[0];
}

async function transaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A dedicated connection pool is required');
  }
  const client = await pool.connect();
  let started = false;
  let discard;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    started = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    // operation is a module-owned closure, never a caller-provided callback.
    const result = await operation(client);
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    discard = error;
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Keep the original error and destroy the possibly open connection.
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function lockParents(client, route, claiming = false, locking = true) {
  // FOR SHARE (not KEY SHARE) conflicts with non-key safety-switch updates.
  // All future multi-row configuration mutations must use this same order.
  const control = one(
    await client.query(`SELECT publication_enabled FROM public.signal_publication_control
      WHERE singleton = true${locking ? ' FOR SHARE' : ''}`),
    'control_not_found',
  );
  const task = one(
    await client.query(
      `SELECT task_id, policy, publication_enabled
      FROM public.signal_publication_tasks WHERE task_id = $1 ${locking ? (claiming ? 'FOR UPDATE' : 'FOR SHARE') : ''}`,
      [route.task_id],
    ),
    'task_not_found',
  );
  const authorization = one(
    await client.query(
      `SELECT task_id, principal_id, can_publish
      FROM public.signal_publication_authorizations
      WHERE task_id = $1 AND principal_id = $2${locking ? ' FOR SHARE' : ''}`,
      [route.task_id, route.principal_id],
    ),
    'authorization_not_found',
  );
  return { control, task, authorization };
}

async function lockContext(client, runId, claiming = false, locking = true) {
  // This routing read intentionally does not lock the run ahead of its parents.
  // The ALWAYS run guard makes both routing fields immutable and forbids DELETE.
  const route = one(
    await client.query(
      `SELECT task_id, principal_id
    FROM public.signal_publication_runs WHERE run_id = $1`,
      [runId],
    ),
    'run_not_found',
  );
  const parents = await lockParents(client, route, claiming, locking);
  const run = one(
    await client.query(
      `SELECT ${runColumns}
    FROM public.signal_publication_runs WHERE run_id = $1${locking ? ' FOR UPDATE' : ''}`,
      [runId],
    ),
    'run_not_found',
  );
  // Read the real database clock AFTER every lock wait, not transaction_timestamp
  // or an application clock captured before a competing cancellation/reclaim.
  const { now } = one(
    await client.query('SELECT pg_catalog.clock_timestamp() AS now'),
    'invalid_control_state',
  );
  return parsePublicationControlContext({ ...parents, run, now });
}

/** Create an immutable original intent; a replay never resurrects its old run. */
export async function createPrivatePublicationRun({ pool, request }) {
  const command = parsePublicationControlRequest(request, 'create');
  return transaction(pool, async (client) => {
    await client.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('hzense:publication-run:' || $1::text, 0))`,
      [command.run_id],
    );
    const existing = (
      await client.query(
        `SELECT ${runColumns}
      FROM public.signal_publication_runs WHERE run_id = $1`,
        [command.run_id],
      )
    ).rows[0];
    if (existing && Object.entries(command).some(([key, value]) => existing[key] !== value))
      deny('run_identity_conflict');
    await lockParents(client, command);
    const inserted = await client.query(
      `INSERT INTO public.signal_publication_runs
      (run_id, task_id, principal_id, original_intent) VALUES ($1,$2,$3,$4)
      ON CONFLICT (run_id) DO NOTHING RETURNING ${runColumns}`,
      [command.run_id, command.task_id, command.principal_id, command.original_intent],
    );
    const run =
      inserted.rows[0] ??
      one(
        await client.query(
          `SELECT ${runColumns}
      FROM public.signal_publication_runs WHERE run_id = $1 FOR UPDATE`,
          [command.run_id],
        ),
        'run_not_found',
      );
    if (Object.entries(command).some(([key, value]) => run[key] !== value))
      deny('run_identity_conflict');
    return { outcome: inserted.rows.length === 1 ? 'created' : 'replayed', run };
  });
}

/** A claim is not publication. An expired attempt always gets a higher token. */
export async function claimPrivatePublicationRun({ pool, request }) {
  const command = parsePublicationControlRequest(request, 'claim');
  return transaction(pool, async (client) => {
    const context = await lockContext(client, command.run_id, true);
    assertPublicationPolicy(context);
    const { run, now } = context;
    if (['cancelled', 'completed'].includes(run.status)) deny('run_terminal');
    if (run.status === 'running' && run.lease_expires_at > now) deny('lease_active');
    if (run.fencing_token === controlMaximumFence) deny('fencing_exhausted');
    // Task-row serialization prevents two different runs of one task from
    // claiming simultaneously. Expired leases are not live work; their stale
    // tokens still cannot pass the gate. Pausing scheduling is a separate API.
    const active = await client.query(
      `SELECT run_id FROM public.signal_publication_runs
      WHERE task_id = $1 AND run_id <> $2 AND status = 'running'
        AND lease_expires_at > $3 LIMIT 1`,
      [run.task_id, run.run_id, now],
    );
    if (active.rows.length !== 0) deny('task_lease_active');
    const changed = one(
      await client.query(
        `UPDATE public.signal_publication_runs
      SET status = 'running', fencing_token = fencing_token + 1,
          lease_owner = $2, lease_expires_at = $3
      WHERE run_id = $1 AND fencing_token = $4 RETURNING ${runColumns}`,
        [
          command.run_id,
          command.lease_owner,
          new Date(now.getTime() + command.lease_seconds * 1000),
          run.fencing_token,
        ],
      ),
      'run_changed',
    );
    return { outcome: 'claimed', run: changed };
  });
}

export async function renewPrivatePublicationRun({ pool, request }) {
  const command = parsePublicationControlRequest(request, 'renew');
  return transaction(pool, async (client) => {
    const context = await lockContext(client, command.run_id);
    assertPublicationPolicy(context);
    assertPublicationLease(context, command);
    const expiry = new Date(context.now.getTime() + command.lease_seconds * 1000);
    if (expiry <= context.run.lease_expires_at) deny('lease_not_extended');
    const changed = one(
      await client.query(
        `UPDATE public.signal_publication_runs
      SET lease_expires_at = $4 WHERE run_id = $1 AND lease_owner = $2
        AND fencing_token = $3 RETURNING ${runColumns}`,
        [command.run_id, command.lease_owner, command.fencing_token, expiry],
      ),
      'run_changed',
    );
    return { outcome: 'renewed', run: changed };
  });
}

/** Private operator primitive: cancellation does not depend on publication being enabled. */
export async function cancelPrivatePublicationRun({ pool, request }) {
  const command = parsePublicationControlRequest(request, 'cancel');
  return transaction(pool, async (client) => {
    // Cancellation takes only the run lock and requests no parent locks after
    // it, so it cannot invert the publication lock order. Missing/broken global
    // configuration must not prevent stopping an already-created run.
    const run = one(
      await client.query(
        `SELECT ${runColumns}
      FROM public.signal_publication_runs WHERE run_id = $1 FOR UPDATE`,
        [command.run_id],
      ),
      'run_not_found',
    );
    if (run.status === 'cancelled') return { outcome: 'replayed', run };
    if (run.status === 'completed') deny('run_terminal');
    if (!['pending', 'running'].includes(run.status)) deny('invalid_control_state');
    const changed = one(
      await client.query(
        `UPDATE public.signal_publication_runs
      SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL
      WHERE run_id = $1 RETURNING ${runColumns}`,
        [command.run_id],
      ),
      'run_changed',
    );
    return { outcome: 'cancelled', run: changed };
  });
}

/** Close an active run, even after a switch is disabled. This never publishes/withdraws a Signal. */
export async function completePrivatePublicationRun({ pool, request }) {
  const command = parsePublicationControlRequest(request, 'complete');
  return transaction(pool, async (client) => {
    const context = await lockContext(client, command.run_id);
    assertPublicationLease(context, command);
    const changed = one(
      await client.query(
        `UPDATE public.signal_publication_runs
      SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL
      WHERE run_id = $1 AND lease_owner = $2 AND fencing_token = $3 RETURNING ${runColumns}`,
        [command.run_id, command.lease_owner, command.fencing_token],
      ),
      'run_changed',
    );
    return { outcome: 'completed', run: changed };
  });
}

/**
 * Lock + check ONLY the persisted control-plane prerequisites in an existing
 * explicit READ COMMITTED transaction. Never commit here or return a reusable
 * authorization ticket. SAVEPOINT deliberately fails in autocommit mode.
 *
 * A future Publisher must also lock/recheck current evidence and identities,
 * assemble the version and write state/Outbox in this SAME transaction. Check
 * the lease again after any subsequent waits, immediately before the write.
 * Do not call this, commit, and then invoke recordPrivateSignalPublicationTransition.
 * No model/network work, arbitrary callbacks or user-controlled SQL belongs here.
 */
async function publicationControls({ client, request }, restricted) {
  const command = parsePublicationControlRequest(request, 'gate');
  if (!client || typeof client.query !== 'function')
    throw new TypeError('A transaction client is required');
  try {
    await client.query('SAVEPOINT hzense_publication_controls');
  } catch (error) {
    if (error.code === '25P01') deny('transaction_required');
    throw error;
  }
  try {
    const settings = one(
      await client.query(`SELECT pg_catalog.current_setting('transaction_isolation') AS isolation`),
      'invalid_control_state',
    );
    if (settings.isolation !== 'read committed') deny('unsupported_isolation');
    if (restricted) {
      await client.query('SELECT public.hzense_lock_publication_controls($1)', [command.run_id]);
    }
    const context = await lockContext(client, command.run_id, false, !restricted);
    assertPublicationPolicy(context);
    assertPublicationLease(context, command);
    await client.query('RELEASE SAVEPOINT hzense_publication_controls');
    // Locks remain until the enclosing transaction ends. This value is only a
    // diagnostic projection, and is invalid outside that transaction or once
    // the lease expires. In particular it says nothing about content eligibility.
    return Object.freeze({
      scope: 'private_control_only',
      run_id: context.run.run_id,
      task_id: context.run.task_id,
      principal_id: context.run.principal_id,
      fencing_token: context.run.fencing_token,
      lease_expires_at: context.run.lease_expires_at,
    });
  } catch (error) {
    // The caller owns the outer transaction and must roll it back on failure.
    // Keep the original error; never convert a failed guard into a success flag.
    try {
      await client.query('ROLLBACK TO SAVEPOINT hzense_publication_controls');
      await client.query('RELEASE SAVEPOINT hzense_publication_controls');
    } catch {
      // Caller must discard this connection if rollback fails.
    }
    throw error;
  }
}

export async function lockPrivatePublicationControls(input) {
  return publicationControls(input, false);
}

// Internal restricted service variant; callers cannot inject lock SQL or hooks.
export async function lockPublicPublicationControls(input) {
  return publicationControls(input, true);
}
