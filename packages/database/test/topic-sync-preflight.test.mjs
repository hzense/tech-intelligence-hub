import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../src/migrate.mjs';
import {
  assertDirectTopicSyncEndpoint,
  inspectTopicSyncPreflight,
} from '../src/topic-sync-preflight.mjs';
import { expectedTableNames } from '../src/verify.mjs';

const expected = {
  expectedDatabase: 'hzense',
  expectedUser: 'hzense_topic_sync',
  expectedPostgresMajor: 18,
  expectedConnectionLimit: 2,
  profile: 'local-test',
};

async function preflightClient({
  topicPrivileges = ['SELECT', 'INSERT', 'UPDATE'],
  extraRelations = [],
  rewriteRuleCount = 0,
  extraPrivileges = [],
  columnPrivileges = [],
  defaultPrivilegeCount = 0,
  extraSchemaPrivileges = [],
  ownedObjects = [],
  securityDefinerRoutines = [],
} = {}) {
  const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
  const query = vi.fn(async (sql) => {
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
            read_only: false,
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
