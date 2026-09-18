import { assertGenerationRole } from '../../../packages/database/src/signal-generation-role.mjs';
import { readGenerationDatabaseConfiguration } from './signal-generation-config.ts';

export type GenerationPreflightError =
  | 'configuration_invalid'
  | 'connection_failed'
  | 'tls_unverified'
  | 'identity_mismatch'
  | 'read_only_required'
  | 'permissions_invalid'
  | 'cleanup_failed';

export interface GenerationPreflightResult {
  status: 'ok' | 'unavailable';
  checks: {
    configuration: boolean;
    connection: boolean;
    tls: boolean;
    identity: boolean;
    readOnly: boolean;
    permissions: boolean;
  };
  error?: GenerationPreflightError;
}

export interface GenerationPreflightClient {
  connect(): Promise<void>;
  verifiedTls(): boolean;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/** No generation store, original documents, model calls, or mutation statements. */
export function createGenerationPreflight({
  environment,
  createClient,
}: {
  environment: () => Readonly<Record<string, string | undefined>>;
  createClient: (
    config: ReturnType<typeof readGenerationDatabaseConfiguration>,
  ) => GenerationPreflightClient;
}): () => Promise<GenerationPreflightResult> {
  let inFlight: Promise<GenerationPreflightResult> | undefined;

  async function run(): Promise<GenerationPreflightResult> {
    const checks = {
      configuration: false,
      connection: false,
      tls: false,
      identity: false,
      readOnly: false,
      permissions: false,
    };
    let stage: GenerationPreflightError = 'configuration_invalid';
    let error: GenerationPreflightError | undefined;
    let client: GenerationPreflightClient | undefined;
    let transactionAttempted = false;
    try {
      const config = readGenerationDatabaseConfiguration(environment());
      checks.configuration = true;
      stage = 'connection_failed';
      client = createClient(config);
      await client.connect();
      checks.connection = true;

      stage = 'tls_unverified';
      if (!client.verifiedTls()) throw new Error();
      checks.tls = true;

      stage = 'read_only_required';
      transactionAttempted = true;
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      stage = 'identity_mismatch';
      const identity = (
        await client.query(
          `SELECT current_user = 'hzense_generation_admin'
            AND session_user = current_user AND current_database() = $1::text AS identity,
            current_setting('transaction_read_only') = 'on' AS read_only`,
          [config.database],
        )
      ).rows[0];
      if (identity?.identity !== true) throw new Error();
      checks.identity = true;
      stage = 'read_only_required';
      if (identity.read_only !== true) throw new Error();
      checks.readOnly = true;

      stage = 'permissions_invalid';
      await assertGenerationRole(client);
      // Prove relation/column access without fetching IDs or any private content.
      const empty = await client.query(
        'SELECT id FROM ONLY public.signal_generation_runs WHERE false',
      );
      if (!Array.isArray(empty.rows) || empty.rows.length !== 0) throw new Error();
      checks.permissions = true;
    } catch {
      // Only these fixed codes and booleans may cross the administrator API boundary.
      error = stage;
    } finally {
      if (client) {
        if (transactionAttempted) {
          try {
            await client.query('ROLLBACK');
          } catch {
            error ??= 'cleanup_failed';
          }
        }
        try {
          await client.end();
        } catch {
          error ??= 'cleanup_failed';
        }
      }
    }
    return { status: error ? 'unavailable' : 'ok', checks, ...(error ? { error } : {}) };
  }

  return () => {
    // Bound this server instance to one dedicated connection, including cleanup.
    inFlight ??= run().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
