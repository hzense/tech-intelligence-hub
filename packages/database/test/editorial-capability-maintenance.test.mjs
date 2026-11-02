import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  loadMigrations,
  migrationLockKeys,
  runMigrations,
  verifyMigrationManifest,
} from '../src/migrate.mjs';
import {
  assertEditorialCapabilityManifest,
  editorialCapabilityRoleUpgradeSha256,
  editorialCapabilityRoleUpgradeSql,
  editorialUnchangedAclFingerprint,
  executeEditorialCapabilityMaintenance,
  inspectEditorialCapabilities,
} from '../../../.github/scripts/editorial-capability-maintenance.mjs';
import {
  buildRuntimeAclBaseline,
  inspectRuntimeAclBaseline,
  runtimeAclBackupReference,
  runtimeAclBaselineCategoryNames,
} from '../src/runtime-acl-baseline.mjs';
import {
  assertEditorialRole,
  editorialArchiveReaderColumns,
  editorialResourceRoleColumns,
  editorialRoleColumns,
} from '../src/editorial-signal-role.mjs';

const upgradePath = new URL(
  '../../../db/roles/upgrade_editorial_publication_writer.sql',
  import.meta.url,
);
const readUpgrade = () => readFile(upgradePath, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integration = adminUrl ? describe.sequential : describe.skip;
const currentMigrations = await loadMigrations();
// This completed capability upgrade is bound to the reviewed 0032 artifact.
// Forward migrations must not silently authorize this historical grant operation.
const reviewedMigrations = currentMigrations.filter(({ name }) => name < '0033_');
const loadReviewedMigrations = async () => reviewedMigrations;
const verifyReviewedMigrationManifest = async (migrations) => {
  // Verify the current repository's real checksum file, then the exact historical
  // subset bound by the operation; the current file deliberately includes 0033.
  await verifyMigrationManifest(currentMigrations);
  assertEditorialCapabilityManifest(migrations);
};

describe('bounded editorial writer capability SQL artifact', () => {
  it('leaves transaction control to the maintenance runner and never grants a reader capability', async () => {
    const sql = await readUpgrade();
    expect(sha256(sql)).toBe('14304aa16b84e8f3598eac1bee0e51faefb0865aa834e669715247e30827502e');
    expect(sha256(sql)).toBe(editorialCapabilityRoleUpgradeSha256);
    expect(editorialCapabilityRoleUpgradeSql(sql)).toBe(sql);
    expect(() => editorialCapabilityRoleUpgradeSql(sql + '\n')).toThrow('role-script-mismatch');
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/^\s*(?:BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;/im);
    expect(statements.match(/^DO\s+\$/gim)).toHaveLength(1);
    const grants = statements.match(/^\s*GRANT\b[^;]+;/gm) ?? [];
    expect(grants).toHaveLength(2);
    expect(grants.join('\n')).toMatch(
      /GRANT SELECT\(publication_basis\), INSERT\(publication_basis\) ON public\.editorial_signal_revisions TO hzense_editorial_writer;/,
    );
    expect(grants.join('\n')).toMatch(
      /GRANT SELECT\(snapshot\) ON public\.signal_generation_runs TO hzense_editorial_writer;/,
    );
    expect(grants.join('\n')).not.toMatch(/reader|WITH GRANT OPTION|\bALL\b/);
  });
});

const policy = {
  host: 'fixture.invalid',
  port: '5432',
  database: 'fixture',
  user: 'fixture_owner',
};
const clone = (value) => globalThis.structuredClone(value);
function baseline(state, backupId) {
  const categories = Object.fromEntries(runtimeAclBaselineCategoryNames.map((name) => [name, []]));
  const columns = [
    {
      schema: 'public',
      relation: 'editorial_signal_revisions',
      column: 'publication_basis',
      position: 12,
    },
    { schema: 'public', relation: 'signal_generation_runs', column: 'snapshot', position: 8 },
  ];
  categories.columns = columns.flatMap((column) =>
    state.granted
      ? (column.column === 'publication_basis' ? ['SELECT', 'INSERT'] : ['SELECT']).map(
          (privilege) => ({
            ...column,
            aclState: 'explicit',
            grantee: 'hzense_editorial_writer',
            grantor: policy.user,
            privilege,
            grantable: false,
          }),
        )
      : [
          {
            ...column,
            aclState: 'default',
            grantee: null,
            grantor: null,
            privilege: null,
            grantable: null,
          },
        ],
  );
  categories.relations = [
    {
      schema: 'public',
      relation: 'editorial_public_signals',
      grantee: 'hzense_editorial_reader',
      privilege: 'SELECT',
      grantable: false,
      grantor: policy.user,
      aclState: 'explicit',
    },
  ];
  if (state.extra)
    categories.relations.push({
      schema: 'public',
      relation: 'private_unrelated',
      grantee: 'other_role',
      privilege: 'SELECT',
      grantable: false,
      grantor: policy.user,
      aclState: 'explicit',
    });
  return buildRuntimeAclBaseline({
    identity: {
      database: policy.database,
      databaseOwner: policy.user,
      sessionUser: policy.user,
      currentUser: policy.user,
      serverVersionNumber: 180006,
      transactionReadOnly: true,
      transactionIsolation: 'repeatable read',
    },
    categories,
    capturedAt: '2026-11-01T18:00:00.000Z',
    backupReference: runtimeAclBackupReference(backupId),
  });
}
async function fixture() {
  const sql = await readUpgrade();
  const state = { granted: false, extra: false, roleHash: 'a'.repeat(64) };
  const controls = {
    lock: true,
    failCommit: false,
    failPostConnect: false,
    extraDuringCommit: false,
    emitOnGrant: false,
    emitOnCommit: false,
  };
  const clients = [];
  const env = { MAINTENANCE_BACKUP_ID: 'reviewed-capability-backup-fixture' };
  const context = { checkFreshness: vi.fn(async () => {}), checkApproval: vi.fn(() => {}) };
  const deps = {
    options: {
      connectionString: 'private-owner-connection',
      expectedDatabase: policy.database,
      expectedUser: policy.user,
      expectedPostgresMajor: 18,
    },
    validateConnectionTarget: vi.fn(() => policy),
    assertDirectTopicSyncEndpoint: vi.fn(),
    loadMigrations: vi.fn(loadReviewedMigrations),
    verifyMigrationManifest: vi.fn(verifyReviewedMigrationManifest),
    verifyDatabaseContract: vi.fn(async () => ({ migrationCount: 33, tableCount: 58 })),
    inspectDatabasePreflight: vi.fn(async () => ({
      database: policy.database,
      user: policy.user,
      pendingMigrations: [],
    })),
    inspectRuntimeAclBaseline: vi.fn(async (client) =>
      baseline(client.view(), env.MAINTENANCE_BACKUP_ID),
    ),
    runtimeAclBackupReference,
    buildRuntimeAclBaseline,
    migrationLockKeys,
    readRoleUpgradeSql: vi.fn(async () => sql),
    inspectCapabilities: vi.fn(async (client) => ({
      writerBasisSelect: client.view().granted,
      writerBasisInsert: client.view().granted,
      writerSnapshotSelect: client.view().granted,
      readerBasisSelect: true,
      roleStateFingerprint: client.view().roleHash,
    })),
    createClient: vi.fn(() => {
      let transaction, mode;
      const client = Object.assign(new EventEmitter(), {
        view: () => transaction ?? state,
        connect: vi.fn(async () => {
          if (controls.failPostConnect && state.granted)
            throw new Error('private connection failed');
        }),
        end: vi.fn(async () => {}),
        query: vi.fn(async (query) => {
          if (query.startsWith('BEGIN')) {
            transaction = clone(state);
            mode = undefined;
            return { rows: [] };
          }
          if (query.startsWith('SET LOCAL hzense.editorial_capability_operation=')) {
            mode = query.includes("'grant'") ? 'grant' : 'plan';
            return { rows: [] };
          }
          if (query.startsWith('SET ')) return { rows: [] };
          if (query === 'ROLLBACK') {
            transaction = undefined;
            return { rows: [] };
          }
          if (query === 'COMMIT') {
            if (transaction) Object.assign(state, transaction);
            transaction = undefined;
            if (controls.extraDuringCommit) state.extra = true;
            if (controls.emitOnCommit)
              client.emit(
                'error',
                Object.assign(new Error('private idle failure'), { code: '08006' }),
              );
            if (controls.failCommit)
              throw Object.assign(new Error('private commit response lost'), { code: '08006' });
            return { rows: [] };
          }
          if (query.includes('pg_try_advisory_lock')) return { rows: [{ locked: controls.lock }] };
          if (query.includes('pg_advisory_unlock')) return { rows: [] };
          if (query === sql) {
            expect(transaction).toBeDefined();
            expect(['plan', 'grant']).toContain(mode);
            if (mode === 'grant') {
              transaction.granted = true;
              if (controls.emitOnGrant)
                client.emit(
                  'error',
                  Object.assign(new Error('private idle failure'), { code: '08006' }),
                );
            }
            return { rows: [] };
          }
          throw new Error(`Unexpected fixture query: ${query.slice(0, 80)}`);
        }),
      });
      clients.push(client);
      return client;
    }),
  };
  const execute = (operation, approval) =>
    executeEditorialCapabilityMaintenance(env, { operation, approval }, context, deps);
  const approve = async () => ({
    ...(await execute('editorial-capability-plan')),
    operation: 'editorial-capability-grant',
    roleUpgradeApproved: true,
    publicationFreezeConfirmed: true,
    recoveryPolicy: 'verified',
  });
  const queries = () =>
    clients.flatMap((client) => client.query.mock.calls.map(([query]) => query));
  return { state, controls, clients, env, context, deps, sql, execute, approve, queries };
}

describe('editorial capability maintenance transactions and approval binding', () => {
  it('requires exact 33 migration names, SQL bytes and checksums', async () => {
    const migrations = await loadReviewedMigrations();
    expect(assertEditorialCapabilityManifest(migrations)).toMatch(/^[a-f0-9]{64}$/);
    for (const changed of [
      currentMigrations,
      migrations.slice(1),
      [...migrations].reverse(),
      migrations.map((row, index) => (index === 0 ? { ...row, sql: row.sql + '\n' } : row)),
      migrations.map((row, index) => (index === 0 ? { ...row, checksum: 'f'.repeat(64) } : row)),
    ])
      expect(() => assertEditorialCapabilityManifest(changed)).toThrow('reviewed-schema-required');
  });
  it('normalizes only the three permitted grants, including NULL default ACL placeholders', () => {
    const before = baseline({ granted: false }, 'reviewed-capability-backup-fixture');
    const after = baseline({ granted: true }, 'reviewed-capability-backup-fixture');
    expect(before.fingerprint).not.toBe(after.fingerprint);
    expect(editorialUnchangedAclFingerprint(before, 'a'.repeat(64))).toBe(
      editorialUnchangedAclFingerprint(after, 'a'.repeat(64)),
    );
    expect(editorialUnchangedAclFingerprint(after, 'b'.repeat(64))).not.toBe(
      editorialUnchangedAclFingerprint(before, 'a'.repeat(64)),
    );
    const altered = baseline({ granted: true, extra: true }, 'reviewed-capability-backup-fixture');
    expect(editorialUnchangedAclFingerprint(altered, 'a'.repeat(64))).not.toBe(
      editorialUnchangedAclFingerprint(before, 'a'.repeat(64)),
    );
    after.categories.columns.records[0].grantable = true;
    expect(() => editorialUnchangedAclFingerprint(after, 'a'.repeat(64))).toThrow(
      'acl-evidence-invalid',
    );
  });
  it('plans two independent read-only ACL snapshots without a COMMIT or grant', async () => {
    const f = await fixture();
    const result = await f.execute('editorial-capability-plan');
    expect(result).toMatchObject({
      writerMissingCount: 3,
      writerGrantedCount: 0,
      readerUnchanged: true,
      committed: false,
      previewOnly: true,
      verificationCompleted: false,
      roleUpgradeCompleted: false,
    });
    expect(f.clients).toHaveLength(2);
    expect(f.queries()).not.toContain('COMMIT');
    expect(f.queries()).not.toContain("SET LOCAL hzense.editorial_capability_operation='grant'");
    expect(f.state.granted).toBe(false);
    expect(f.clients.every((c) => c.end.mock.calls.length === 1)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private|fixture_owner|connectionString/);
  });
  it('rejects baseline drift between the two planning snapshots', async () => {
    const f = await fixture();
    f.deps.inspectRuntimeAclBaseline
      .mockImplementationOnce(async (client) =>
        baseline(client.view(), f.env.MAINTENANCE_BACKUP_ID),
      )
      .mockImplementationOnce(async (client) =>
        baseline({ ...client.view(), extra: true }, f.env.MAINTENANCE_BACKUP_ID),
      );
    await expect(f.execute('editorial-capability-plan')).rejects.toMatchObject({
      gate: 'acl-baseline-changed',
      mayHaveCommitted: false,
    });
  });
  it('grants under the migration lock and verifies with a fresh independent read-only connection', async () => {
    const f = await fixture();
    const approval = await f.approve();
    const before = f.clients.length;
    const result = await f.execute('editorial-capability-grant', approval);
    expect(result).toMatchObject({
      committed: true,
      roleUpgradeCompleted: true,
      verificationCompleted: true,
      writerGrantedCount: 3,
      readerUnchanged: true,
    });
    expect(result.verifiedAclFingerprint).toBe(
      baseline(f.state, f.env.MAINTENANCE_BACKUP_ID).fingerprint,
    );
    expect(result.verifiedAclFingerprint).not.toBe(approval.aclFingerprint);
    const [writer, verifier] = f.clients.slice(before);
    expect(writer).not.toBe(verifier);
    expect(writer.query.mock.calls.some(([q]) => q.includes('pg_try_advisory_lock'))).toBe(true);
    expect(writer.query.mock.calls.map(([q]) => q)).toContain('COMMIT');
    expect(verifier.query.mock.calls.map(([q]) => q)).not.toContain('COMMIT');
    expect(verifier.query.mock.calls.map(([q]) => q)).toContain(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(f.state.granted).toBe(true);
    expect(f.state.extra).toBe(false);
  });
  it.each([
    'manifestFingerprint',
    'targetFingerprint',
    'backupIdSha256',
    'roleUpgradeSha256',
    'aclFingerprint',
    'unchangedAclFingerprint',
    'planFingerprint',
    'writerMissingCount',
  ])('refuses changed %s before running the grant', async (field) => {
    const f = await fixture();
    const approval = await f.approve();
    approval[field] = field === 'writerMissingCount' ? 0 : 'f'.repeat(64);
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      mayHaveCommitted: false,
    });
    expect(f.state.granted).toBe(false);
    expect(f.queries()).not.toContain('COMMIT');
    expect(f.queries()).not.toContain("SET LOCAL hzense.editorial_capability_operation='grant'");
  });
  it.each([
    { roleUpgradeApproved: false },
    { publicationFreezeConfirmed: false },
    { recoveryPolicy: 'accept-unverified-fts1' },
  ])('rejects missing explicit grant authority %j', async (change) => {
    const f = await fixture();
    const approval = { ...(await f.approve()), ...change };
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      gate: 'approval-required',
      mayHaveCommitted: false,
    });
    expect(f.state.granted).toBe(false);
  });
  it('stops without grant if the session migration lock is unavailable', async () => {
    const f = await fixture();
    const approval = await f.approve();
    f.controls.lock = false;
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      gate: 'migration-lock-required',
      mayHaveCommitted: false,
    });
    expect(f.state.granted).toBe(false);
  });
  it('rolls back granted capabilities when approval expires before COMMIT', async () => {
    const f = await fixture();
    const approval = await f.approve();
    f.context.checkApproval
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('private expired approval');
      });
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      phase: 'approval-check',
      mayHaveCommitted: false,
    });
    expect(f.queries()).toContain("SET LOCAL hzense.editorial_capability_operation='grant'");
    expect(f.state.granted).toBe(false);
    expect(f.queries()).not.toContain('COMMIT');
  });
  it('marks a lost COMMIT response uncertain and never retries', async () => {
    const f = await fixture();
    const approval = await f.approve();
    f.controls.failCommit = true;
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      phase: 'commit',
      mayHaveCommitted: true,
    });
    expect(f.queries().filter((q) => q === 'COMMIT')).toHaveLength(1);
    expect(f.state.granted).toBe(true);
  });
  it.each([
    ['emitOnGrant', false],
    ['emitOnCommit', true],
  ])('retains the commit boundary for session error %s', async (key, mayHaveCommitted) => {
    const f = await fixture();
    const approval = await f.approve();
    f.controls[key] = true;
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      gate: 'connection-failed',
      phase: 'owner-session',
      mayHaveCommitted,
    });
    expect(f.state.granted).toBe(mayHaveCommitted);
  });
  it('does not call a committed grant successful if the fresh verification connection fails', async () => {
    const f = await fixture();
    const approval = await f.approve();
    f.controls.failPostConnect = true;
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      mayHaveCommitted: true,
    });
    expect(f.state.granted).toBe(true);
  });
  it('reports unrelated ACL drift after COMMIT as needing reconciliation rather than success', async () => {
    const f = await fixture();
    const approval = await f.approve();
    f.controls.extraDuringCommit = true;
    await expect(f.execute('editorial-capability-grant', approval)).rejects.toMatchObject({
      gate: 'unrelated-acl-changed',
      mayHaveCommitted: true,
    });
  });
  it('rejects a changed reviewed role script before any database session', async () => {
    const f = await fixture();
    f.deps.readRoleUpgradeSql.mockResolvedValue(f.sql + '\n');
    await expect(f.execute('editorial-capability-plan')).rejects.toMatchObject({
      gate: 'role-script-mismatch',
    });
    expect(f.clients).toHaveLength(0);
  });
  it('rejects a pending migration before executing the role script', async () => {
    const f = await fixture();
    f.deps.inspectDatabasePreflight.mockResolvedValue({
      ...policy,
      pendingMigrations: ['0033_fixture.sql'],
    });
    await expect(f.execute('editorial-capability-plan')).rejects.toMatchObject({
      gate: 'applied-schema-required',
    });
    expect(f.queries()).not.toContain(f.sql);
  });
  it('rejects forged ACL evidence rather than trusting its reported fingerprint', async () => {
    const f = await fixture();
    f.deps.inspectRuntimeAclBaseline.mockImplementation(async (client) => ({
      ...baseline(client.view(), f.env.MAINTENANCE_BACKUP_ID),
      fingerprint: 'f'.repeat(64),
    }));
    await expect(f.execute('editorial-capability-plan')).rejects.toMatchObject({
      gate: 'acl-evidence-invalid',
      mayHaveCommitted: false,
    });
  });
});

integration('isolated PostgreSQL editorial writer capability transaction', () => {
  const database = `hzense_writer_capability_${process.pid}_${Date.now()}`;
  const roles = ['hzense_editorial_writer', 'hzense_editorial_reader'];
  const createdRoles = [];
  const ambient = [];
  let admin,
    owner,
    writer,
    reader,
    targetUrl,
    migrationDirectory,
    databaseCreated = false;
  const revokeAdded = () =>
    owner.query(
      'REVOKE SELECT(publication_basis),INSERT(publication_basis) ON public.editorial_signal_revisions FROM hzense_editorial_writer; REVOKE SELECT(snapshot) ON public.signal_generation_runs FROM hzense_editorial_writer',
    );
  const capabilities = async () =>
    (
      await owner.query(`SELECT
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','publication_basis','SELECT') AS basis_select,
    has_column_privilege('hzense_editorial_writer','public.editorial_signal_revisions','publication_basis','INSERT') AS basis_insert,
    has_column_privilege('hzense_editorial_writer','public.signal_generation_runs','snapshot','SELECT') AS snapshot_select,
    has_column_privilege('hzense_editorial_reader','public.editorial_public_signals','publication_basis','SELECT') AS reader_basis`)
    ).rows[0];
  async function acl(role) {
    const result = await owner.query(
      `SELECT kind,object,permission FROM (
      SELECT 'relation'::text AS kind,c.oid::text AS object,c.relacl::text AS permission
      FROM pg_class c WHERE EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee=$1::regrole)
      UNION ALL SELECT 'column',a.attrelid::text||':'||a.attnum,a.attacl::text
      FROM pg_attribute a WHERE EXISTS(SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee=$1::regrole)
      UNION ALL SELECT 'database',d.oid::text,d.datacl::text FROM pg_database d
      WHERE EXISTS(SELECT 1 FROM aclexplode(d.datacl) a WHERE a.grantee=$1::regrole)
      UNION ALL SELECT 'schema',n.oid::text,n.nspacl::text FROM pg_namespace n
      WHERE EXISTS(SELECT 1 FROM aclexplode(n.nspacl) a WHERE a.grantee=$1::regrole)
    ) entries ORDER BY kind,object`,
      [role],
    );
    return result.rows;
  }
  async function apply(sql = undefined) {
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL search_path=pg_catalog,pg_temp');
      await owner.query("SET LOCAL hzense.editorial_capability_operation='grant'");
      await owner.query(sql ?? (await readUpgrade()));
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Disposable cluster required');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    if (
      (
        await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [
          [...roles, 'hzense_runtime'],
        ])
      ).rows.length
    )
      throw new Error('Refuse pre-existing application roles');
    if (
      (
        await admin.query(
          "SELECT datname FROM pg_database WHERE datallowconn AND datname NOT IN ('postgres','template1')",
        )
      ).rows.length
    )
      throw new Error('Refuse cluster containing unrelated databases');
    for (const name of ['postgres', 'template1']) {
      const privileges = (
        await admin.query(
          "SELECT a.privilege_type FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=$1 AND a.grantee=0",
          [name],
        )
      ).rows.map((row) => row.privilege_type);
      ambient.push({ name, privileges });
      await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    }
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;
    targetUrl = new URL(adminUrl);
    targetUrl.pathname = `/${database}`;
    migrationDirectory = await mkdtemp(join(tmpdir(), 'hzense-reviewed-capability-'));
    await Promise.all(
      reviewedMigrations.map(({ name, sql }) => writeFile(join(migrationDirectory, name), sql)),
    );
    await runMigrations({ connectionString: targetUrl.toString(), directory: migrationDirectory });
    owner = new pg.Client({ connectionString: targetUrl.toString() });
    await owner.connect();
    await owner.query(
      `REVOKE ALL ON DATABASE "${database}" FROM PUBLIC; REVOKE ALL ON SCHEMA public FROM PUBLIC`,
    );
    await admin.query(
      'CREATE ROLE hzense_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20',
    );
    createdRoles.push('hzense_runtime');
    await admin.query('ALTER ROLE hzense_runtime SET default_transaction_read_only=on');
    await owner.query(
      `GRANT CONNECT ON DATABASE "${database}" TO hzense_runtime; GRANT USAGE ON SCHEMA public TO hzense_runtime`,
    );
    for (const [index, role] of roles.entries()) {
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD 'writer-capability-fixture-only'`,
      );
      createdRoles.push(role);
      await owner.query(
        `GRANT CONNECT ON DATABASE "${database}" TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}`,
      );
      if (index === 0) {
        for (const [table, columns] of Object.entries(editorialRoleColumns.writer))
          await owner.query(
            `GRANT SELECT(${columns.join(',')})${table === 'editorial_signal_revisions' ? ', INSERT(' + columns.join(',') + ')' : ''} ON public.${table} TO ${role}`,
          );
      } else {
        // Production's reader already has table SELECT, including publication_basis.
        await owner.query(`GRANT SELECT ON public.editorial_public_signals TO ${role}`);
      }
    }
    for (const [table, columns] of Object.entries(editorialResourceRoleColumns))
      await owner.query(
        `GRANT SELECT(${columns.join(',')}), INSERT(${columns.join(',')}) ON public.${table} TO hzense_editorial_writer`,
      );
    await owner.query(`GRANT INSERT(unified_content) ON public.editorial_signal_revisions TO hzense_editorial_writer;
      GRANT SELECT(${editorialArchiveReaderColumns.join(',')}) ON public.legacy_public_signals TO hzense_editorial_reader;
      GRANT SELECT(signal_id,version,origin,publication_basis,content,recorded_at) ON public.unified_public_signals TO hzense_editorial_reader;
      GRANT SELECT(ready) ON public.unified_public_status TO hzense_editorial_reader;`);
    targetUrl.username = roles[0];
    targetUrl.password = 'writer-capability-fixture-only';
    writer = new pg.Client({ connectionString: targetUrl.toString() });
    await writer.connect();
    targetUrl.username = roles[1];
    reader = new pg.Client({ connectionString: targetUrl.toString() });
    await reader.connect();
  }, 60000);
  afterAll(async () => {
    await writer?.end();
    await reader?.end();
    await owner?.end();
    if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`);
    for (const role of createdRoles) await admin.query(`DROP ROLE ${role}`);
    for (const { name, privileges } of ambient)
      if (privileges.length)
        await admin.query(`GRANT ${privileges.join(',')} ON DATABASE "${name}" TO PUBLIC`);
    await admin?.end();
    if (migrationDirectory) await rm(migrationDirectory, { recursive: true, force: true });
  });
  it('plans with a read-only transaction and leaves both roles unchanged', async () => {
    const before = [await acl(roles[0]), await acl(roles[1])];
    await owner.query('BEGIN READ ONLY');
    try {
      await owner.query('SET LOCAL search_path=pg_catalog,pg_temp');
      await owner.query("SET LOCAL hzense.editorial_capability_operation='plan'");
      await owner.query(await readUpgrade());
    } finally {
      await owner.query('ROLLBACK');
    }
    expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
    expect(await capabilities()).toEqual({
      basis_select: false,
      basis_insert: false,
      snapshot_select: false,
      reader_basis: true,
    });
  });
  it('adds only three writer capabilities, preserves the reader ACL and verifies a fresh connection', async () => {
    expect(await capabilities()).toEqual({
      basis_select: false,
      basis_insert: false,
      snapshot_select: false,
      reader_basis: true,
    });
    await assertEditorialRole(writer, 'writer');
    await assertEditorialRole(reader, 'reader');
    const readerBefore = await acl(roles[1]);
    await apply();
    expect(await capabilities()).toEqual({
      basis_select: true,
      basis_insert: true,
      snapshot_select: true,
      reader_basis: true,
    });
    expect(await acl(roles[1])).toEqual(readerBefore);
    targetUrl.username = roles[0];
    const fresh = new pg.Client({ connectionString: targetUrl.toString() });
    try {
      await fresh.connect();
      await fresh.query('BEGIN READ ONLY');
      await assertEditorialRole(fresh, 'writer');
      await fresh.query('SELECT publication_basis FROM public.editorial_signal_revisions LIMIT 0');
      await fresh.query('SELECT snapshot FROM public.signal_generation_runs LIMIT 0');
      await fresh.query('ROLLBACK');
    } finally {
      await fresh.end();
    }
    await assertEditorialRole(reader, 'reader');
    await expect(
      reader.query('SELECT snapshot FROM public.signal_generation_runs LIMIT 0'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      writer.query(
        "UPDATE public.editorial_signal_revisions SET publication_basis='automatic_checks'",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('is idempotent without changing either role ACL', async () => {
    const before = [await acl(roles[0]), await acl(roles[1])];
    await apply();
    expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
  });
  it('rolls back the three grants if the caller transaction fails before commit', async () => {
    await revokeAdded();
    const before = [await acl(roles[0]), await acl(roles[1])];
    await owner.query('BEGIN');
    await owner.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await owner.query("SET LOCAL hzense.editorial_capability_operation='grant'");
    await owner.query(await readUpgrade());
    expect((await capabilities()).snapshot_select).toBe(true);
    await expect(owner.query('SELECT 1/0')).rejects.toMatchObject({ code: '22012' });
    await owner.query('ROLLBACK');
    expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
  });
  it.each([1, 2, 3, 4, 5, 6])(
    'rejects partial capability bitset %s without changing the existing ACL',
    async (mask) => {
      await revokeAdded();
      const grants = [
        'GRANT SELECT(publication_basis) ON public.editorial_signal_revisions TO hzense_editorial_writer',
        'GRANT INSERT(publication_basis) ON public.editorial_signal_revisions TO hzense_editorial_writer',
        'GRANT SELECT(snapshot) ON public.signal_generation_runs TO hzense_editorial_writer',
      ];
      for (const [index, grant] of grants.entries())
        if (mask & (1 << index)) await owner.query(grant);
      const before = [await acl(roles[0]), await acl(roles[1])];
      try {
        await expect(apply()).rejects.toThrow(/ACL mismatch/);
        expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
      } finally {
        await revokeAdded();
      }
    },
  );
  it.each([
    ['SELECT(result)', 'signal_generation_runs', 'hzense_editorial_writer'],
    ['INSERT(snapshot)', 'signal_generation_runs', 'hzense_editorial_writer'],
    ['SELECT(snapshot)', 'signal_generation_runs', 'hzense_editorial_reader'],
  ])('rejects unrelated %s on %s for %s and rolls back', async (privilege, table, role) => {
    await owner.query(`GRANT ${privilege} ON public.${table} TO ${role}`);
    const before = [await acl(roles[0]), await acl(roles[1])];
    try {
      await expect(apply()).rejects.toThrow();
      expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
      expect((await capabilities()).snapshot_select).toBe(false);
    } finally {
      await owner.query(`REVOKE ${privilege} ON public.${table} FROM ${role}`);
    }
  });
  it('does not silently upgrade a reader missing its existing publication basis', async () => {
    await owner.query(
      'REVOKE SELECT ON public.editorial_public_signals FROM hzense_editorial_reader',
    );
    await owner.query(
      `GRANT SELECT(${editorialRoleColumns.reader.editorial_public_signals.join(',')}) ON public.editorial_public_signals TO hzense_editorial_reader`,
    );
    const before = [await acl(roles[0]), await acl(roles[1])];
    try {
      expect((await capabilities()).reader_basis).toBe(false);
      await expect(apply()).rejects.toThrow();
      expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
    } finally {
      await owner.query(
        `REVOKE SELECT(${editorialRoleColumns.reader.editorial_public_signals.join(',')}) ON public.editorial_public_signals FROM hzense_editorial_reader`,
      );
      await owner.query(
        'GRANT SELECT ON public.editorial_public_signals TO hzense_editorial_reader',
      );
    }
  });
  it('also preserves a complete column-scoped reader without upgrading its privileges', async () => {
    const columns = [...editorialRoleColumns.reader.editorial_public_signals, 'publication_basis'];
    await owner.query(
      'REVOKE SELECT ON public.editorial_public_signals FROM hzense_editorial_reader',
    );
    await owner.query(
      `GRANT SELECT(${columns.join(',')}) ON public.editorial_public_signals TO hzense_editorial_reader`,
    );
    const before = await acl(roles[1]);
    try {
      await apply();
      expect(await acl(roles[1])).toEqual(before);
      await assertEditorialRole(reader, 'reader');
    } finally {
      await revokeAdded();
      await owner.query(
        `REVOKE SELECT(${columns.join(',')}) ON public.editorial_public_signals FROM hzense_editorial_reader`,
      );
      await owner.query(
        'GRANT SELECT ON public.editorial_public_signals TO hzense_editorial_reader',
      );
    }
  });
  it('rejects an unrelated grant option without repairing it', async () => {
    await owner.query(
      'GRANT SELECT(title) ON public.topics TO hzense_editorial_writer WITH GRANT OPTION',
    );
    const before = await acl(roles[0]);
    try {
      await expect(apply()).rejects.toThrow();
      expect(await acl(roles[0])).toEqual(before);
      expect((await capabilities()).snapshot_select).toBe(false);
    } finally {
      await owner.query(
        'REVOKE GRANT OPTION FOR SELECT(title) ON public.topics FROM hzense_editorial_writer',
      );
    }
  });
  it('rejects unsafe PUBLIC execution on a newly created routine', async () => {
    await owner.query(
      "CREATE FUNCTION public.unsafe_capability_fixture() RETURNS boolean LANGUAGE sql AS 'SELECT true'",
    );
    const before = [await acl(roles[0]), await acl(roles[1])];
    try {
      await expect(apply()).rejects.toThrow();
      expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
    } finally {
      await owner.query('DROP FUNCTION public.unsafe_capability_fixture()');
    }
  });
  it.each([
    ['missing mode', false, undefined, 'pg_catalog,pg_temp'],
    ['unknown mode', false, 'other', 'pg_catalog,pg_temp'],
    ['writable plan', false, 'plan', 'pg_catalog,pg_temp'],
    ['read-only grant', true, 'grant', 'pg_catalog,pg_temp'],
    ['unsafe search path', false, 'grant', 'public'],
  ])('rejects %s before capability changes', async (_label, readOnly, mode, searchPath) => {
    const before = [await acl(roles[0]), await acl(roles[1])];
    await owner.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    try {
      await owner.query(`SET LOCAL search_path=${searchPath}`);
      if (mode) await owner.query(`SET LOCAL hzense.editorial_capability_operation='${mode}'`);
      await expect(owner.query(await readUpgrade())).rejects.toThrow();
    } finally {
      await owner.query('ROLLBACK');
    }
    expect([await acl(roles[0]), await acl(roles[1])]).toEqual(before);
  });
  it('executes real plan, grant and independent verification against PostgreSQL catalog evidence', async () => {
    await revokeAdded();
    const readerBefore = await acl(roles[1]);
    const connection = new URL(adminUrl);
    connection.pathname = `/${database}`;
    const localPolicy = {
      host: connection.hostname,
      port: connection.port,
      database,
      user: decodeURIComponent(connection.username),
    };
    const baselineCaptures = [];
    const clients = [];
    const localDeps = {
      options: {
        connectionString: connection.toString(),
        expectedHost: localPolicy.host,
        expectedPort: localPolicy.port,
        expectedDatabase: database,
        expectedUser: localPolicy.user,
        expectedPostgresMajor: 18,
      },
      // Only production transport/owner contract adapters are replaced. The complete
      // fixture migrations, role SQL, ACL capture, fingerprints and sessions are real.
      validateConnectionTarget: () => localPolicy,
      assertDirectTopicSyncEndpoint: () => {},
      verifyDatabaseContract: async () => ({ migrationCount: 33, tableCount: 58 }),
      inspectDatabasePreflight: async (client) => {
        const actual = (
          await client.query('SELECT current_database() AS database,current_user AS "user"')
        ).rows[0];
        return { ...actual, pendingMigrations: [] };
      },
      loadMigrations: loadReviewedMigrations,
      verifyMigrationManifest: verifyReviewedMigrationManifest,
      migrationLockKeys,
      buildRuntimeAclBaseline,
      runtimeAclBackupReference,
      inspectRuntimeAclBaseline: async (client, options) => {
        const captured = await inspectRuntimeAclBaseline(client, options);
        baselineCaptures.push(captured);
        return captured;
      },
      inspectCapabilities: inspectEditorialCapabilities,
      readRoleUpgradeSql: readUpgrade,
      createClient: (options) => {
        const client = new pg.Client(options);
        clients.push(client);
        return client;
      },
    };
    const localEnv = { MAINTENANCE_BACKUP_ID: 'local-editorial-capability-fixture-backup' };
    const context = { checkFreshness: async () => {}, checkApproval: () => {} };
    const plan = await executeEditorialCapabilityMaintenance(
      localEnv,
      { operation: 'editorial-capability-plan' },
      context,
      localDeps,
    );
    expect(plan).toMatchObject({
      writerMissingCount: 3,
      writerGrantedCount: 0,
      committed: false,
      readerUnchanged: true,
    });
    expect(clients).toHaveLength(2);
    expect(baselineCaptures[0].fingerprint).toBe(baselineCaptures[1].fingerprint);
    expect((await capabilities()).snapshot_select).toBe(false);
    const approval = {
      ...plan,
      operation: 'editorial-capability-grant',
      roleUpgradeApproved: true,
      publicationFreezeConfirmed: true,
      recoveryPolicy: 'verified',
    };
    const granted = await executeEditorialCapabilityMaintenance(
      localEnv,
      { operation: 'editorial-capability-grant', approval },
      context,
      localDeps,
    );
    expect(clients).toHaveLength(4);
    expect(new Set(clients).size).toBe(4);
    expect(granted).toMatchObject({
      committed: true,
      writerGrantedCount: 3,
      readerUnchanged: true,
      roleUpgradeCompleted: true,
      verificationCompleted: true,
    });
    expect(granted.verifiedAclFingerprint).toBe(baselineCaptures.at(-1).fingerprint);
    expect(granted.verifiedAclFingerprint).not.toBe(plan.aclFingerprint);
    expect(await capabilities()).toEqual({
      basis_select: true,
      basis_insert: true,
      snapshot_select: true,
      reader_basis: true,
    });
    expect(await acl(roles[1])).toEqual(readerBefore);
    await assertEditorialRole(writer, 'writer');
    await assertEditorialRole(reader, 'reader');
    expect(baselineCaptures).toHaveLength(4);
    expect(baselineCaptures.every((row) => row.identity.transactionReadOnly === true)).toBe(true);
  });
});
