import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localMigrationOptions } from '../../../scripts/local-database-bootstrap.mjs';
import { shouldAdoptFoundation } from '../src/migrate.mjs';
import {
  assertLocalCluster,
  assertLocalDatabaseContainer,
  assertLocalDatabaseExecution,
  assertLocalDockerContext,
  composeArguments,
  loadLocalDatabaseCredentials,
  localDatabaseEnvironment,
  localDatabaseImage,
  localDatabaseBaseRoles,
  localDatabaseBackendRoles,
  localDatabaseV2BackendRoles,
  localDatabaseProject,
  localDatabaseServiceEnvironment,
  localDatabaseUrl,
  main,
  parseLocalDatabaseArguments,
  upgradeLocalDatabaseCredentials,
  validateLocalDatabaseCredentials,
} from '../../../scripts/local-database.mjs';
import {
  assertLocalBackendTarget,
  localBackendRolePlan,
  localCandidateEnrichmentGrants,
  localAutomationGrants,
  localRoleVerificationBlock,
  prepareLocalAutomationAdmin,
  prepareLocalBackendRoles,
  prepareLocalCandidateEnrichment,
} from '../../../scripts/local-database-backend.mjs';
import { candidateEnrichmentRoleColumns } from '../src/signal-generation-role-columns.mjs';
import { automationRoleColumns, automationUpdateColumns } from '../src/automation-role.mjs';
import {
  candidateEnrichmentRoleCheckSQL,
  generationRoleCheckSQL,
} from '../src/signal-generation-role-check.mjs';

const directories = [];
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'hzense-local-database-test-'));
  directories.push(root);
  return root;
};
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const context = [
  { Name: 'desktop-linux', Endpoints: { docker: { Host: 'unix:///private/tmp/docker.sock' } } },
];
function container(root, test = false) {
  const bindings = [{ HostIp: '127.0.0.1', HostPort: test ? '55433' : '55432' }];
  return [
    {
      State: { Running: true },
      Config: {
        Image: localDatabaseImage,
        Cmd: ['postgres', '-c', `cluster_name=hzense-local-${test ? 'test' : 'development'}`],
        Labels: {
          'com.docker.compose.project': localDatabaseProject(root),
          'com.docker.compose.service': test ? 'postgres-test' : 'postgres',
          'com.docker.compose.project.working_dir': root,
        },
      },
      HostConfig: {
        Tmpfs: test ? { '/var/lib/postgresql': 'size=2147483648' } : {},
        PortBindings: { '5432/tcp': bindings },
      },
      NetworkSettings: { Ports: { '5432/tcp': bindings } },
      Mounts: test
        ? []
        : [
            {
              Type: 'volume',
              Destination: '/var/lib/postgresql',
              Name: `${localDatabaseProject(root)}_development_data`,
            },
          ],
    },
  ];
}

function client({ test = false, databases = [] } = {}) {
  return {
    connect: async () => {},
    end: async () => {},
    query: async (sql) =>
      sql.includes('current_setting')
        ? {
            rows: [
              {
                database: 'postgres',
                role: 'postgres',
                cluster: test ? 'hzense-local-test' : 'hzense-local-development',
                version: 180000,
              },
            ],
          }
        : { rows: databases.map((datname) => ({ datname })) },
  };
}

describe('local development database safety', () => {
  it('accepts only explicit safe operations, without reset/down or target overrides', () => {
    for (const op of ['doctor', 'up', 'stop', 'init', 'verify', 'test'])
      expect(parseLocalDatabaseArguments([op])).toBe(op);
    for (const args of [[], ['reset'], ['down'], ['init', '--url=postgresql://private']])
      expect(() => parseLocalDatabaseArguments(args)).toThrow();
  });

  it('refuses deployed contexts and strips cloud and production database credentials', () => {
    for (const key of [
      'CI',
      'VERCEL',
      'VERCEL_URL',
      'VERCEL_DEPLOYMENT_ID',
      'VERCEL_PROJECT_ID',
      'GITHUB_ACTIONS',
      'AWS_LAMBDA_FUNCTION_NAME',
    ])
      expect(() => assertLocalDatabaseExecution({ [key]: '1' })).toThrow();
    expect(() => assertLocalDatabaseExecution({ NODE_ENV: 'production' })).toThrow();
    expect(() => assertLocalDatabaseExecution({ VERCEL_ENV: 'preview' })).toThrow();
    expect(
      localDatabaseEnvironment({
        PATH: '/bin',
        HOME: '/local-user',
        DATABASE_URL: 'private',
        DOCKER_HOST: 'tcp://remote',
        DOCKER_CONTEXT: 'remote',
        NODE_OPTIONS: '--require private',
        OPENAI_API_KEY: 'private',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/local-user' });
  });

  it('accepts only a local Unix socket context and pins every Compose invocation', () => {
    expect(assertLocalDockerContext(context)).toBe('desktop-linux');
    for (const host of [
      'ssh://server',
      'tcp://127.0.0.1:2375',
      'tcp://remote:2376',
      'unix://relative.sock',
      'unix:///tmp/a.sock?x',
    ]) {
      expect(() =>
        assertLocalDockerContext([{ ...context[0], Endpoints: { docker: { Host: host } } }]),
      ).toThrow();
    }
    const args = composeArguments('desktop-linux', ['up', '-d', '--wait', 'postgres'], {
      root: '/project',
    });
    expect(args).toContain('/dev/null');
    expect(args).toContain('/project/compose.local.yml');
    expect(args).not.toContain('--profile');
    expect(
      composeArguments('desktop-linux', ['up', 'postgres-test'], { root: '/project', test: true }),
    ).toContain('--profile');
  });

  it('requires matching workspace, pinned image, loopback ports and isolated storage', () => {
    expect(assertLocalDatabaseContainer(container('/project'), { root: '/project' })).toBe(true);
    expect(
      assertLocalDatabaseContainer(container('/project', true), { root: '/project', test: true }),
    ).toBe(true);
    const wrongPort = container('/project');
    wrongPort[0].NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0';
    expect(() => assertLocalDatabaseContainer(wrongPort, { root: '/project' })).toThrow();
    const wrongVolume = container('/project');
    wrongVolume[0].Mounts[0].Name = 'unrelated';
    expect(() => assertLocalDatabaseContainer(wrongVolume, { root: '/project' })).toThrow();
    const mountedDev = container('/project', true);
    mountedDev[0].Mounts = container('/project')[0].Mounts;
    expect(() =>
      assertLocalDatabaseContainer(mountedDev, { root: '/project', test: true }),
    ).toThrow();
    const otherImage = container('/project');
    otherImage[0].Config.Image = 'postgres:latest';
    expect(() => assertLocalDatabaseContainer(otherImage, { root: '/project' })).toThrow();
  });

  it('generates private credentials once and keeps dev/test passwords and targets separate', async () => {
    const root = await temporaryRoot();
    const credentials = await loadLocalDatabaseCredentials({ root, create: true });
    expect(await loadLocalDatabaseCredentials({ root, create: true })).toEqual(credentials);
    const dev = new URL(localDatabaseUrl(credentials, 'postgres'));
    const test = new URL(localDatabaseUrl(credentials, 'postgres', { test: true }));
    expect([dev.hostname, dev.port, dev.pathname]).toEqual(['127.0.0.1', '55432', '/postgres']);
    expect([test.hostname, test.port, test.pathname]).toEqual(['127.0.0.1', '55433', '/postgres']);
    expect(dev.password).not.toEqual(test.password);
    const env = localDatabaseServiceEnvironment(credentials);
    expect(new URL(env.HZENSE_RUNTIME_DATABASE_URL).username).toBe('hzense_runtime');
    expect(env.HZENSE_RUNTIME_EXPECTED_NAME).toBe('hzense_local');
    expect(JSON.stringify(env)).not.toContain(credentials.roles.hzense_local_owner);
    expect(() => localDatabaseUrl(credentials, 'hzense_local_owner', { test: true })).toThrow();
    expect(() => localDatabaseUrl(credentials, 'unknown')).toThrow();
    const services = {
      HZENSE_AI_DATABASE_URL: 'hzense_ai_admin',
      HZENSE_IMPORT_DATABASE_URL: 'hzense_import_admin',
      HZENSE_GENERATION_DATABASE_URL: 'hzense_generation_admin',
      HZENSE_REVIEW_DATABASE_URL: 'hzense_candidate_reviewer',
      HZENSE_SIGNAL_ADMIN_DATABASE_URL: 'hzense_signal_admin_reader',
      HZENSE_AUTOMATION_DATABASE_URL: 'hzense_automation_admin',
    };
    for (const [key, role] of Object.entries(services)) {
      const url = new URL(env[key]);
      expect([url.username, url.hostname, url.port, url.pathname, url.search]).toEqual([
        role,
        '127.0.0.1',
        '55432',
        '/hzense_local',
        '',
      ]);
    }
    expect(JSON.parse(env.HZENSE_AI_KEYRING)).toEqual(credentials.aiKeyring);
    expect(credentials.version).toBe(3);
  });

  it('upgrades version 1 credentials without rotating passwords, keys or changing data', async () => {
    const root = await temporaryRoot();
    const initial = await loadLocalDatabaseCredentials({ root, create: true });
    const legacy = {
      version: 1,
      developmentPassword: initial.developmentPassword,
      testPassword: initial.testPassword,
      roles: Object.fromEntries(localDatabaseBaseRoles.map((role) => [role, initial.roles[role]])),
    };
    const path = join(root, '.hzense-local/database.json');
    await writeFile(path, JSON.stringify(legacy), { mode: 0o600 });
    expect(await loadLocalDatabaseCredentials({ root })).toEqual(legacy);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(legacy);
    expect(localDatabaseServiceEnvironment(legacy).HZENSE_AI_DATABASE_URL).toBeUndefined();
    expect(() => localDatabaseUrl(legacy, 'hzense_ai_admin')).toThrow(/初始化/);
    const upgraded = await loadLocalDatabaseCredentials({ root, create: true });
    expect(upgraded.version).toBe(3);
    expect(upgraded.developmentPassword).toBe(legacy.developmentPassword);
    expect(upgraded.testPassword).toBe(legacy.testPassword);
    for (const role of localDatabaseBaseRoles)
      expect(upgraded.roles[role]).toBe(legacy.roles[role]);
    for (const role of localDatabaseBackendRoles)
      expect(upgraded.roles[role]).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadLocalDatabaseCredentials({ root, create: true })).toEqual(upgraded);
    expect(upgradeLocalDatabaseCredentials(upgraded)).toBe(upgraded);
  });

  it('adds only the automation credential to version 2 and preserves all prior encryption material', async () => {
    const root = await temporaryRoot();
    const initial = await loadLocalDatabaseCredentials({ root, create: true });
    const legacy = {
      ...initial,
      version: 2,
      roles: Object.fromEntries(
        [...localDatabaseBaseRoles, ...localDatabaseV2BackendRoles].map((role) => [
          role,
          initial.roles[role],
        ]),
      ),
    };
    const path = join(root, '.hzense-local/database.json');
    await writeFile(path, JSON.stringify(legacy), { mode: 0o600 });
    expect(await loadLocalDatabaseCredentials({ root })).toEqual(legacy);
    expect(localDatabaseServiceEnvironment(legacy).HZENSE_AUTOMATION_DATABASE_URL).toBeUndefined();
    expect(() => localDatabaseUrl(legacy, 'hzense_automation_admin')).toThrow(/初始化/);
    const upgraded = await loadLocalDatabaseCredentials({ root, create: true });
    expect(upgraded.version).toBe(3);
    expect(upgraded.developmentPassword).toBe(legacy.developmentPassword);
    expect(upgraded.testPassword).toBe(legacy.testPassword);
    expect(upgraded.aiKeyring).toEqual(legacy.aiKeyring);
    for (const [role, password] of Object.entries(legacy.roles))
      expect(upgraded.roles[role]).toBe(password);
    expect(upgraded.roles.hzense_automation_admin).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadLocalDatabaseCredentials({ root, create: true })).toEqual(upgraded);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(upgraded);
  });

  it('rejects malformed or partial backend credentials instead of regenerating encryption keys', async () => {
    const root = await temporaryRoot();
    const valid = await loadLocalDatabaseCredentials({ root, create: true });
    for (const change of [
      { version: 4 },
      { roles: { ...valid.roles, extra: '0'.repeat(64) } },
      { roles: { ...valid.roles, hzense_ai_admin: undefined } },
      { roles: { ...valid.roles, hzense_automation_admin: undefined } },
      { aiKeyring: { active: 'local-v2', keys: valid.aiKeyring.keys } },
      { aiKeyring: { active: 'local-v1', keys: { 'local-v1': 'not-a-key' } } },
    ])
      expect(() => validateLocalDatabaseCredentials({ ...valid, ...change })).toThrow();
    await writeFile(
      join(root, '.hzense-local/database.json'),
      JSON.stringify({ ...valid, aiKeyring: null }),
      { mode: 0o600 },
    );
    await expect(loadLocalDatabaseCredentials({ root, create: true })).rejects.toThrow(/密钥/);
  });

  it('rejects symlinked credential directories without following or overwriting them', async () => {
    const root = await temporaryRoot();
    const target = await temporaryRoot();
    await symlink(target, join(root, '.hzense-local'));
    await expect(loadLocalDatabaseCredentials({ root, create: true })).rejects.toThrow(/符号链接/);
  });

  it('refuses unknown databases and a development cluster in the test entry point', async () => {
    await expect(assertLocalCluster(client({ databases: ['hzense_local'] }))).resolves.toBe(true);
    await expect(assertLocalCluster(client({ databases: ['customer_data'] }))).rejects.toThrow(
      /未知/,
    );
    await expect(
      assertLocalCluster(client({ test: true, databases: ['hzense_local'] }), { test: true }),
    ).rejects.toThrow(/未知/);
    await expect(assertLocalCluster(client(), { test: true })).rejects.toThrow();
  });

  it('doctor is read-only, with no secret files, startup, migrations or data calls', async () => {
    const calls = [];
    await main({
      args: ['doctor'],
      environment: { PATH: '/bin', DATABASE_URL: 'private' },
      log: () => {},
      run: async (command, args, options) => {
        calls.push({ command, args, options });
        return args[0] === 'context' ? JSON.stringify(context) : 'ok';
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.options.capture && !call.options.env.DATABASE_URL)).toBe(
      true,
    );
  });

  it('runs init and repeated init/verify in isolated child processes without secret arguments', async () => {
    const root = await temporaryRoot();
    const credentials = await loadLocalDatabaseCredentials({ root, create: true });
    const calls = [];
    const run = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'context') return JSON.stringify(context);
      if (args.includes('ps')) return 'b'.repeat(64);
      if (args.includes('inspect')) return JSON.stringify(container(root));
      return '';
    };
    for (const operation of ['init', 'init', 'verify']) {
      await main({
        args: [operation],
        root,
        run,
        log: () => {},
        environment: {
          PATH: '/local/bin',
          HOME: '/local-user',
          DATABASE_URL: 'production',
          HZENSE_DATABASE_BASELINE_CHECKSUM: 'production-baseline',
          PGSSLMODE: 'require',
          PGOPTIONS: '-c role=production',
          NODE_OPTIONS: '--require private',
        },
      });
    }
    const children = calls.filter(({ args }) => args[0].endsWith('local-database-bootstrap.mjs'));
    expect(children.map(({ args }) => args[1])).toEqual(['init', 'init', 'verify']);
    for (const child of children) {
      expect(child.options).toEqual({
        cwd: root,
        env: { PATH: '/local/bin', HOME: '/local-user' },
      });
      expect(child.args).toHaveLength(2);
      expect(JSON.stringify(child)).not.toContain(credentials.developmentPassword);
      expect(JSON.stringify(child)).not.toContain(credentials.roles.hzense_local_owner);
    }
    expect(calls.filter(({ args }) => args[2] === 'inspect')).toHaveLength(3);
  });

  it('cannot reach the bootstrap subprocess before the container identity guard passes', async () => {
    const root = await temporaryRoot();
    await loadLocalDatabaseCredentials({ root, create: true });
    const calls = [];
    await expect(
      main({
        args: ['init'],
        root,
        environment: {},
        log: () => {},
        run: async (_command, args) => {
          calls.push(args);
          if (args[0] === 'context') return JSON.stringify(context);
          if (args.includes('ps')) return 'b'.repeat(64);
          if (args.includes('inspect')) return JSON.stringify(container('/unrelated'));
          return '';
        },
      }),
    ).rejects.toThrow(/不匹配/);
    expect(calls.some((args) => args[0].endsWith('local-database-bootstrap.mjs'))).toBe(false);
  });

  it('explicitly refuses inherited production baseline adoption for a fresh local database', async () => {
    vi.stubEnv('HZENSE_DATABASE_BASELINE_CHECKSUM', 'production-baseline');
    const root = await temporaryRoot();
    const credentials = await loadLocalDatabaseCredentials({ root, create: true });
    const options = localMigrationOptions(credentials);
    expect(options.baselineChecksum).toBeNull();
    expect(new URL(options.connectionString).hostname).toBe('127.0.0.1');
    expect(
      shouldAdoptFoundation({ state: 'absent', problems: [] }, options.baselineChecksum, {
        checksum: 'production-baseline',
      }),
    ).toBe(false);
    expect(() =>
      shouldAdoptFoundation({ state: 'complete', problems: [] }, options.baselineChecksum, {
        name: '0000_foundation.sql',
        checksum: 'production-baseline',
      }),
    ).toThrow(/untracked foundation/);
  });

  it('does not delete an existing or identity-mismatched test container', async () => {
    for (const existing of [true, false]) {
      const root = await temporaryRoot();
      const calls = [];
      const run = async (_command, args) => {
        calls.push(args);
        if (args[0] === 'context') return JSON.stringify(context);
        if (args.includes('ps'))
          return args.includes('-a') ? (existing ? 'a'.repeat(64) : '') : 'b'.repeat(64);
        if (args.includes('inspect')) return JSON.stringify(container('/wrong-project', true));
        return '';
      };
      await expect(
        main({ args: ['test'], root, environment: {}, run, log: () => {} }),
      ).rejects.toThrow();
      expect(calls.some((args) => args.includes('rm'))).toBe(false);
    }
  });

  it('cleans only its validated temporary test container when integration tests fail', async () => {
    const root = await temporaryRoot();
    const calls = [];
    let identityOptions;
    vi.stubEnv('PGSSLMODE', 'require');
    vi.stubEnv('PGSSLNEGOTIATION', 'direct');
    vi.stubEnv('PGOPTIONS', '-c role=production');
    vi.stubEnv('PGREPLICATION', 'true');
    const run = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'context') return JSON.stringify(context);
      if (args.includes('ps')) return args.includes('-a') ? '' : 'b'.repeat(64);
      if (args.includes('inspect')) return JSON.stringify(container(root, true));
      if (args.includes('test:migrations')) throw new Error('synthetic test failure');
      return '';
    };
    await expect(
      main({
        args: ['test'],
        root,
        environment: { DATABASE_URL: 'production' },
        run,
        testClientFactory: (options) => {
          identityOptions = options;
          return client({ test: true });
        },
        log: () => {},
      }),
    ).rejects.toThrow('synthetic');
    expect(identityOptions).toMatchObject({
      connectionTimeoutMillis: 5000,
      ssl: false,
      sslnegotiation: 'postgres',
      options: '-c search_path=pg_catalog,public',
      replication: 'false',
      application_name: 'hzense-local-test-identity',
    });
    const { Client } = createRequire(new URL('../package.json', import.meta.url))('pg');
    // Construct only: no real connection, while verifying pg's actual environment fallback.
    const parameters = new Client(identityOptions).connectionParameters;
    expect(parameters.ssl).toBe(false);
    expect(parameters.sslnegotiation).toBe('postgres');
    expect(parameters.options).toBe('-c search_path=pg_catalog,public');
    expect(parameters.replication).toBe('false');
    expect([parameters.host, parameters.port, parameters.database, parameters.user]).toEqual([
      '127.0.0.1',
      55433,
      'postgres',
      'postgres',
    ]);
    const testRun = calls.find(({ args }) => args.includes('test:migrations'));
    expect(new URL(testRun.options.env.MIGRATION_TEST_ADMIN_URL).port).toBe('55433');
    expect(testRun.options.capture).toBe(true);
    expect(testRun.options.env.DATABASE_URL).toBeUndefined();
    expect(calls.at(-1).args).toEqual([
      '--context',
      'desktop-linux',
      'rm',
      '--force',
      'b'.repeat(64),
    ]);
    expect(calls.every(({ args }) => !args.includes('-v') && !args.includes('down'))).toBe(true);
  });

  it('Compose pins the CI image, uses loopback only and keeps tests out of the dev volume', async () => {
    const yaml = createRequire(new URL('../../content/package.json', import.meta.url))('yaml');
    const compose = yaml.parse(
      await readFile(new URL('../../../compose.local.yml', import.meta.url), 'utf8'),
    );
    const ci = await readFile(
      new URL('../../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    expect(ci).toContain(localDatabaseImage);
    expect(compose.services.postgres.image).toBe(localDatabaseImage);
    expect(compose.services.postgres.ports).toEqual(['127.0.0.1:55432:5432']);
    expect(compose.services['postgres-test'].ports).toEqual(['127.0.0.1:55433:5432']);
    expect(compose.services['postgres-test'].profiles).toEqual(['test']);
    expect(compose.services['postgres-test'].volumes).toBeUndefined();
    expect(compose.services['postgres-test'].tmpfs).toHaveLength(1);
    expect(compose.services.postgres.environment.POSTGRES_PASSWORD).toBeUndefined();
  });
});

describe('local backend role bootstrap contracts', () => {
  const target = {
    database: 'hzense_local',
    role: 'hzense_local_owner',
    session: 'hzense_local_owner',
    owner: 'hzense_local_owner',
    cluster: 'hzense-local-development',
  };
  it('refuses production, test clusters and impersonated owners', async () => {
    for (const change of [
      { database: 'hzense' },
      { cluster: 'hzense-local-test' },
      { role: 'postgres' },
      { session: 'postgres' },
      { owner: 'unrelated' },
    ])
      await expect(
        assertLocalBackendTarget({ query: async () => ({ rows: [{ ...target, ...change }] }) }),
      ).rejects.toThrow(/本地/);
    await expect(
      assertLocalBackendTarget({ query: async () => ({ rows: [target] }) }),
    ).resolves.toBeUndefined();
  });

  it('reuses unchanged exact post-grant checks and the existing enrichment column matrix', async () => {
    expect(localBackendRolePlan.map(({ role }) => role)).toEqual(localDatabaseBackendRoles);
    for (const descriptor of localBackendRolePlan.filter(({ verifyTag }) => verifyTag)) {
      const sql = await readFile(
        new URL(`../../../db/roles/${descriptor.file}`, import.meta.url),
        'utf8',
      );
      const block = localRoleVerificationBlock(sql, descriptor.verifyTag);
      expect(block).toContain(`DO $${descriptor.verifyTag}$`);
      expect(block).not.toMatch(/^\s*(?:GRANT|REVOKE|CREATE|ALTER|COMMIT)\b/m);
      expect(() => localRoleVerificationBlock(sql + '\n' + block, descriptor.verifyTag)).toThrow();
      expect(() => localRoleVerificationBlock('', descriptor.verifyTag)).toThrow();
    }
    expect(() => localRoleVerificationBlock('', 'unsafe')).toThrow();
    for (const [privilege, columns] of Object.entries(candidateEnrichmentRoleColumns))
      expect(localCandidateEnrichmentGrants).toContain(
        `GRANT ${privilege}(${columns.join(',')}) ON public.candidate_enrichment_runs TO hzense_generation_admin;`,
      );
    expect(localCandidateEnrichmentGrants).not.toMatch(/ALL|DELETE|TRUNCATE|WITH GRANT OPTION/);
  });

  it('only upgrades an exact generation ACL baseline and rolls back drift', async () => {
    for (const baseline of [true, false]) {
      const calls = [];
      let after = false;
      const fake = {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes('current_setting')) return { rows: [target] };
          if (sql.includes('pg_try_advisory')) return { rows: [{ locked: true }] };
          if (sql === candidateEnrichmentRoleCheckSQL) return { rows: [{ safe: after }] };
          if (sql === generationRoleCheckSQL) return { rows: [{ safe: baseline }] };
          if (sql === localCandidateEnrichmentGrants) after = true;
          return { rows: [] };
        },
      };
      if (baseline) {
        await prepareLocalCandidateEnrichment(fake);
        expect(calls.at(-1)).toBe('COMMIT');
        expect(calls).toContain(localCandidateEnrichmentGrants);
      } else {
        await expect(prepareLocalCandidateEnrichment(fake)).rejects.toThrow(/基线/);
        expect(calls.at(-1)).toBe('ROLLBACK');
        expect(calls).not.toContain(localCandidateEnrichmentGrants);
      }
    }
  });

  it('uses exact automation columns and rolls back if the unchanged production ACL audit fails', async () => {
    const sql = await readFile(
      new URL('../../../db/roles/configure_automation_config_admin.sql', import.meta.url),
      'utf8',
    );
    const audit = localRoleVerificationBlock(sql, 'verify_acl');
    expect(audit).not.toMatch(/^\s*(?:GRANT|REVOKE|CREATE|ALTER|COMMIT)\b/m);
    for (const [table, columns] of Object.entries(automationRoleColumns)) {
      expect(localAutomationGrants).toContain(
        `GRANT SELECT(${columns.join(',')}), INSERT(${columns.join(',')}), UPDATE(${automationUpdateColumns[table].join(',')}) ON public.${table} TO hzense_automation_admin;`,
      );
    }
    expect(localAutomationGrants).not.toMatch(
      /ALL|DELETE|TRUNCATE|WITH GRANT OPTION|hzense_insight_reader/,
    );
    for (const auditFails of [false, true]) {
      const calls = [];
      const fake = {
        query: async (statement) => {
          calls.push(statement);
          if (statement.includes('current_setting')) return { rows: [target] };
          if (statement.includes('pg_try_advisory')) return { rows: [{ locked: true }] };
          if (statement === audit && auditFails) throw new Error('unsafe ambient grant');
          return { rows: [] };
        },
      };
      if (auditFails)
        await expect(prepareLocalAutomationAdmin(fake)).rejects.toThrow(/unsafe ambient/);
      else await prepareLocalAutomationAdmin(fake);
      expect(calls).toContain(localAutomationGrants);
      expect(calls).toContain(audit);
      expect(calls.at(-1)).toBe(auditFails ? 'ROLLBACK' : 'COMMIT');
    }
  });

  it('adds only the missing local automation role and preserves existing role passwords on repeated initialization', async () => {
    const credentials = upgradeLocalDatabaseCredentials({
      version: 1,
      developmentPassword: 'a'.repeat(64),
      testPassword: 'b'.repeat(64),
      roles: Object.fromEntries(localDatabaseBaseRoles.map((role) => [role, 'c'.repeat(64)])),
    });
    const marker = `HZense isolated local development v1 ${createHash('sha256').update(credentials.developmentPassword).digest('hex')}`;
    const role = {
      rolcanlogin: true,
      rolsuper: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: 2,
      rolconfig: null,
      membership: false,
      settings: false,
      ownership: false,
      acl: true,
      marker,
    };
    const known = new Map(localDatabaseV2BackendRoles.map((name) => [name, { ...role }]));
    const calls = [];
    const admin = {
      query: async (statement, parameters) => {
        calls.push(statement);
        if (statement.includes("current_setting('cluster_name')"))
          return {
            rows: [
              {
                database: 'postgres',
                role: 'postgres',
                cluster: 'hzense-local-development',
                version: 180000,
              },
            ],
          };
        if (statement.includes('SELECT datname')) return { rows: [{ datname: 'hzense_local' }] };
        if (statement.includes('FROM pg_roles r WHERE rolname=$1'))
          return { rows: known.has(parameters[0]) ? [known.get(parameters[0])] : [] };
        if (statement.startsWith('CREATE ROLE'))
          known.set('hzense_automation_admin', { ...role, acl: false });
        return { rows: [] };
      },
    };
    const client = {
      query: async (statement) => {
        calls.push(statement);
        if (statement.includes('current_setting')) return { rows: [target] };
        if (statement.includes('SELECT pg_try_advisory')) return { rows: [{ locked: true }] };
        if (statement === candidateEnrichmentRoleCheckSQL) return { rows: [{ safe: true }] };
        if (statement === localAutomationGrants) known.get('hzense_automation_admin').acl = true;
        return { rows: [] };
      },
    };
    await prepareLocalBackendRoles({ admin, client, credentials });
    await prepareLocalBackendRoles({ admin, client, credentials });
    expect(calls.filter((sql) => sql.startsWith('CREATE ROLE'))).toHaveLength(1);
    expect(calls.find((sql) => sql.startsWith('CREATE ROLE'))).toContain(
      '"hzense_automation_admin"',
    );
    expect(calls.filter((sql) => sql === localAutomationGrants)).toHaveLength(1);
    expect(calls.join('\n')).not.toMatch(/ALTER ROLE.*PASSWORD|DROP ROLE|hzense_insight_reader/);
  });
});
