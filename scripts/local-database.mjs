import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

export const localDatabaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const localDatabaseImage =
  'mirror.gcr.io/pgvector/pgvector:0.8.6-pg18-bookworm@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a';
export const localDatabaseBaseRoles = Object.freeze([
  'hzense_local_owner',
  'hzense_runtime',
  'hzense_editorial_writer',
  'hzense_editorial_reader',
]);
export const localDatabaseV2BackendRoles = Object.freeze([
  'hzense_ai_admin',
  'hzense_import_admin',
  'hzense_generation_admin',
  'hzense_candidate_reviewer',
  'hzense_signal_admin_reader',
]);
export const localDatabaseBackendRoles = Object.freeze([
  ...localDatabaseV2BackendRoles,
  'hzense_automation_admin',
]);
export const localDatabaseRoles = Object.freeze([
  ...localDatabaseBaseRoles,
  ...localDatabaseBackendRoles,
]);
const operations = new Set(['doctor', 'up', 'stop', 'init', 'verify', 'test']);
const systemKeys = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
];

export class LocalDatabaseError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LocalDatabaseError';
    this.code = code;
  }
}
const fail = (code) => {
  throw new LocalDatabaseError(code);
};

export function parseLocalDatabaseArguments(args) {
  if (args.length !== 1 || !operations.has(args[0]))
    fail('用法：local-database.mjs doctor|up|stop|init|verify|test');
  return args[0];
}

export function assertLocalDatabaseExecution(environment) {
  if (
    environment.NODE_ENV === 'production' ||
    environment.CI ||
    environment.VERCEL ||
    environment.VERCEL_URL ||
    environment.VERCEL_DEPLOYMENT_ID ||
    environment.VERCEL_PROJECT_ID ||
    environment.AWS_LAMBDA_FUNCTION_NAME ||
    (environment.VERCEL_ENV && environment.VERCEL_ENV !== 'development') ||
    environment.GITHUB_ACTIONS
  )
    fail('拒绝在生产、部署或 CI 环境运行本地数据库命令');
}

export function localDatabaseEnvironment(environment = process.env) {
  assertLocalDatabaseExecution(environment);
  return Object.fromEntries(
    systemKeys.filter((key) => environment[key]).map((key) => [key, environment[key]]),
  );
}

export function localDatabaseProject(root = localDatabaseRoot) {
  return `hzense-local-${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12)}`;
}

export function assertLocalDockerContext(value) {
  if (!Array.isArray(value) || value.length !== 1) fail('Docker context 无效');
  const context = value[0];
  const host = context?.Endpoints?.docker?.Host;
  if (typeof context?.Name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(context.Name))
    fail('Docker context 名称无效');
  if (typeof host !== 'string' || !/^unix:\/\/\/[^\r\n?#]+\.sock$/.test(host))
    fail('仅允许本机 Unix socket Docker context，拒绝 TCP、SSH 和远程 Docker');
  return context.Name;
}

export function composeArguments(
  context,
  operation,
  { root = localDatabaseRoot, test = false } = {},
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(context)) fail('Docker context 名称无效');
  return [
    '--context',
    context,
    'compose',
    '--project-name',
    localDatabaseProject(root),
    '--project-directory',
    resolve(root),
    '--env-file',
    '/dev/null',
    '--file',
    resolve(root, 'compose.local.yml'),
    ...(test ? ['--profile', 'test'] : []),
    ...operation,
  ];
}

export function assertLocalDatabaseContainer(
  value,
  { root = localDatabaseRoot, test = false, requireRunning = true } = {},
) {
  if (!Array.isArray(value) || value.length !== 1) fail('未找到唯一的本地数据库容器');
  const container = value[0];
  const service = test ? 'postgres-test' : 'postgres';
  const ports = requireRunning
    ? container.NetworkSettings?.Ports?.['5432/tcp']
    : container.HostConfig?.PortBindings?.['5432/tcp'];
  if (
    (requireRunning && container.State?.Running !== true) ||
    container.Config?.Image !== localDatabaseImage ||
    container.Config?.Labels?.['com.docker.compose.project'] !== localDatabaseProject(root) ||
    container.Config?.Labels?.['com.docker.compose.service'] !== service ||
    container.Config?.Labels?.['com.docker.compose.project.working_dir'] !== resolve(root) ||
    !Array.isArray(ports) ||
    ports.length !== 1 ||
    ports[0].HostIp !== '127.0.0.1' ||
    ports[0].HostPort !== (test ? '55433' : '55432')
  )
    fail('本地容器、镜像、工作区或回环端口不匹配，停止操作');
  const expectedCluster = test ? 'hzense-local-test' : 'hzense-local-development';
  if (
    JSON.stringify(container.Config?.Cmd) !==
    JSON.stringify(['postgres', '-c', `cluster_name=${expectedCluster}`])
  )
    fail('本地数据库容器启动参数不匹配');
  const dataMounts = (container.Mounts ?? []).filter(
    (mount) =>
      mount.Destination === '/var/lib/postgresql' ||
      mount.Destination?.startsWith('/var/lib/postgresql/'),
  );
  if (test) {
    if (
      !Object.hasOwn(container.HostConfig?.Tmpfs ?? {}, '/var/lib/postgresql') ||
      dataMounts.some((mount) => mount.Type !== 'tmpfs') ||
      (container.Mounts ?? []).some((mount) => mount.Type === 'volume')
    )
      fail('测试数据库必须使用临时内存存储，不能挂载开发或持久数据卷');
  } else if (
    dataMounts.length !== 1 ||
    dataMounts[0].Type !== 'volume' ||
    dataMounts[0].Name !== `${localDatabaseProject(root)}_development_data`
  ) {
    fail('开发数据库命名卷不匹配，停止操作');
  }
  return true;
}

export function validateLocalDatabaseCredentials(value) {
  const roles =
    value?.version === 1
      ? localDatabaseBaseRoles
      : value?.version === 2
        ? [...localDatabaseBaseRoles, ...localDatabaseV2BackendRoles]
        : localDatabaseRoles;
  const keys =
    value?.version === 1
      ? ['version', 'developmentPassword', 'testPassword', 'roles']
      : ['version', 'developmentPassword', 'testPassword', 'roles', 'aiKeyring'];
  if (
    ![1, 2, 3].includes(value?.version) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',') ||
    !/^[a-f0-9]{64}$/.test(value?.developmentPassword ?? '') ||
    !/^[a-f0-9]{64}$/.test(value?.testPassword ?? '') ||
    !value?.roles ||
    Object.keys(value.roles).sort().join(',') !== [...roles].sort().join(',') ||
    roles.some((role) => !/^[a-f0-9]{64}$/.test(value.roles[role] ?? ''))
  )
    fail('本地数据库凭据文件格式无效；不会重置现有密码或数据卷');
  if (
    value.version >= 2 &&
    (value.aiKeyring?.active !== 'local-v1' ||
      Object.keys(value.aiKeyring?.keys ?? {}).join(',') !== 'local-v1' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value.aiKeyring.keys['local-v1']) ||
      Buffer.from(value.aiKeyring.keys['local-v1'], 'base64').length !== 32 ||
      Buffer.from(value.aiKeyring.keys['local-v1'], 'base64').toString('base64') !==
        value.aiKeyring.keys['local-v1'])
  )
    fail('本地 AI 加密密钥格式无效；不会生成新密钥覆盖已有配置');
  return value;
}

export function upgradeLocalDatabaseCredentials(value) {
  validateLocalDatabaseCredentials(value);
  if (value.version === 3) return value;
  return validateLocalDatabaseCredentials({
    ...value,
    version: 3,
    roles: {
      ...value.roles,
      ...Object.fromEntries(
        localDatabaseBackendRoles
          .filter((role) => !Object.hasOwn(value.roles, role))
          .map((role) => [role, randomBytes(32).toString('hex')]),
      ),
    },
    aiKeyring: value.aiKeyring ?? {
      active: 'local-v1',
      keys: { 'local-v1': randomBytes(32).toString('base64') },
    },
  });
}

async function requirePrivatePath(path, directory = false) {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (info.mode & 0o077) !== 0
  )
    fail('本地数据库凭据必须是私有普通文件/目录，不能为符号链接');
}

export async function loadLocalDatabaseCredentials({
  root = localDatabaseRoot,
  create = false,
} = {}) {
  const directory = resolve(root, '.hzense-local');
  const path = resolve(directory, 'database.json');
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  await requirePrivatePath(directory, true);
  if (create) {
    const candidate = upgradeLocalDatabaseCredentials({
      version: 1,
      developmentPassword: randomBytes(32).toString('hex'),
      testPassword: randomBytes(32).toString('hex'),
      roles: Object.fromEntries(
        localDatabaseBaseRoles.map((role) => [role, randomBytes(32).toString('hex')]),
      ),
    });
    try {
      await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  await requirePrivatePath(path);
  let credentials = validateLocalDatabaseCredentials(JSON.parse(await readFile(path, 'utf8')));
  if (create && credentials.version < 3) {
    const lock = resolve(directory, 'database-upgrade.lock');
    const temporary = resolve(directory, `database-${randomBytes(12).toString('hex')}.tmp`);
    try {
      await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') fail('本地凭据升级正在进行；不会覆盖现有文件，请稍后重试');
      throw error;
    }
    try {
      await requirePrivatePath(path);
      credentials = upgradeLocalDatabaseCredentials(JSON.parse(await readFile(path, 'utf8')));
      await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await unlink(lock);
    }
  }
  for (const [name, password] of [
    ['development-password', credentials.developmentPassword],
    ['test-password', credentials.testPassword],
  ]) {
    const secretPath = resolve(directory, name);
    if (create) {
      try {
        await writeFile(secretPath, password, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    await requirePrivatePath(secretPath);
    if ((await readFile(secretPath, 'utf8')) !== password)
      fail('本地凭据与 Docker secret 不一致；不会覆盖现有密码');
  }
  return credentials;
}

export function localDatabaseUrl(credentials, role = 'hzense_local_owner', { test = false } = {}) {
  validateLocalDatabaseCredentials(credentials);
  if (test && role !== 'postgres') fail('测试集群仅供独立集成测试入口使用');
  if (role !== 'postgres' && !localDatabaseRoles.includes(role)) fail('未知本地数据库角色');
  if (role !== 'postgres' && !credentials.roles[role])
    fail('本地后台尚未初始化；请运行 local:db:init');
  const password =
    role === 'postgres'
      ? test
        ? credentials.testPassword
        : credentials.developmentPassword
      : credentials.roles[role];
  return `postgresql://${role}:${password}@127.0.0.1:${test ? 55433 : 55432}/${role === 'postgres' ? 'postgres' : 'hzense_local'}`;
}

export function localDatabaseServiceEnvironment(credentials) {
  validateLocalDatabaseCredentials(credentials);
  const base = {
    HZENSE_RUNTIME_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_runtime'),
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_EDITORIAL_READER_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_editorial_reader'),
    HZENSE_EDITORIAL_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_editorial_writer'),
  };
  if (credentials.version === 1) return base;
  return {
    ...base,
    HZENSE_AI_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_ai_admin'),
    HZENSE_AI_KEYRING: JSON.stringify(credentials.aiKeyring),
    HZENSE_IMPORT_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_import_admin'),
    HZENSE_GENERATION_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_generation_admin'),
    HZENSE_REVIEW_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_candidate_reviewer'),
    HZENSE_SIGNAL_ADMIN_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_signal_admin_reader'),
    ...(credentials.version === 3
      ? {
          HZENSE_AUTOMATION_DATABASE_URL: localDatabaseUrl(credentials, 'hzense_automation_admin'),
        }
      : {}),
  };
}

export function runLocalDatabaseProcess(
  command,
  args,
  { env, cwd = localDatabaseRoot, capture = false } = {},
) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    });
    let output = '';
    if (capture)
      child.stdout.on('data', (chunk) => {
        if (output.length < 2_000_000) output += chunk;
      });
    // Child diagnostics can include connection strings. Captured stderr is not surfaced.
    if (capture) child.stderr.resume();
    let forceStop;
    const stop = (signal) => {
      try {
        if (process.platform !== 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill(signal);
      }
    };
    const forward = (signal) => {
      stop(signal);
      if (!forceStop) {
        forceStop = setTimeout(() => stop('SIGKILL'), 5000);
        forceStop.unref();
      }
    };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      if (forceStop) clearTimeout(forceStop);
    };
    child.once('error', () => {
      cleanup();
      reject(
        new LocalDatabaseError(
          '命令不可用；请安装并启动 Docker Desktop，并确认 Node.js/pnpm 已安装',
        ),
      );
    });
    child.once('close', (code) => {
      cleanup();
      if (code === 0) accept(output.trim());
      else reject(new LocalDatabaseError('本地数据库命令未成功；未执行自动重置或删除持久数据'));
    });
  });
}

async function inspectDocker(run, env) {
  const context = assertLocalDockerContext(
    JSON.parse(await run('docker', ['context', 'inspect'], { env, capture: true })),
  );
  await run('docker', ['--context', context, 'info', '--format', '{{.ServerVersion}}'], {
    env,
    capture: true,
  });
  await run('docker', ['--context', context, 'compose', 'version'], { env, capture: true });
  return context;
}

async function assertContainer(run, env, context, root, test = false) {
  const id = await run(
    'docker',
    composeArguments(context, ['ps', '-q', test ? 'postgres-test' : 'postgres'], { root, test }),
    { env, capture: true },
  );
  if (!/^[a-f0-9]{12,64}$/.test(id)) fail('本地数据库未启动；请先执行 local:db:up');
  assertLocalDatabaseContainer(
    JSON.parse(await run('docker', ['--context', context, 'inspect', id], { env, capture: true })),
    { root, test },
  );
  return id;
}

async function assertExistingDevelopmentContainer(run, env, context, root) {
  const id = await run(
    'docker',
    composeArguments(context, ['ps', '-a', '-q', 'postgres'], { root }),
    { env, capture: true },
  );
  if (!id) return;
  if (!/^[a-f0-9]{12,64}$/.test(id)) fail('现有开发容器身份不明，停止操作');
  assertLocalDatabaseContainer(
    JSON.parse(await run('docker', ['--context', context, 'inspect', id], { env, capture: true })),
    { root, requireRunning: false },
  );
}

export function localPnpmCommand(environment = process.env) {
  return environment.npm_execpath?.endsWith('pnpm.cjs')
    ? { command: process.execPath, prefix: [environment.npm_execpath] }
    : { command: 'pnpm', prefix: [] };
}

export async function assertLocalCluster(client, { test = false } = {}) {
  const row = (
    await client.query(`SELECT current_database() AS database, session_user AS role,
    current_setting('cluster_name') AS cluster, current_setting('server_version_num')::int AS version,
    inet_server_addr()::text AS address`)
  ).rows[0];
  if (
    row?.database !== 'postgres' ||
    row?.role !== 'postgres' ||
    row?.cluster !== (test ? 'hzense-local-test' : 'hzense-local-development') ||
    Math.floor(row.version / 10000) !== 18
  )
    fail('不是本地专用 PostgreSQL 18 集群，停止操作');
  const databases = (
    await client.query(
      "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres' ORDER BY datname",
    )
  ).rows.map((row_) => row_.datname);
  if (test ? databases.length !== 0 : databases.some((name) => name !== 'hzense_local'))
    fail('集群包含未知数据库；拒绝修改或清空');
  return true;
}

export async function main({
  args = process.argv.slice(2),
  environment = process.env,
  root = localDatabaseRoot,
  run = runLocalDatabaseProcess,
  initialize,
  verify,
  testClientFactory,
  log = console.log,
} = {}) {
  const operation = parseLocalDatabaseArguments(args);
  const env = localDatabaseEnvironment(environment);
  const context = await inspectDocker(run, env);
  if (operation === 'doctor') {
    log(
      '本机 Docker 与 Compose 可用；开发库仅 127.0.0.1:55432，测试库仅 127.0.0.1:55433。尚未连接或迁移数据库。',
    );
    return;
  }
  if (operation === 'stop') {
    await assertExistingDevelopmentContainer(run, env, context, root);
    await run('docker', composeArguments(context, ['stop', 'postgres'], { root }), { env });
    log('开发数据库已停止；命名卷和本地凭据均保留。');
    return;
  }
  const credentials = await loadLocalDatabaseCredentials({
    root,
    create: operation === 'up' || operation === 'test' || operation === 'init',
  });
  if (operation === 'up') {
    await assertExistingDevelopmentContainer(run, env, context, root);
    await run('docker', composeArguments(context, ['up', '-d', '--wait', 'postgres'], { root }), {
      env,
    });
    await assertContainer(run, env, context, root);
    log('开发数据库已启动；首次使用请执行 local:db:init。没有连接 Neon。');
    return;
  }
  const pnpm = localPnpmCommand(environment);
  const packageRun = (args_, extra = {}, capture = false) =>
    run(pnpm.command, [...pnpm.prefix, ...args_], {
      env: { ...env, ...extra },
      cwd: root,
      capture,
    });
  if (operation === 'test') {
    const existingTest = await run(
      'docker',
      composeArguments(context, ['ps', '-a', '-q', 'postgres-test'], { root, test: true }),
      { env, capture: true },
    );
    if (existingTest) fail('已存在测试容器；请先人工确认其用途，工具不会自动删除或重建');
    let cleanupAuthorized = false;
    let testContainerId;
    try {
      await run(
        'docker',
        composeArguments(context, ['up', '-d', '--wait', 'postgres-test'], { root, test: true }),
        { env },
      );
      testContainerId = await assertContainer(run, env, context, root, true);
      const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
      const createClient = testClientFactory ?? ((options) => new (require('pg').Client)(options));
      const client = createClient({
        connectionString: localDatabaseUrl(credentials, 'postgres', { test: true }),
        connectionTimeoutMillis: 5000,
        ssl: false,
        sslnegotiation: 'postgres',
        // pg falls back to PGOPTIONS for an empty string; use an explicit safe setting.
        options: '-c search_path=pg_catalog,public',
        replication: 'false',
        application_name: 'hzense-local-test-identity',
      });
      await client.connect();
      try {
        await assertLocalCluster(client, { test: true });
      } finally {
        await client.end();
      }
      cleanupAuthorized = true;
      await packageRun(['--filter', '@hzense/search', 'build']);
      await packageRun(
        ['--filter', '@hzense/database', 'test:migrations'],
        {
          MIGRATION_TEST_ADMIN_URL: localDatabaseUrl(credentials, 'postgres', { test: true }),
          RUNTIME_READER_TEST_ISOLATED_CLUSTER: '1',
        },
        true,
      );
    } finally {
      // Exact validated container ID, never a service selector that could target a replacement.
      // No volume deletion and no development service cleanup.
      if (cleanupAuthorized)
        await run('docker', ['--context', context, 'rm', '--force', testContainerId], { env });
    }
    log('独立 PostgreSQL 集成测试通过；测试容器已移除，开发数据卷未改动。');
    return;
  }
  await assertContainer(run, env, context, root);
  if (operation === 'init') {
    if (initialize) {
      await packageRun(['--filter', '@hzense/content', 'build']);
      await initialize({ credentials, root });
    } else {
      // pg and migration helpers consult process.env as well as explicit options.
      // Keep production baselines/PGOPTIONS/PGSSLMODE out of the actual DB process.
      // The child rereads private credentials and repeats the container guard.
      await run(process.execPath, [resolve(root, 'scripts/local-database-bootstrap.mjs'), 'init'], {
        env,
        cwd: root,
      });
    }
    log(
      '本地真实迁移、仓库 Seed 统一入库与后台最小角色授权完成；原有本地数据及密码保留，未导入生产私有数据或调用 AI。',
    );
  } else {
    if (verify) await verify({ credentials, root });
    else
      await run(
        process.execPath,
        [resolve(root, 'scripts/local-database-bootstrap.mjs'), 'verify'],
        { env, cwd: root },
      );
    log('本地 PostgreSQL 结构和公开数据读取已核验；此结果不代表生产数据库健康。');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      `[local-database] ${error instanceof LocalDatabaseError ? error.message : '操作失败；已保留本地数据。诊断未输出连接串或密码。'}`,
    );
    process.exitCode = 1;
  });
}
