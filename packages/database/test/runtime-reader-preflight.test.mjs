import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { expectedTableNames } from '../src/verify.mjs';
import {
  inspectRuntimeReaderPreflight,
  isApprovedNeonReservedDatabaseException,
  runRuntimeReaderPreflight,
  runtimeReaderPreflightFailureMessage,
  runtimeReaderProductionOptions,
  runtimeReaderTopicColumns,
} from '../src/runtime-reader-preflight.mjs';

const expected = {
  expectedDatabase: 'hzense',
  expectedUser: 'hzense_runtime',
  expectedPostgresMajor: 18,
  expectedConnectionLimit: 20,
  profile: 'local-test',
};

function neonReservedDatabaseRow(name = 'postgres') {
  const postgres = name === 'postgres';
  return {
    name,
    owner: 'cloud_admin',
    is_template: !postgres,
    allows_connections: true,
    connection_limit: -1,
    acl_is_default: postgres,
    connect_allowed: true,
    connect_grantable: false,
    create_allowed: false,
    create_grantable: false,
    temporary_allowed: postgres,
    temporary_grantable: false,
    public_connect: true,
    public_connect_grantable: false,
    public_create: false,
    public_temporary: postgres,
    direct_runtime_acl: false,
  };
}

function expectedColumnRows() {
  return runtimeReaderTopicColumns.map((columnName) => ({
    schema_name: 'public',
    table_name: 'topics',
    column_name: columnName,
    privilege: 'SELECT',
    granted: true,
    grantable: false,
  }));
}

function preflightClient({
  identity = {},
  membershipCount = 0,
  otherDatabasePrivileges = [],
  enumTypePrivileges = [
    {
      schema_name: 'public',
      name: 'topic_status',
      usage: true,
      usage_grantable: false,
    },
  ],
  extraSchemaPrivileges = [],
  extraRelations = [],
  inheritanceEdges = [],
  rewriteRuleCount = 0,
  physicalTopicColumns = ['id', 'title', 'parent_id', 'status', 'metadata', 'runtime_enabled'],
  tablePrivilegeRows = [],
  columnPrivilegeRows = expectedColumnRows(),
  ownedObjects = [],
  unsafeRoutines = [],
  directRoutineGrants = [],
  sequencePrivileges = [],
  defaultPrivileges = [],
} = {}) {
  const query = vi.fn(async (sql) => {
    if (sql.includes('FROM pg_roles AS role_info') && sql.includes('role_default_read_only')) {
      return {
        rowCount: 1,
        rows: [
          {
            database_name: 'hzense',
            authenticated_role: 'hzense_runtime',
            effective_role: 'hzense_runtime',
            schema_name: 'public',
            server_version_num: 180_000,
            default_read_only: true,
            read_only: true,
            in_recovery: false,
            rolcanlogin: true,
            rolinherit: false,
            rolconnlimit: 20,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            role_default_read_only: true,
            database_owner: 'hzense_migrator',
            database_connect: true,
            database_connect_grantable: false,
            database_create: false,
            database_temp: false,
            public_usage: true,
            public_usage_grantable: false,
            public_create: false,
            topic_status_usage: true,
            topic_status_usage_grantable: false,
            ...identity,
          },
        ],
      };
    }
    if (sql.includes('FROM pg_auth_members')) {
      return { rowCount: 1, rows: [{ count: membershipCount }] };
    }
    if (sql.includes('FROM pg_database AS database_info') && sql.includes('connect_allowed')) {
      return { rowCount: otherDatabasePrivileges.length, rows: otherDatabasePrivileges };
    }
    if (sql.includes("type_info.typtype = 'e'") && sql.includes('AS usage_grantable')) {
      return { rowCount: enumTypePrivileges.length, rows: enumTypePrivileges };
    }
    if (sql.includes('FROM pg_namespace AS namespace_info') && sql.includes('AS usage_grantable')) {
      return { rowCount: extraSchemaPrivileges.length, rows: extraSchemaPrivileges };
    }
    if (sql.includes('relation_info.relname AS name') && sql.includes('rewrite_info.ev_class')) {
      const rows = [...expectedTableNames, ...extraRelations].map((name) => ({
        name,
        relkind: 'r',
        relpersistence: 'p',
        relrowsecurity: false,
        relforcerowsecurity: false,
        owner: 'hzense_migrator',
        policy_count: 0,
        user_trigger_count: 0,
        rewrite_rule_count: rewriteRuleCount,
      }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('FROM pg_inherits AS inheritance_info')) {
      return { rowCount: inheritanceEdges.length, rows: inheritanceEdges };
    }
    if (
      sql.includes("column_info.attrelid = 'public.topics'::regclass") &&
      !sql.includes('has_column_privilege')
    ) {
      const rows = physicalTopicColumns.map((name) => ({ name }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('has_table_privilege(current_user')) {
      return { rowCount: tablePrivilegeRows.length, rows: tablePrivilegeRows };
    }
    if (sql.includes('has_column_privilege(') && sql.includes('privilege_info.privilege')) {
      return { rowCount: columnPrivilegeRows.length, rows: columnPrivilegeRows };
    }
    if (sql.includes("SELECT 'schema' AS object_type")) {
      return { rowCount: ownedObjects.length, rows: ownedObjects };
    }
    if (sql.includes('extension_info.extname AS extension_name')) {
      return { rowCount: unsafeRoutines.length, rows: unsafeRoutines };
    }
    if (sql.includes('aclexplode(routine_info.proacl)')) {
      return { rowCount: directRoutineGrants.length, rows: directRoutineGrants };
    }
    if (sql.includes("sequence_info.relkind = 'S'")) {
      return { rowCount: sequencePrivileges.length, rows: sequencePrivileges };
    }
    if (sql.includes('FROM pg_default_acl AS default_acl')) {
      return { rowCount: defaultPrivileges.length, rows: defaultPrivileges };
    }
    throw new Error(`Unexpected Runtime reader preflight query: ${sql}`);
  });
  return { query };
}

function withProductionTls(client, expectedHost) {
  const query = client.query;
  client.query = vi.fn(async (sql, ...parameters) => {
    if (sql.includes('FROM pg_stat_ssl')) {
      return {
        rowCount: 1,
        rows: [{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }],
      };
    }
    return query(sql, ...parameters);
  });
  client.ssl = { rejectUnauthorized: true };
  client.connectionParameters = { ssl: { rejectUnauthorized: true } };
  client.connection = {
    stream: {
      encrypted: true,
      authorized: true,
      authorizationError: null,
      getProtocol: () => 'TLSv1.3',
      getCipher: () => ({ standardName: 'TLS_AES_256_GCM_SHA384' }),
      getPeerCertificate: () => ({
        raw: Buffer.from('test-certificate'),
        subject: { CN: expectedHost },
        subjectaltname: `DNS:${expectedHost}`,
      }),
    },
  };
  return client;
}

function reservedDatabaseClient(
  name,
  { identity = {}, loginTriggerCount = 0, objectAccess = [] } = {},
) {
  const postgres = name === 'postgres';
  const client = {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async (sql) => {
      if (
        sql.includes('FROM pg_database AS database_info') &&
        sql.includes('database_info.datistemplate AS is_template')
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              database_name: name,
              authenticated_role: 'hzense_runtime',
              effective_role: 'hzense_runtime',
              server_version_num: 180_000,
              default_read_only: true,
              read_only: true,
              in_recovery: false,
              database_owner: 'cloud_admin',
              is_template: !postgres,
              allows_connections: true,
              role_default_read_only: true,
              database_connect: true,
              database_connect_grantable: false,
              database_create: false,
              database_temp: postgres,
              ...identity,
            },
          ],
        };
      }
      if (sql.includes('FROM pg_event_trigger')) {
        return { rowCount: 1, rows: [{ count: loginTriggerCount }] };
      }
      if (sql.includes('WITH runtime_role AS')) {
        return { rowCount: objectAccess.length, rows: objectAccess };
      }
      throw new Error(`Unexpected Neon reserved-database query: ${sql}`);
    }),
  };
  return client;
}

describe('Runtime reader least-privilege preflight', () => {
  it('maps the protected production environment without generic database fallbacks', () => {
    expect(
      runtimeReaderProductionOptions({
        HZENSE_RUNTIME_DATABASE_URL: 'runtime-url',
        HZENSE_RUNTIME_EXPECTED_HOST: 'runtime-pooler.example.com',
        HZENSE_RUNTIME_EXPECTED_PORT: '5432',
        HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
        HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
        HZENSE_RUNTIME_EXPECTED_POSTGRES_MAJOR: '18',
        HZENSE_RUNTIME_EXPECTED_CONNECTION_LIMIT: '20',
        DATABASE_URL: 'must-not-be-used',
      }),
    ).toEqual({
      connectionString: 'runtime-url',
      profile: 'production',
      expectedHost: 'runtime-pooler.example.com',
      expectedPort: '5432',
      expectedDatabase: 'hzense',
      expectedUser: 'hzense_runtime',
      nodeTlsRejectUnauthorized: undefined,
      expectedPostgresMajor: 18,
      expectedConnectionLimit: 20,
    });
  });

  it('redacts production preflight failures to an optional safe SQLSTATE', () => {
    const secretBearingError = Object.assign(
      new Error('failed for postgresql://hzense_runtime:secret@private-pooler.neon.tech/hzense'),
      { code: '28P01' },
    );
    expect(runtimeReaderPreflightFailureMessage(secretBearingError)).toBe(
      'unavailable; sqlstate=28P01',
    );
    expect(
      runtimeReaderPreflightFailureMessage(
        Object.assign(new Error('getaddrinfo private-pooler.neon.tech'), { code: 'ENOTFOUND' }),
      ),
    ).toBe('unavailable');
  });

  it('provides an executable preflight runner and rejects direct production endpoints', async () => {
    const client = {
      ...preflightClient(),
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
    };
    const createClient = vi.fn(() => client);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        runRuntimeReaderPreflight({
          connectionString: 'postgresql://hzense_runtime:secret@127.0.0.1:5432/hzense',
          profile: 'local-test',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient,
        }),
      ).resolves.toMatchObject({ user: 'hzense_runtime', topicColumns: runtimeReaderTopicColumns });
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.end).toHaveBeenCalledOnce();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          application_name: 'hzense-runtime-reader-preflight',
          connectionTimeoutMillis: 10_000,
          query_timeout: 8_000,
        }),
      );

      await expect(
        runRuntimeReaderPreflight({
          connectionString:
            'postgresql://hzense_runtime:secret@runtime.example.com:5432/hzense?sslmode=verify-full&channel_binding=prefer',
          profile: 'production',
          expectedHost: 'runtime.example.com',
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient,
        }),
      ).rejects.toThrow(/must use an approved Neon pooler/);

      await expect(
        runRuntimeReaderPreflight({
          connectionString:
            'postgresql://hzense_runtime:secret@runtime-pooler.example.com:5432/hzense?sslmode=verify-full&channel_binding=prefer',
          profile: 'production',
          expectedHost: 'runtime-pooler.example.com',
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient,
        }),
      ).rejects.toThrow(/must use an approved Neon pooler/);
    } finally {
      log.mockRestore();
    }
  });

  it('rejects a non-runtime URL before creating or connecting a client', async () => {
    const createClient = vi.fn();

    await expect(
      runRuntimeReaderPreflight({
        connectionString: 'postgresql://neondb_owner:secret@127.0.0.1:5432/hzense',
        profile: 'local-test',
        expectedDatabase: 'hzense',
        expectedUser: 'neondb_owner',
        createClient,
      }),
    ).rejects.toThrow(/must authenticate as hzense_runtime/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reserves PostgreSQL 18, connection limit 20 and the fixed login identity', async () => {
    await expect(
      inspectRuntimeReaderPreflight({}, { ...expected, expectedPostgresMajor: 17 }),
    ).rejects.toThrow(/EXPECTED_POSTGRES_MAJOR must be 18/);
    await expect(
      inspectRuntimeReaderPreflight({}, { ...expected, expectedConnectionLimit: 19 }),
    ).rejects.toThrow(/EXPECTED_CONNECTION_LIMIT must be 20/);
    await expect(
      inspectRuntimeReaderPreflight({}, { ...expected, expectedUser: 'hzense_migrator' }),
    ).rejects.toThrow(/must authenticate as hzense_runtime/);
  });

  it('accepts exactly the five-column read-only Topic projection', async () => {
    await expect(inspectRuntimeReaderPreflight(preflightClient(), expected)).resolves.toEqual({
      database: 'hzense',
      user: 'hzense_runtime',
      postgresMajor: 18,
      connectionLimit: 20,
      defaultTransactionReadOnly: true,
      topicColumns: ['id', 'title', 'parent_id', 'status', 'runtime_enabled'],
      tlsVersion: 'local plaintext',
      tlsCipher: 'none',
      tlsEvidence: 'local',
    });
  });

  it('never depends on migration-history SELECT and audits effective table and column access', async () => {
    const client = preflightClient();
    await inspectRuntimeReaderPreflight(client, expected);
    const statements = client.query.mock.calls.map(([sql]) => sql);

    expect(statements.some((sql) => sql.includes('FROM public.hzense_schema_migrations'))).toBe(
      false,
    );
    expect(statements.some((sql) => sql.includes('has_table_privilege(current_user'))).toBe(true);
    expect(statements.some((sql) => sql.includes('has_column_privilege('))).toBe(true);
    expect(
      statements.some((sql) =>
        sql.includes(
          "namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
        ),
      ),
    ).toBe(true);
  });

  it('requires provider-configured and effective read-only defaults', async () => {
    for (const identity of [
      { role_default_read_only: false },
      { default_read_only: false },
      { read_only: false },
    ]) {
      await expect(
        inspectRuntimeReaderPreflight(preflightClient({ identity }), expected),
      ).rejects.toThrow(/default_transaction_read_only=on and a read-only session/);
    }
  });

  it('rejects role membership, elevated attributes, TEMP and grant options', async () => {
    await expect(
      inspectRuntimeReaderPreflight(preflightClient({ membershipCount: 1 }), expected),
    ).rejects.toThrow(/no incoming or outgoing role memberships/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ identity: { rolcreaterole: true } }),
        expected,
      ),
    ).rejects.toThrow(/elevated PostgreSQL role attributes/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ identity: { database_temp: true } }),
        expected,
      ),
    ).rejects.toThrow(/without database CREATE or TEMPORARY/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ identity: { public_usage_grantable: true } }),
        expected,
      ),
    ).rejects.toThrow(/schema USAGE without CREATE/);
  });

  it('rejects effective privileges on every other connectable database', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          otherDatabasePrivileges: [
            {
              name: 'postgres',
              connect_allowed: true,
              create_allowed: false,
              temporary_allowed: true,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/privileges on other connectable databases: postgres/);
  });

  it('recognizes only the exact production Neon reserved-database catalog contract', () => {
    const postgres = neonReservedDatabaseRow('postgres');
    const template1 = neonReservedDatabaseRow('template1');
    expect(isApprovedNeonReservedDatabaseException(postgres, 'production')).toBe(true);
    expect(isApprovedNeonReservedDatabaseException(template1, 'production')).toBe(true);

    for (const drift of [
      { ...postgres, name: 'neondb' },
      { ...postgres, owner: 'hzense_migrator' },
      { ...postgres, create_allowed: true },
      { ...postgres, temporary_allowed: false },
      { ...postgres, direct_runtime_acl: true },
      { ...template1, public_temporary: true },
    ]) {
      expect(isApprovedNeonReservedDatabaseException(drift, 'production')).toBe(false);
    }
    expect(isApprovedNeonReservedDatabaseException(postgres, 'local-test')).toBe(false);
  });

  it('keeps the exported target inspector strict until reserved databases are deeply verified', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ otherDatabasePrivileges: [neonReservedDatabaseRow('postgres')] }),
        { ...expected, profile: 'production', expectedHost: 'runtime-pooler.neon.tech' },
      ),
    ).rejects.toThrow(/privileges on other connectable databases: postgres/);
  });

  it('deeply verifies exact Neon postgres and template1 contracts with isolated clients', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const passwordMarker = 'runtime-reader-test-password-marker';
    const connectionString = `postgresql://hzense_runtime:${passwordMarker}@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const targetClient = withProductionTls(
      {
        ...preflightClient({
          otherDatabasePrivileges: [
            neonReservedDatabaseRow('template1'),
            neonReservedDatabaseRow('postgres'),
          ],
        }),
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
      },
      expectedHost,
    );
    const postgresClient = withProductionTls(reservedDatabaseClient('postgres'), expectedHost);
    const template1Client = withProductionTls(reservedDatabaseClient('template1'), expectedHost);
    const clients = [targetClient, postgresClient, template1Client];
    let nextClient = 0;
    const createClient = vi.fn(() => clients[nextClient++]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const result = await runRuntimeReaderPreflight({
        connectionString,
        profile: 'production',
        expectedHost,
        expectedPort: '5432',
        expectedDatabase: 'hzense',
        expectedUser: 'hzense_runtime',
        expectedPostgresMajor: 18,
        expectedConnectionLimit: 20,
        createClient,
      });

      expect(result).toMatchObject({
        database: 'hzense',
        user: 'hzense_runtime',
        verifiedNeonReservedDatabases: ['postgres', 'template1'],
      });
      expect(result).not.toHaveProperty('neonReservedDatabasesToVerify');
      expect(createClient).toHaveBeenCalledTimes(3);
      const options = createClient.mock.calls.map(([clientOptions]) => clientOptions);
      const urls = options.map(({ connectionString: configuredUrl }) => new URL(configuredUrl));
      expect(urls.map(({ pathname }) => pathname)).toEqual(['/hzense', '/postgres', '/template1']);
      expect(urls.every(({ hostname }) => hostname === expectedHost)).toBe(true);
      expect(options.map(({ application_name: applicationName }) => applicationName)).toEqual([
        'hzense-runtime-reader-preflight',
        'hzense-runtime-reader-reserved-preflight',
        'hzense-runtime-reader-reserved-preflight',
      ]);
      expect(clients.every(({ connect }) => connect.mock.calls.length === 1)).toBe(true);
      expect(clients.every(({ end }) => end.mock.calls.length === 1)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(passwordMarker);
      expect(log.mock.calls.flat().join(' ')).not.toContain(passwordMarker);
    } finally {
      log.mockRestore();
    }
  });

  it('fails closed when a reserved database exposes any non-system object', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const passwordMarker = 'runtime-reader-test-password-marker';
    const connectionString = `postgresql://hzense_runtime:${passwordMarker}@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const targetClient = withProductionTls(
      {
        ...preflightClient({
          otherDatabasePrivileges: [
            neonReservedDatabaseRow('postgres'),
            neonReservedDatabaseRow('template1'),
          ],
        }),
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
      },
      expectedHost,
    );
    const postgresClient = withProductionTls(
      reservedDatabaseClient('postgres', {
        objectAccess: [{ object_type: 'relation', object_name: 'public.exposed_data' }],
      }),
      expectedHost,
    );
    const clients = [targetClient, postgresClient];
    let nextClient = 0;
    const createClient = vi.fn(() => clients[nextClient++]);

    let failure;
    try {
      await runRuntimeReaderPreflight({
        connectionString,
        profile: 'production',
        expectedHost,
        expectedPort: '5432',
        expectedDatabase: 'hzense',
        expectedUser: 'hzense_runtime',
        expectedPostgresMajor: 18,
        expectedConnectionLimit: 20,
        createClient,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(
      'non-system object access in Neon reserved database postgres: relation:public.exposed_data',
    );
    expect(failure.message).not.toContain(passwordMarker);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(targetClient.end).toHaveBeenCalledOnce();
    expect(postgresClient.end).toHaveBeenCalledOnce();
  });

  it('allows only non-grantable topic_status USAGE among application enum Types', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          enumTypePrivileges: [
            {
              schema_name: 'public',
              name: 'topic_status',
              usage: true,
              usage_grantable: false,
            },
            {
              schema_name: 'public',
              name: 'entity_type',
              usage: true,
              usage_grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/unexpected application enum Types: public\.entity_type/);
  });

  it('rejects missing, metadata, write and grantable column privileges', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ columnPrivilegeRows: expectedColumnRows().slice(1) }),
        expected,
      ),
    ).rejects.toThrow(/missing \[public\.topics\.id:SELECT\]/);

    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          columnPrivilegeRows: [
            ...expectedColumnRows(),
            {
              schema_name: 'public',
              table_name: 'topics',
              column_name: 'metadata',
              privilege: 'SELECT',
              granted: true,
              grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/unexpected \[public\.topics\.metadata:SELECT\]/);

    const writable = expectedColumnRows();
    writable.push({
      schema_name: 'public',
      table_name: 'topics',
      column_name: 'title',
      privilege: 'UPDATE',
      granted: true,
      grantable: false,
    });
    await expect(
      inspectRuntimeReaderPreflight(preflightClient({ columnPrivilegeRows: writable }), expected),
    ).rejects.toThrow(/public\.topics\.title:UPDATE/);

    const grantable = expectedColumnRows();
    grantable[0] = { ...grantable[0], grantable: true };
    await expect(
      inspectRuntimeReaderPreflight(preflightClient({ columnPrivilegeRows: grantable }), expected),
    ).rejects.toThrow(/grantable \[public\.topics\.id:SELECT\]/);
  });

  it('rejects table-level migration history, other-table and destructive privileges', async () => {
    for (const row of [
      { schema_name: 'public', table_name: 'hzense_schema_migrations', privilege: 'SELECT' },
      { schema_name: 'public', table_name: 'sources', privilege: 'SELECT' },
      { schema_name: 'public', table_name: 'topics', privilege: 'UPDATE' },
      { schema_name: 'public', table_name: 'topics', privilege: 'MAINTAIN' },
    ]) {
      await expect(
        inspectRuntimeReaderPreflight(
          preflightClient({
            tablePrivilegeRows: [{ ...row, granted: true, grantable: false }],
          }),
          expected,
        ),
      ).rejects.toThrow(/must not receive table-level privileges/);
    }
  });

  it('rejects extra schemas, ownership, sequences and future grants', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          extraSchemaPrivileges: [
            {
              name: 'private_data',
              owner: 'hzense_migrator',
              usage: true,
              usage_grantable: false,
              create_allowed: false,
              create_grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/privileges on extra schemas: private_data/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          ownedObjects: [{ object_type: 'routine', schema_name: 'public', name: 'leak' }],
        }),
        expected,
      ),
    ).rejects.toThrow(/routine:public\.leak/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ sequencePrivileges: [{ schema_name: 'public', name: 'forbidden' }] }),
        expected,
      ),
    ).rejects.toThrow(/must not have sequence privileges/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({ defaultPrivileges: [{ object_type: 'f' }] }),
        expected,
      ),
    ).rejects.toThrow(/must not receive application privileges through defaults/);
  });

  it('allows only provider-owned invoker extension routines and rejects every unsafe path', async () => {
    const client = preflightClient();
    await inspectRuntimeReaderPreflight(client, expected);
    const routineAudit = client.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('extension_info.extname AS extension_name'));
    expect(routineAudit).toContain("extension_dependency.deptype = 'e'");
    expect(routineAudit).toContain('extension_info.oid IS NULL');
    expect(routineAudit).toContain("extension_info.extname <> 'vector'");
    expect(routineAudit).toContain('routine_info.proowner <> extension_info.extowner');
    expect(routineAudit).not.toContain('has_schema_privilege(current_user');
    expect(routineAudit).toContain('routine_info.prosecdef');
    expect(routineAudit).toContain("'EXECUTE WITH GRANT OPTION'");

    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          unsafeRoutines: [
            {
              schema_name: 'public',
              name: 'leak_topics',
              identity_arguments: '',
              security_definer: true,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/unsafe non-pgvector application or SECURITY DEFINER routines/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          directRoutineGrants: [
            { schema_name: 'public', name: 'vector_in', identity_arguments: 'cstring' },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/must not receive direct routine grants/);
  });

  it('rejects unexpected public relations and physical Topic columns', async () => {
    await expect(
      inspectRuntimeReaderPreflight(preflightClient({ extraRelations: ['rogue'] }), expected),
    ).rejects.toThrow(/unexpected \[rogue\]/);
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          physicalTopicColumns: ['id', 'title', 'parent_id', 'status', 'runtime_enabled'],
        }),
        expected,
      ),
    ).rejects.toThrow(/missing \[metadata\]/);
  });

  it('rejects every non-system PostgreSQL table-inheritance edge', async () => {
    await expect(
      inspectRuntimeReaderPreflight(
        preflightClient({
          inheritanceEdges: [
            {
              parent_schema: 'public',
              parent_name: 'topics',
              child_schema: 'private_data',
              child_name: 'inherited_topics',
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(
      /forbids PostgreSQL table inheritance: public\.topics->private_data\.inherited_topics/,
    );
  });
});
