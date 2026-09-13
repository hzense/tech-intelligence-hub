import { randomUUID } from 'node:crypto';
import {
  parseSignalPublicationRequest,
  planSignalPublicationTransition,
} from './signal-publication-transition.mjs';

// INTERNAL, PRIVATE persistence primitive, not a publisher or an authorization
// boundary. No CLI, application route, package-root export or production role
// is wired to this function. Before any such wiring, a separate reviewed change
// must integrate durable policy/intent/authorization/lease/fencing and current
// evidence qualification in the SAME transaction. Calling a planner is not
// permission to publish. Existing Runtime and Signal writer cannot use these
// tables. No model/network calls or arbitrary callbacks belong in this TX.
//
// Own a freshly borrowed connection and the entire transaction. Do not pass a
// Client already inside a caller-owned transaction through a pool-shaped shim.
export async function recordPrivateSignalPublicationTransition({ pool, request }) {
  const command = parseSignalPublicationRequest(request);
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A dedicated connection pool is required');
  }
  const client = await pool.connect();
  let transactionStarted = false;
  let discardConnection;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    transactionStarted = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");

    // Global request-key serialization prevents a cross-Signal key collision
    // from turning into an unclassified unique violation. Hash collisions only
    // serialize unrelated requests. Both locks last until commit/rollback.
    await client.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('hzense:signal-publication:' || $1::text, 0))`,
      [command.request_key],
    );
    // The stable parent also serializes the first publication when no head yet
    // exists. READ COMMITTED then reads the winner's freshly committed head.
    const signal = await client.query('SELECT id FROM public.signals WHERE id = $1 FOR UPDATE', [
      command.signal_id,
    ]);
    if (signal.rows.length !== 1) {
      throw new Error('Publication transition references a missing Signal');
    }
    const heads = await client.query(
      `SELECT signal_id, publication_revision, content_version, status
         FROM public.signal_publication_state WHERE signal_id = $1 FOR UPDATE`,
      [command.signal_id],
    );
    const receipts = await client.query(
      `SELECT request_key, request_fingerprint, signal_id, expected_revision,
              publication_revision, content_version, status, reason_code
         FROM public.signal_publication_outbox WHERE request_key = $1`,
      [command.request_key],
    );
    const plan = planSignalPublicationTransition(
      { head: heads.rows[0] ?? null, receipt: receipts.rows[0] ?? null },
      command,
    );
    if (plan.outcome === 'apply') {
      const event = plan.event;
      const inserted = await client.query(
        `INSERT INTO public.signal_publication_outbox
          (event_id, request_key, request_fingerprint, signal_id, expected_revision,
           publication_revision, content_version, status, reason_code, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
           pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()))
         RETURNING event_id, occurred_at`,
        [
          randomUUID(),
          event.request_key,
          event.request_fingerprint,
          event.signal_id,
          event.expected_revision,
          event.publication_revision,
          event.content_version,
          event.status,
          event.reason_code,
        ],
      );
      const row = inserted.rows[0];
      const changed = await client.query(
        `INSERT INTO public.signal_publication_state
          (signal_id, publication_revision, content_version, status, event_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (signal_id) DO UPDATE SET
           publication_revision = EXCLUDED.publication_revision,
           content_version = EXCLUDED.content_version,
           status = EXCLUDED.status,
           event_id = EXCLUDED.event_id,
           occurred_at = EXCLUDED.occurred_at
         WHERE public.signal_publication_state.publication_revision = $7`,
        [
          event.signal_id,
          event.publication_revision,
          event.content_version,
          event.status,
          row.event_id,
          row.occurred_at,
          command.expected_revision,
        ],
      );
      if (changed.rowCount !== 1) {
        throw new Error('Publication head changed outside the serialized transition');
      }
    }
    // The deferred pair guard is also checked here. A successful INSERT is not
    // success until COMMIT succeeds. On ambiguous commit failure, callers must
    // retry the SAME request key/payload, never generate another key blindly.
    await client.query('COMMIT');
    transactionStarted = false;
    return plan;
  } catch (error) {
    discardConnection = error;
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Destroy the borrowed connection; never mask the original failure or
        // return a possibly open transaction to the pool.
      }
    }
    throw error;
  } finally {
    client.release(discardConnection);
  }
}
