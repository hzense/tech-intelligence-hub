import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../src/migrate.mjs';
import {
  assertDirectTopicSyncEndpoint,
  inspectTopicSyncPreflight,
} from '../src/topic-sync-preflight.mjs';
import { expectedTableNames } from '../src/verify.mjs';
import { expectedSignalTriggerCount } from '../src/signal-immutability-catalog.mjs';
import {
  signalImmutabilityQueryFixture,
  signalImmutabilityFixture,
} from './signal-immutability-fixtures.mjs';

const expected = {
  expectedDatabase: 'hzense',
  expectedUser: 'hzense_topic_sync',
  expectedPostgresMajor: 18,
  expectedConnectionLimit: 2,
  profile: 'local-test',
};

async function preflightClient({
  readOnly = false,
  topicPrivileges = ['SELECT', 'INSERT', 'UPDATE'],
  extraRelations = [],
  viewRelation = {},
  omitPublicView = false,
  rewriteRuleCount = 0,
  extraPrivileges = [],
  columnPrivileges = [],
  defaultPrivilegeCount = 0,
  extraSchemaPrivileges = [],
  ownedObjects = [],
  securityDefinerRoutines = [],
  immutability = signalImmutabilityFixture(),
} = {}) {
  const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
  const query = vi.fn(async (sql) => {
    const immutabilityResult = signalImmutabilityQueryFixture(sql, immutability);
    if (immutabilityResult) return immutabilityResult;
    if (sql.includes('FROM pg_roles AS role_info')) {
      return {
        rowCount: 1,
        rows: [
          {
            database_name: 'hzense',
            authenticated_role: 'hzense_topic_sync',
            effective_role: 'hzense_topic_sync',
            schema_name: 'public',
            server_version_num: 180_000,
            read_only: readOnly,
            in_recovery: false,
            rolcanlogin: true,
            rolinherit: false,
            rolconnlimit: 2,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
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
          },
        ],
      };
    }
    if (sql.includes('FROM pg_auth_members')) return { rowCount: 1, rows: [{ count: 0 }] };
    if (sql.includes('FROM pg_namespace AS namespace_info') && sql.includes('AS usage_grantable')) {
      return { rowCount: extraSchemaPrivileges.length, rows: extraSchemaPrivileges };
    }
    if (
      sql.includes('relation_info.relname AS name') &&
      sql.includes("WHERE namespace_info.nspname = 'public'")
    ) {
      const rows = [
        ...expectedTableNames,
        ...(omitPublicView ? [] : ['current_public_signals']),
        'editorial_public_signals',
        ...extraRelations,
      ].map((name) => ({
        name,
        relkind: ['current_public_signals', 'editorial_public_signals'].includes(name) ? 'v' : 'r',
        relpersistence: 'p',
        relrowsecurity: false,
        relforcerowsecurity: false,
        owner: 'hzense_migrator',
        policy_count: 0,
        user_trigger_count: expectedSignalTriggerCount(name),
        rewrite_rule_count: ['current_public_signals', 'editorial_public_signals'].includes(name)
          ? 1
          : rewriteRuleCount,
        ...(name === 'current_public_signals' ? viewRelation : {}),
      }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('privilege_info.privilege')) {
      const topicRows = topicPrivileges.map((entry) => {
        const value = typeof entry === 'string' ? { privilege: entry } : entry;
        return {
          schema_name: 'public',
          table_name: 'topics',
          privilege: value.privilege,
          granted: true,
          grantable: value.grantable ?? false,
        };
      });
      return {
        rowCount: topicRows.length + extraPrivileges.length + 1,
        rows: [
          ...topicRows,
          {
            schema_name: 'public',
            table_name: 'hzense_schema_migrations',
            privilege: 'SELECT',
            granted: true,
            grantable: false,
          },
          ...extraPrivileges.map((row) => ({ schema_name: 'public', ...row })),
        ],
      };
    }
    if (sql.includes('aclexplode(column_info.attacl)')) {
      return {
        rowCount: columnPrivileges.length,
        rows: columnPrivileges.map((row) => ({ schema_name: 'public', ...row })),
      };
    }
    if (sql.includes("SELECT 'schema' AS object_type")) {
      return { rowCount: ownedObjects.length, rows: ownedObjects };
    }
    if (sql.includes('routine_info.prosecdef')) {
      return { rowCount: securityDefinerRoutines.length, rows: securityDefinerRoutines };
    }
    if (sql.includes("sequence_info.relkind = 'S'")) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM pg_default_acl')) {
      return { rowCount: 1, rows: [{ count: defaultPrivilegeCount }] };
    }
    if (sql.includes('FROM public.hzense_schema_migrations')) {
      return {
        rowCount: migrations.length,
        rows: migrations.map(({ name, checksum }) => ({ name, checksum })),
      };
    }
    throw new Error(`Unexpected preflight query: ${sql}`);
  });
  return { query };
}

describe('Topic sync least-privilege preflight', () => {
  it.each([
    { relkind: 'r' },
    { relkind: 'm' },
    { owner: 'another_owner' },
    { rewrite_rule_count: 2 },
    { user_trigger_count: 1 },
    { relpersistence: 'u' },
  ])('rejects current view relation drift: %j', async (viewRelation) => {
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ viewRelation }), expected),
    ).rejects.toThrow(/current public Signal view relation contract/);
  });
  it.each(['definition', 'options', 'columns', 'owner', 'missing'])(
    'rejects exact current view %s drift',
    async (field) => {
      const immutability = signalImmutabilityFixture();
      if (field === 'missing') immutability.views = [];
      else if (field === 'definition') immutability.views[0].definition += ' -- changed';
      else if (field === 'options') immutability.views[0].options = ['security_barrier=false'];
      else if (field === 'columns') immutability.views[0].columns.push(['metadata', 'jsonb']);
      else immutability.views[0].owner = 'another_owner';
      await expect(
        inspectTopicSyncPreflight(await preflightClient({ immutability }), expected),
      ).rejects.toThrow(/current public Signal view/);
    },
  );
  it('recognizes only the fixed view without granting Topic sync access to it', async () => {
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ omitPublicView: true }), expected),
    ).rejects.toThrow(/missing \[current_public_signals\]/);
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          extraPrivileges: [
            {
              table_name: 'current_public_signals',
              privilege: 'SELECT',
              granted: true,
              grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/privileges on unrelated tables/);
  });
  it('rejects a disabled Signal guard even when the trigger count is unchanged', async () => {
    const immutability = signalImmutabilityFixture();
    immutability.triggers[0].enabled = 'D';
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ immutability }), expected),
    ).rejects.toThrow(/Signal immutability contract mismatch/);
  });

  it('requires the fixed PostgreSQL 18 and connection-limit contract', async () => {
    await expect(
      inspectTopicSyncPreflight({}, { ...expected, expectedPostgresMajor: 17 }),
    ).rejects.toThrow(/EXPECTED_POSTGRES_MAJOR must be 18/);
    await expect(
      inspectTopicSyncPreflight({}, { ...expected, expectedConnectionLimit: 3 }),
    ).rejects.toThrow(/EXPECTED_CONNECTION_LIMIT must be 2/);
  });

  it('accepts only the reviewed writer and fully applied migration history', async () => {
    const client = await preflightClient();

    await expect(inspectTopicSyncPreflight(client, expected)).resolves.toMatchObject({
      database: 'hzense',
      user: 'hzense_topic_sync',
      postgresMajor: 18,
      connectionLimit: 2,
      tlsEvidence: 'local',
    });
  });

  it('can require the independent verifier to already be inside READ ONLY mode', async () => {
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ readOnly: true }), {
        ...expected,
        expectedTransactionReadOnly: true,
      }),
    ).resolves.toMatchObject({ user: 'hzense_topic_sync' });

    await expect(
      inspectTopicSyncPreflight(await preflightClient(), {
        ...expected,
        expectedTransactionReadOnly: true,
      }),
    ).rejects.toThrow(/transaction mode mismatch/);
  });

  it('audits all non-system schemas and only actually callable SECURITY DEFINER routines', async () => {
    const client = await preflightClient();
    await inspectTopicSyncPreflight(client, expected);
    const statements = client.query.mock.calls.map(([sql]) => sql);

    const relationPrivileges = statements.find((sql) => sql.includes('privilege_info.privilege'));
    const columnPrivileges = statements.find((sql) =>
      sql.includes('aclexplode(column_info.attacl)'),
    );
    const ownedObjects = statements.find((sql) => sql.includes("SELECT 'schema' AS object_type"));
    for (const statement of [relationPrivileges, columnPrivileges, ownedObjects]) {
      expect(statement).toContain(
        "namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
      );
      expect(statement).not.toContain("namespace_info.nspname = 'public'");
    }

    const securityDefinerRoutines = statements.find((sql) =>
      sql.includes('routine_info.prosecdef'),
    );
    expect(securityDefinerRoutines).toContain(
      "namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
    );
    expect(securityDefinerRoutines).toContain(
      "has_schema_privilege(current_user, namespace_info.oid, 'USAGE')",
    );
    expect(securityDefinerRoutines).toContain(
      "has_function_privilege(current_user, routine_info.oid, 'EXECUTE')",
    );

    const publicRelations = statements.find(
      (sql) =>
        sql.includes('relation_info.relname AS name') && sql.includes('rewrite_info.ev_class'),
    );
    expect(publicRelations).toContain('FROM pg_rewrite AS rewrite_info');
  });

  it('rejects missing or destructive Topic table privileges', async () => {
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({ topicPrivileges: ['SELECT', 'INSERT'] }),
        expected,
      ),
    ).rejects.toThrow(/missing \[UPDATE\]/);

    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          topicPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        }),
        expected,
      ),
    ).rejects.toThrow(/unexpected \[DELETE\]/);
  });

  it('rejects MAINTAIN, grant options and unrelated relation or column access', async () => {
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          topicPrivileges: ['SELECT', 'INSERT', 'UPDATE', 'MAINTAIN'],
        }),
        expected,
      ),
    ).rejects.toThrow(/unexpected \[MAINTAIN\]/);
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          topicPrivileges: [{ privilege: 'SELECT', grantable: true }, 'INSERT', 'UPDATE'],
        }),
        expected,
      ),
    ).rejects.toThrow(/must not hold grant options/);
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ extraRelations: ['rogue'] }), expected),
    ).rejects.toThrow(/unexpected \[rogue\]/);
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          columnPrivileges: [
            {
              table_name: 'sources',
              column_name: 'name',
              privilege_type: 'SELECT',
              is_grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/must not receive column-level privileges/);
  });

  it('rejects rewrite rules on the protected public relations', async () => {
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ rewriteRuleCount: 1 }), expected),
    ).rejects.toThrow(/unexpected rewrite rule: topics/);
  });

  it('rejects table or sequence default privileges granted through PUBLIC', async () => {
    await expect(
      inspectTopicSyncPreflight(await preflightClient({ defaultPrivilegeCount: 1 }), expected),
    ).rejects.toThrow(/must not receive future table or sequence default privileges/);
  });

  it('rejects executable SECURITY DEFINER routines and access outside public', async () => {
    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          securityDefinerRoutines: [
            {
              schema_name: 'private_tools',
              name: 'elevate_topic_sync',
              identity_arguments: '',
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/must not execute SECURITY DEFINER routines/);

    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
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
      inspectTopicSyncPreflight(
        await preflightClient({
          extraPrivileges: [
            {
              schema_name: 'private_data',
              table_name: 'secrets',
              privilege: 'SELECT',
              granted: true,
              grantable: false,
            },
          ],
        }),
        expected,
      ),
    ).rejects.toThrow(/private_data\.secrets:SELECT/);

    await expect(
      inspectTopicSyncPreflight(
        await preflightClient({
          ownedObjects: [{ object_type: 'type', schema_name: 'private_data', name: 'secret_type' }],
        }),
        expected,
      ),
    ).rejects.toThrow(/type:private_data\.secret_type/);
  });

  it('rejects pooler endpoints for production synchronization', () => {
    expect(() => assertDirectTopicSyncEndpoint('ep-example-pooler.eu.neon.tech')).toThrow(
      /direct\/session endpoint/,
    );
    expect(() => assertDirectTopicSyncEndpoint('pooler.example.com')).toThrow(
      /direct\/session endpoint/,
    );
    expect(() => assertDirectTopicSyncEndpoint('ep-example.eu.neon.tech')).not.toThrow();
  });

  it('reserves the reviewed production identity for the dedicated sync role', async () => {
    await expect(
      inspectTopicSyncPreflight(
        {},
        {
          ...expected,
          expectedUser: 'hzense_migrator',
          expectedHost: 'ep-example.eu.neon.tech',
          profile: 'production',
        },
      ),
    ).rejects.toThrow(/must authenticate as hzense_topic_sync/);
  });
});
