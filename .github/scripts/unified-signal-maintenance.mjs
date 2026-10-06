import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

const requireGate = (condition, code) => {
  if (!condition) throw new Error(`unified-signal-${code}`);
};
const hash = (text) => createHash('sha256').update(text).digest('hex');

export async function productionDependencies(env) {
  const connection = await import('../../packages/database/src/connection-policy.mjs');
  const preflight = await import('../../packages/database/src/preflight.mjs');
  const migrations = await import('../../packages/database/src/migrate.mjs');
  const unified = await import('../../packages/database/src/unified-signal-preflight.mjs');
  const databaseRequire = createRequire(
    new URL('../../packages/database/package.json', import.meta.url),
  );
  const { Client } = databaseRequire('pg');
  return {
    ...connection,
    ...preflight,
    ...migrations,
    ...unified,
    options: connection.productionDatabaseOptions(env),
    createClient: (options) => new Client(options),
  };
}

export function assertUnifiedMaintenanceManifest(migrations) {
  const pairs = JSON.stringify(migrations.map(({ name, checksum }) => [name, checksum]));
  requireGate(
    migrations.length === 31 &&
      hash(
        JSON.stringify(migrations.slice(0, 30).map(({ name, checksum }) => [name, checksum])),
      ) === 'e9f0a1e69887519a34656f0d8cb78cd627eaabcaf74d344c42519f9b8a8c6c8f' &&
      migrations.at(-1).name === '0030_unified_signal_cutover.sql' &&
      migrations.at(-1).checksum ===
        '04a114a2f38037e60e97be2057e14ce69b07368b53f33cd4e059be0b5bf09469' &&
      migrations.every((row) => hash(row.sql) === row.checksum),
    'reviewed-schema-required',
  );
  return hash(`hzense/unified-signal-preflight-manifest/v1\0${pairs}`);
}

/**
 * Hosted, read-only inventory before implementing/applying the unified cutover.
 * No apply branch, DDL, grants, AI, file output, or publication authorization.
 * The full plan stays in process memory; only explicit aggregate fields leave.
 */
export async function executeUnifiedSignalDryRun(env, request, context, injectedDependencies) {
  requireGate(request.operation === 'unified-signal-dry-run', 'operation-required');
  requireGate(typeof context?.checkFreshness === 'function', 'context-required');
  const deps = injectedDependencies ?? (await productionDependencies(env));
  const options = deps.options;
  const policy = deps.validateConnectionTarget(options);
  const migrations = await deps.loadMigrations();
  await deps.verifyMigrationManifest(migrations);
  const manifestFingerprint = assertUnifiedMaintenanceManifest(migrations);
  const snapshot = async () => {
    await context.checkFreshness();
    const client = deps.createClient({
      connectionString: options.connectionString,
      application_name: 'hzense-unified-signal-dry-run',
      connectionTimeoutMillis: 10_000,
      query_timeout: 45_000,
    });
    let failed = false;
    client.on('error', () => {
      failed = true;
    });
    try {
      await client.connect();
      await client.query("SET statement_timeout='30s'");
      await client.query("SET lock_timeout='5s'");
      await client.query("SET idle_in_transaction_session_timeout='45s'");
      // Shared target/TLS/ledger preflight expects a writable primary, but is
      // itself read-only. Data inspection below uses an explicit READ ONLY tx.
      const current = await deps.inspectDatabasePreflight(client, {
        ...options,
        expectedHost: policy.host,
      });
      requireGate(
        current.database === policy.database &&
          current.user === policy.user &&
          Array.isArray(current.pendingMigrations) &&
          current.pendingMigrations.length === 0,
        'applied-schema-required',
      );
      const { summary } = await deps.inspectUnifiedSignalMigration(client);
      requireGate(!failed, 'connection-failed');
      await context.checkFreshness();
      requireGate(!failed, 'connection-failed');
      return {
        summary,
        targetFingerprint: hash(
          `hzense/unified-signal-preflight-target/v1\0${JSON.stringify([policy.host.toLowerCase(), policy.port, current.database, current.user])}`,
        ),
      };
    } finally {
      // No session, private data or failed connection is reused.
      await client.end().catch(() => undefined);
    }
  };
  const first = await snapshot();
  const second = await snapshot();
  requireGate(JSON.stringify(first) === JSON.stringify(second), 'snapshot-changed');
  const s = second.summary;
  requireGate(s.status === 'preview_only' && s.cutover_ready === false, 'preview-required');
  const count = (value) => {
    requireGate(
      (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) >= 0,
      'inventory-invalid',
    );
    return Number(value);
  };
  return {
    previewOnly: true,
    cutoverReady: false,
    sourceLegacyCount: count(s.source_counts.legacy),
    sourceRevisionCount: count(s.source_counts.editorial_revisions),
    signalCount: count(s.signals),
    versionCount: count(s.versions),
    publicCount: count(s.public_preview),
    draftCount: count(s.lifecycle.draft),
    withdrawnCount: count(s.lifecycle.withdrawn),
    existingSignalCount: count(s.existing_core.signal_count),
    existingVersionCount: count(s.existing_core.version_count),
    sourceFingerprint: s.source_fingerprint,
    planFingerprint: s.plan_hash,
    publicIdFingerprint: s.public_id_fingerprint,
    manifestFingerprint,
    targetFingerprint: second.targetFingerprint,
    pendingMigrations: [],
  };
}
