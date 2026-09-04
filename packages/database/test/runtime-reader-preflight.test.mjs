import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { inspectNeonReservedProviderObjects } from '../src/neon-reserved-provider-contract.mjs';
import { expectedTableNames } from '../src/verify.mjs';
import {
  inspectRuntimeReaderPreflight,
  isApprovedNeonReservedDatabaseException,
  isApprovedNeonRuntimeAdminMembership,
  runRuntimeReaderPreflight,
  runtimeReaderPreflightFailureMessage,
  runtimeReaderProductionOptions,
  runtimeReaderSearchColumns,
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

function neonRuntimeAdminMembershipRow(overrides = {}) {
  return {
    member: 'neondb_owner',
    granted_role: 'hzense_runtime',
    grantor: 'cloud_admin',
    admin_option: true,
    inherit_option: false,
    set_option: false,
    ...overrides,
  };
}

function neonVectorOwnershipContractRow(overrides = {}) {
  return {
    extension_name: 'vector',
    extension_version: '0.8.6',
    extension_owner: 'neondb_owner',
    routine_count: 118,
    public_routine_count: 118,
    approved_routine_owner_count: 118,
    security_definer_count: 0,
    executable_routine_count: 118,
    public_execute_count: 118,
    grantable_count: 0,
    direct_runtime_acl_count: 0,
    ...overrides,
  };
}

function neonVectorSplitRoutineRow(overrides = {}) {
  return {
    schema_name: 'public',
    name: 'vector_in',
    identity_arguments: 'cstring, oid, integer',
    security_definer: false,
    extension_name: 'vector',
    extension_version: '0.8.6',
    extension_owner: 'neondb_owner',
    routine_owner: 'cloud_admin',
    grantable: false,
    direct_runtime_acl: false,
    ...overrides,
  };
}

function expectedColumnRows() {
  return [
    ...runtimeReaderTopicColumns.map((columnName) => ({
      schema_name: 'public',
      table_name: 'topics',
      column_name: columnName,
      privilege: 'SELECT',
      granted: true,
      grantable: false,
    })),
    ...runtimeReaderSearchColumns.map((columnName) => ({
      schema_name: 'public',
      table_name: 'search_documents',
      column_name: columnName,
      privilege: 'SELECT',
      granted: true,
      grantable: false,
    })),
  ];
}

function preflightClient({
  identity = {},
  membershipRows = [],
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
  physicalSearchColumns = [
    'id',
    'source_id',
    'source_type',
    'title',
    'summary',
    'href',
    'keywords',
    'body',
    'importance',
    'document_date',
    'topics',
    'entities',
    'embedding',
    'normalized_title',
    'normalized_summary',
    'normalized_keywords',
    'normalized_body',
    'search_vector',
  ],
  tablePrivilegeRows = [],
  columnPrivilegeRows = expectedColumnRows(),
  ownedObjects = [],
  neonVectorOwnershipRows = [neonVectorOwnershipContractRow()],
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
      return { rowCount: membershipRows.length, rows: membershipRows };
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
    if (
      sql.includes("column_info.attrelid = 'public.search_documents'::regclass") &&
      !sql.includes('has_column_privilege')
    ) {
      const rows = physicalSearchColumns.map((name) => ({ name }));
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
    if (sql.includes('AS approved_routine_owner_count')) {
      return { rowCount: neonVectorOwnershipRows.length, rows: neonVectorOwnershipRows };
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

const emptyFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function providerInventoryRows(contract, overrides = {}) {
  for (const [category, value] of Object.entries(overrides)) {
    if (value === null) {
      delete contract[category];
    } else {
      contract[category] = value;
    }
  }
  return Object.entries(contract).map(([category, [rowCount, fingerprint]]) => ({
    object_type: 'provider_contract',
    object_name: category,
    row_count: rowCount,
    fingerprint,
  }));
}

function neonPostgresProviderInventoryRows(overrides = {}) {
  return providerInventoryRows(
    {
      access: [409, 'd4948e90513977f99858f0b79213a73cef5f0598aa050beff457d4285aeecf8e'],
      access_method_path: [0, emptyFingerprint],
      cast_path: [0, emptyFingerprint],
      cluster_acl: [2, 'c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27'],
      collation: [1, 'f771a0e2041e68b74a33b558b9309ff1c0d12c303c777e64776ed58d90db8dc1'],
      column: [88, 'e0ae0459cb58e864c69403679a975022c1516282be5606eca6b5e569a9921bac'],
      conversion_path: [0, emptyFingerprint],
      event_trigger_path: [0, emptyFingerprint],
      extension: [3, 'ef00010ad1bc1a3ed5a7fa92f89d9440f087fa835db83fb7358609895e38956d'],
      index: [4, 'bfcad804bf1f28525d07069a598b6f67a6f6e53a8632d3bb6854bc2572232ac4'],
      inheritance: [0, emptyFingerprint],
      language_path: [1, 'a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2'],
      opclass_path: [3, 'b85a941022cd28c87400667036eb9c0fcfb41724b733562bf9284325de547557'],
      operator_path: [0, emptyFingerprint],
      relation: [11, '46d2eb1662f0bcf522af4924ac0a39ebb0627f594102dbb196ffc8d6d8fd71b2'],
      routine: [32, 'e8196ad70dd9e1a92487b5f000228055f27e806fd181ecf113158ce9ba63c8d3'],
      runtime_ownership: [0, emptyFingerprint],
      schema: [3, 'b2e869dfd831d2dc0fdde3e5d794d8075c5537a06375bf207d377cce0465f27b'],
      sequence: [1, 'b6faf55448ebcc9ec6fad504174863ce84876c9ac44628f95ddbc828ee717a4e'],
      system_acl: [290, '1dbfec7d500d12305971a3f96b66aedfed49ac5e8970f71f20b4e94e687787b0'],
      system_schema_access: [3, '3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1'],
      text_search_path: [0, emptyFingerprint],
      type: [22, 'a24ad3b2cc81a9b4fce6ee6ddc0229d18170553d6e84db206eb504ce43f99f73'],
    },
    overrides,
  );
}

function neonTemplate1ProviderInventoryRows(overrides = {}) {
  return providerInventoryRows(
    {
      access: [298, 'e9fee8a89c81258c4af59ba9290c3da752d50924a35900b09eb5ab28a090de59'],
      access_method_path: [0, emptyFingerprint],
      cast_path: [0, emptyFingerprint],
      cluster_acl: [2, 'c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27'],
      collation: [0, emptyFingerprint],
      column: [0, emptyFingerprint],
      conversion_path: [0, emptyFingerprint],
      event_trigger_path: [0, emptyFingerprint],
      extension: [1, '9f6cdae8e6afd79b270395fe92c29025d132abe418bc129bc3e5b15901a08028'],
      index: [0, emptyFingerprint],
      inheritance: [0, emptyFingerprint],
      language_path: [1, 'a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2'],
      opclass_path: [0, emptyFingerprint],
      operator_path: [0, emptyFingerprint],
      relation: [0, emptyFingerprint],
      routine: [3, '99474588efacae6202672d9dc1eda67e67944e123110d078a6aaf254f6a5a90e'],
      runtime_ownership: [0, emptyFingerprint],
      schema: [1, '09728fda86962e16d49ecfb057c93d75ce0529678bbb68a0642ee3dd0aa016e9'],
      sequence: [0, emptyFingerprint],
      system_acl: [289, '07b165bf8182f1c3e3bccc3572eb4b9b5f11f969df4c75c30ca5ba0d5ebf1721'],
      system_schema_access: [3, '3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1'],
      text_search_path: [0, emptyFingerprint],
      type: [0, emptyFingerprint],
    },
    overrides,
  );
}

function reservedDatabaseClient(
  name,
  {
    identity = {},
    loginTriggerCount = 0,
    objectAccess = [],
    providerInventory = name === 'postgres'
      ? neonPostgresProviderInventoryRows()
      : neonTemplate1ProviderInventoryRows(),
  } = {},
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
      if (sql.includes('FROM pg_event_trigger') && !sql.includes('inventory_categories')) {
        return { rowCount: 1, rows: [{ count: loginTriggerCount }] };
      }
      if (sql.includes('inventory_categories')) {
        const rows = [...providerInventory, ...objectAccess];
        return { rowCount: rows.length, rows };
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

  it('accepts exactly the least-privilege Topic and Search projections', async () => {
    await expect(inspectRuntimeReaderPreflight(preflightClient(), expected)).resolves.toEqual({
      database: 'hzense',
      user: 'hzense_runtime',
      postgresMajor: 18,
      connectionLimit: 20,
      defaultTransactionReadOnly: true,
      topicColumns: ['id', 'title', 'parent_id', 'status', 'runtime_enabled'],
      searchColumns: runtimeReaderSearchColumns,
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
      inspectRuntimeReaderPreflight(
        preflightClient({
          membershipRows: [
            {
              member: 'hzense_runtime',
              granted_role: 'unsafe_role',
              grantor: 'cluster_admin',
              admin_option: false,
              inherit_option: true,
              set_option: true,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/unsafe incoming or outgoing role memberships/);
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

  it('allows the exact Neon control-plane admin membership only through the production runner', async () => {
    const providerMembership = neonRuntimeAdminMembershipRow();
    expect(isApprovedNeonRuntimeAdminMembership(providerMembership, 'production')).toBe(true);
    expect(isApprovedNeonRuntimeAdminMembership(providerMembership, 'local-test')).toBe(false);
    expect(isApprovedNeonRuntimeAdminMembership(undefined, 'production')).toBe(false);

    for (const drift of [
      { ...providerMembership, member: 'another_owner' },
      { ...providerMembership, granted_role: 'another_role' },
      { ...providerMembership, grantor: 'neondb_owner' },
      { ...providerMembership, admin_option: false },
      { ...providerMembership, admin_option: null },
      { ...providerMembership, admin_option: 'true' },
      { ...providerMembership, inherit_option: true },
      { ...providerMembership, inherit_option: 'false' },
      { ...providerMembership, set_option: true },
      { ...providerMembership, set_option: undefined },
    ]) {
      expect(isApprovedNeonRuntimeAdminMembership(drift, 'production')).toBe(false);
    }

    for (const options of [
      expected,
      { ...expected, profile: 'production', expectedHost: 'runtime-pooler.neon.tech' },
    ]) {
      await expect(
        inspectRuntimeReaderPreflight(
          withProductionTls(
            preflightClient({ membershipRows: [providerMembership] }),
            'runtime-pooler.neon.tech',
          ),
          options,
        ),
      ).rejects.toThrow(/unsafe incoming or outgoing role memberships/);
    }

    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:secret@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const runnerClient = withProductionTls(
      {
        ...preflightClient({ membershipRows: [providerMembership] }),
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
      },
      expectedHost,
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(
        runRuntimeReaderPreflight({
          connectionString,
          profile: 'production',
          expectedHost,
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient: vi.fn(() => runnerClient),
        }),
      ).resolves.toMatchObject({ user: 'hzense_runtime' });

      const extraMembershipClient = withProductionTls(
        {
          ...preflightClient({
            membershipRows: [
              providerMembership,
              neonRuntimeAdminMembershipRow({ member: 'another_owner' }),
            ],
          }),
          connect: vi.fn(async () => undefined),
          end: vi.fn(async () => undefined),
        },
        expectedHost,
      );
      await expect(
        runRuntimeReaderPreflight({
          connectionString,
          profile: 'production',
          expectedHost,
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient: vi.fn(() => extraMembershipClient),
        }),
      ).rejects.toThrow(/^Runtime reader role has unsafe incoming or outgoing role memberships$/);
    } finally {
      log.mockRestore();
    }
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
      const providerInventoryQuery = postgresClient.query.mock.calls
        .map(([sql]) => sql)
        .find((sql) => sql.includes('inventory_categories'));
      expect(providerInventoryQuery).toContain("extension_dependency.deptype = 'e'");
      expect(providerInventoryQuery).toContain('relation_info.reloptions');
      expect(providerInventoryQuery).toContain('pg_get_triggerdef(trigger_info.oid, true)');
      expect(providerInventoryQuery).toContain('pg_get_ruledef(rewrite_info.oid, true)');
      expect(providerInventoryQuery).toContain('pg_get_constraintdef(constraint_info.oid, true)');
      expect(providerInventoryQuery).toContain('pg_get_expr(default_info.adbin');
      expect(providerInventoryQuery).toContain('collation_info.collname');
      expect(providerInventoryQuery).toContain('pg_collation_actual_version(collation_info.oid)');
      expect(providerInventoryQuery).toContain('pg_get_indexdef(index_relation.oid, 0, true)');
      expect(providerInventoryQuery).toContain('index_info.indisvalid');
      expect(providerInventoryQuery).toContain('sequence_data.seqincrement');
      expect(providerInventoryQuery).toContain('routine_info.prosecdef');
      expect(providerInventoryQuery).toContain('routine_info.prosupport');
      expect(providerInventoryQuery).toContain('pg_get_functiondef(routine_info.oid)');
      expect(providerInventoryQuery).toContain('LEFT JOIN pg_aggregate AS aggregate_info');
      expect(providerInventoryQuery).toContain('aggregate_info.aggtransfn');
      expect(providerInventoryQuery).toContain('type_info.typinput');
      expect(providerInventoryQuery).toContain('type_info.typsubscript');
      expect(providerInventoryQuery).toContain('FROM pg_enum AS enum_info');
      expect(providerInventoryQuery).toContain('range_info.rngsubtype');
      expect(providerInventoryQuery).toContain("'EXECUTE WITH GRANT OPTION'");
      expect(providerInventoryQuery).toContain('FROM pg_operator AS operator_info');
      expect(providerInventoryQuery).toContain('restriction_routine.pronamespace');
      expect(providerInventoryQuery).toContain('join_routine.pronamespace');
      expect(providerInventoryQuery).toContain('commutator_operator.oprnamespace');
      expect(providerInventoryQuery).toContain('negator_operator.oprnamespace');
      expect(providerInventoryQuery).toContain('permanent_namespaces AS');
      expect(providerInventoryQuery).toContain('candidate_relations AS');
      expect(providerInventoryQuery).toContain('candidate_routines AS');
      expect(providerInventoryQuery).toContain('candidate_types AS');
      expect(providerInventoryQuery).toContain('FROM pg_opclass AS opclass_info');
      expect(providerInventoryQuery).toContain('FROM pg_amop AS operator_map');
      expect(providerInventoryQuery).toContain('operator_map.oid >= 16384');
      expect(providerInventoryQuery).toContain('FROM pg_amproc AS support_map');
      expect(providerInventoryQuery).toContain('support_map.oid >= 16384');
      expect(providerInventoryQuery).toContain('access_method.amhandler');
      expect(providerInventoryQuery).toContain('FROM pg_cast AS cast_info');
      expect(providerInventoryQuery).toContain('LEFT JOIN pg_proc AS routine_info');
      expect(providerInventoryQuery).toContain('cast_info.castcontext');
      expect(providerInventoryQuery).toContain('cast_info.castmethod');
      expect(providerInventoryQuery).toContain('cast_info.oid >= 16384');
      expect(providerInventoryQuery).toContain('FROM pg_conversion AS conversion_info');
      expect(providerInventoryQuery).toContain('FROM pg_ts_config AS config_info');
      expect(providerInventoryQuery).toContain('FROM pg_ts_dict AS dictionary_info');
      expect(providerInventoryQuery).toContain('FROM pg_language AS language_info');
      expect(providerInventoryQuery).toContain('FROM pg_transform AS transform_info');
      expect(providerInventoryQuery).toContain("SELECT 'system_schema_access'");
      expect(providerInventoryQuery).toContain("SELECT 'system_acl'");
      expect(providerInventoryQuery).toContain("SELECT 'cluster_acl'");
      expect(providerInventoryQuery).toContain('FROM pg_tablespace AS tablespace_info');
      expect(providerInventoryQuery).toContain('FROM pg_parameter_acl AS parameter_acl');
      expect(providerInventoryQuery).toContain(
        "has_parameter_privilege(current_user, parameter_acl.parname, 'SET')",
      );
      expect(providerInventoryQuery).toContain("SELECT 'runtime_ownership'");
      expect(providerInventoryQuery).toContain('FROM pg_database AS database_info');
      expect(providerInventoryQuery).toContain(
        'database_info.datdba = (SELECT oid FROM runtime_role)',
      );
      expect(providerInventoryQuery).toContain('FROM pg_subscription AS subscription_info');
      expect(providerInventoryQuery).toContain('FROM pg_default_acl AS default_acl');
      expect(providerInventoryQuery).toContain("SELECT 'access_method_path'");
      expect(providerInventoryQuery).toContain('FROM pg_am AS access_method');
      expect(providerInventoryQuery).toContain("SELECT 'event_trigger_path'");
      expect(providerInventoryQuery).toContain('FROM pg_event_trigger AS event_trigger');
      expect(providerInventoryQuery).toContain(
        "WHERE current_database() IN ('postgres', 'template1')",
      );
      expect(providerInventoryQuery).toContain('LEFT JOIN pg_type AS result_type');
      expect(providerInventoryQuery).toContain('LEFT JOIN pg_proc AS routine_info');
      expect(providerInventoryQuery).toContain('WHEN operator_info.oprresult = 0 THEN NULL');
      expect(providerInventoryQuery).toContain(
        "relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')",
      );
      expect(providerInventoryQuery).toContain(
        "HAVING current_database() IN ('postgres', 'template1')",
      );
      expect(providerInventoryQuery).toContain('COLLATE "C"');
      expect(providerInventoryQuery).toContain('sha256(');
      expect(JSON.stringify(result)).not.toContain(passwordMarker);
      expect(log.mock.calls.flat().join(' ')).not.toContain(passwordMarker);
    } finally {
      log.mockRestore();
    }
  });

  it('fails closed without exposing object names when the provider inventory drifts', async () => {
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
        providerInventory: neonPostgresProviderInventoryRows({
          relation: [11, '0000000000000000000000000000000000000000000000000000000000000000'],
        }),
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
    expect(failure.message).toBe('Neon reserved postgres provider object contract changed');
    expect(failure.message).not.toContain('public.exposed_data');
    expect(failure.message).not.toContain(passwordMarker);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(targetClient.end).toHaveBeenCalledOnce();
    expect(postgresClient.end).toHaveBeenCalledOnce();
  });

  it('rejects missing and same-count substituted provider inventory categories', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:runtime-reader-test-password-marker@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;

    for (const providerInventory of [
      neonPostgresProviderInventoryRows({ routine: null }),
      neonPostgresProviderInventoryRows({
        access: [409, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
      }),
      neonPostgresProviderInventoryRows({
        routine: [32, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
      }),
    ]) {
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
        reservedDatabaseClient('postgres', { providerInventory }),
        expectedHost,
      );
      const clients = [targetClient, postgresClient];
      let nextClient = 0;

      await expect(
        runRuntimeReaderPreflight({
          connectionString,
          profile: 'production',
          expectedHost,
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient: () => clients[nextClient++],
        }),
      ).rejects.toThrow('Neon reserved postgres provider object contract changed');
    }
  });

  it('rejects duplicate and unknown provider inventory categories', async () => {
    const exactRows = neonPostgresProviderInventoryRows();
    const unknownRows = exactRows
      .filter(({ object_name: objectName }) => objectName !== 'routine')
      .concat({
        object_type: 'provider_contract',
        object_name: 'unreviewed_category',
        row_count: 32,
        fingerprint: 'e8196ad70dd9e1a92487b5f000228055f27e806fd181ecf113158ce9ba63c8d3',
      });

    for (const rows of [[...exactRows, exactRows[0]], unknownRows]) {
      const client = { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };
      await expect(
        inspectNeonReservedProviderObjects(client, {
          expectedDatabase: 'postgres',
          profile: 'production',
        }),
      ).rejects.toThrow('Neon reserved postgres provider object contract changed');
    }
  });

  it('accepts the exact provider contract independently of summary row order', async () => {
    const rows = neonPostgresProviderInventoryRows().reverse();
    const client = { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };

    await expect(
      inspectNeonReservedProviderObjects(client, {
        expectedDatabase: 'postgres',
        profile: 'production',
      }),
    ).resolves.toBeUndefined();
  });

  it('never discards raw access rows from otherwise exact provider summaries', async () => {
    for (const objectType of [
      'cluster_acl',
      'relation',
      'column',
      'routine',
      'runtime_ownership',
      'type',
    ]) {
      const sensitiveObjectName = `unreviewed_${objectType}`;
      const rows = [
        ...neonPostgresProviderInventoryRows(),
        {
          object_type: objectType,
          object_name: sensitiveObjectName,
          row_count: null,
          fingerprint: null,
        },
      ];
      const client = { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };

      let failure;
      try {
        await inspectNeonReservedProviderObjects(client, {
          expectedDatabase: 'postgres',
          profile: 'production',
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(`${objectType}(1)`);
      expect(failure.message).not.toContain(sensitiveObjectName);
    }
  });

  it('rejects a reserved provider contract outside the production reserved scope', async () => {
    const rows = neonPostgresProviderInventoryRows();
    const client = { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };

    await expect(
      inspectNeonReservedProviderObjects(client, {
        expectedDatabase: 'postgres',
        profile: 'local-test',
      }),
    ).rejects.toThrow('Neon provider object exception escaped its production reserved scope');
  });

  it('reports only residual object categories and counts', async () => {
    const sensitiveObjectName = 'private_operator_target';
    const client = {
      query: vi.fn(async () => {
        const rows = [
          ...neonPostgresProviderInventoryRows(),
          {
            object_type: 'foreign_server',
            object_name: sensitiveObjectName,
            row_count: null,
            fingerprint: null,
          },
        ];
        return { rowCount: rows.length, rows };
      }),
    };

    let failure;
    try {
      await inspectNeonReservedProviderObjects(client, {
        expectedDatabase: 'postgres',
        profile: 'production',
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('foreign_server(1)');
    expect(failure.message).not.toContain(sensitiveObjectName);
  });

  it('never applies the postgres provider inventory contract to template1', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:runtime-reader-test-password-marker@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
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
    const postgresClient = withProductionTls(reservedDatabaseClient('postgres'), expectedHost);
    const template1Client = withProductionTls(
      reservedDatabaseClient('template1', {
        providerInventory: neonPostgresProviderInventoryRows(),
      }),
      expectedHost,
    );
    const clients = [targetClient, postgresClient, template1Client];
    let nextClient = 0;

    await expect(
      runRuntimeReaderPreflight({
        connectionString,
        profile: 'production',
        expectedHost,
        expectedPort: '5432',
        expectedDatabase: 'hzense',
        expectedUser: 'hzense_runtime',
        expectedPostgresMajor: 18,
        expectedConnectionLimit: 20,
        createClient: () => clients[nextClient++],
      }),
    ).rejects.toThrow('Neon reserved template1 provider object contract changed');
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

  it('accepts the exact Neon pgvector ownership split only through the production runner', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:test-only-password@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const client = withProductionTls(
      {
        ...preflightClient({ unsafeRoutines: [neonVectorSplitRoutineRow()] }),
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
      },
      expectedHost,
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(
        runRuntimeReaderPreflight({
          connectionString,
          profile: 'production',
          expectedHost,
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient: vi.fn(() => client),
        }),
      ).resolves.toMatchObject({ user: 'hzense_runtime' });

      const statements = client.query.mock.calls.map(([sql]) => sql);
      expect(statements.findIndex((sql) => sql.includes('FROM pg_stat_ssl'))).toBeLessThan(
        statements.findIndex((sql) => sql.includes('AS approved_routine_owner_count')),
      );
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.end).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it('keeps the public inspector strict for the Neon pgvector ownership split', async () => {
    const splitRoutine = neonVectorSplitRoutineRow();
    await expect(
      inspectRuntimeReaderPreflight(preflightClient({ unsafeRoutines: [splitRoutine] }), expected),
    ).rejects.toThrow(
      /^Runtime reader can execute unsafe non-pgvector application or SECURITY DEFINER routines$/,
    );

    const expectedHost = 'runtime-pooler.neon.tech';
    const productionClient = withProductionTls(
      preflightClient({ unsafeRoutines: [splitRoutine] }),
      expectedHost,
    );
    await expect(
      inspectRuntimeReaderPreflight(productionClient, {
        ...expected,
        profile: 'production',
        expectedHost,
      }),
    ).rejects.toThrow(
      /^Runtime reader can execute unsafe non-pgvector application or SECURITY DEFINER routines$/,
    );
    expect(
      productionClient.query.mock.calls.some(([sql]) =>
        sql.includes('AS approved_routine_owner_count'),
      ),
    ).toBe(false);
  });

  it('fails closed for every Neon pgvector ownership-contract drift', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:test-only-password@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const drifts = [
      { extension_version: '0.8.5' },
      { extension_owner: 'cloud_admin' },
      { routine_count: 119 },
      { public_routine_count: 117 },
      { approved_routine_owner_count: 117 },
      { security_definer_count: 1 },
      { executable_routine_count: 117 },
      { public_execute_count: 117 },
      { grantable_count: 1 },
      { direct_runtime_acl_count: 1 },
    ];

    for (const drift of drifts) {
      const client = withProductionTls(
        {
          ...preflightClient({
            neonVectorOwnershipRows: [neonVectorOwnershipContractRow(drift)],
            unsafeRoutines: [neonVectorSplitRoutineRow()],
          }),
          connect: vi.fn(async () => undefined),
          end: vi.fn(async () => undefined),
        },
        expectedHost,
      );

      await expect(
        runRuntimeReaderPreflight({
          connectionString,
          profile: 'production',
          expectedHost,
          expectedPort: '5432',
          expectedDatabase: 'hzense',
          expectedUser: 'hzense_runtime',
          expectedPostgresMajor: 18,
          expectedConnectionLimit: 20,
          createClient: vi.fn(() => client),
        }),
      ).rejects.toThrow(/^Runtime reader Neon pgvector ownership contract changed$/);
      expect(client.end).toHaveBeenCalledOnce();
    }
  });

  it('rejects extra unsafe routines without exposing catalog metadata', async () => {
    const expectedHost = 'ep-runtime-pooler.us-east-1.aws.neon.tech';
    const connectionString = `postgresql://hzense_runtime:test-only-password@${expectedHost}:5432/hzense?sslmode=verify-full&channel_binding=prefer`;
    const client = withProductionTls(
      {
        ...preflightClient({
          unsafeRoutines: [
            neonVectorSplitRoutineRow(),
            {
              schema_name: 'private_catalog',
              name: 'credential_shaped_routine_name',
              identity_arguments: 'text',
              security_definer: true,
              extension_name: null,
              extension_version: null,
              extension_owner: null,
              routine_owner: 'unexpected_owner',
              grantable: false,
              direct_runtime_acl: false,
            },
          ],
        }),
        connect: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
      },
      expectedHost,
    );

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
        createClient: vi.fn(() => client),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe(
      'Runtime reader can execute unsafe non-pgvector application or SECURITY DEFINER routines',
    );
    expect(failure.message).not.toContain('private_catalog');
    expect(failure.message).not.toContain('credential_shaped_routine_name');
    expect(client.end).toHaveBeenCalledOnce();
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
