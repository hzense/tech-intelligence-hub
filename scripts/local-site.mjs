import { spawn } from 'node:child_process';
import console from 'node:console';
import { lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const systemEnvironmentKeys = [
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
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
];
const disabledFeatures = [
  'HZENSE_AUTOMATION_ENABLED',
  'HZENSE_CANDIDATE_PIPELINE_ENABLED',
  'HZENSE_EDITORIAL_PUBLICATION_ENABLED',
  'HZENSE_GENERATION_WORKFLOW_ENABLED',
  'HZENSE_IMPORT_ENABLED',
  'HZENSE_MATERIAL_REGISTRATION_ENABLED',
  'HZENSE_MATERIAL_REVIEW_ENABLED',
  'HZENSE_REVIEW_ENABLED',
  'HZENSE_SIGNAL_GENERATION_ENABLED',
  'HZENSE_TOPIC_INSIGHTS_ENABLED',
  'HZENSE_UNIFIED_SIGNAL_ENABLED',
];
const authSecrets = [
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'HZENSE_ADMIN_EMAIL',
];
const dotenvNames = ['.env', '.env.local', '.env.development', '.env.development.local'];

export class LocalSiteError extends Error {}

function validPort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new LocalSiteError('本地端口必须是 1 到 65535 之间的整数。');
  return port;
}

export function parseLocalArguments(args = []) {
  let port = 3000;
  let check = false;
  let hasPort = false;
  for (const argument of args) {
    if (argument === '--check' && !check) {
      check = true;
    } else if (
      typeof argument === 'string' &&
      /^--port=[1-9][0-9]{0,4}$/.test(argument) &&
      !hasPort
    ) {
      port = validPort(Number(argument.slice('--port='.length)));
      hasPort = true;
    } else {
      throw new LocalSiteError('仅支持一次 --check 和一次 --port=端口；默认端口为 3000。');
    }
  }
  return { port, check };
}

/** Never turn a deployment into a local snapshot by rewriting its environment. */
export function assertLocalExecution(environment) {
  if (
    environment.NODE_ENV === 'production' ||
    (environment.VERCEL_ENV !== undefined && environment.VERCEL_ENV !== 'development') ||
    environment.VERCEL ||
    environment.VERCEL_URL ||
    environment.VERCEL_DEPLOYMENT_ID ||
    environment.VERCEL_PROJECT_ID ||
    environment.AWS_LAMBDA_FUNCTION_NAME ||
    environment.GITHUB_ACTIONS === 'true' ||
    environment.CI === 'true'
  ) {
    throw new LocalSiteError('本地浏览入口禁止在生产、Preview、部署或 CI 环境中运行。');
  }
}

/** A strict allowlist prevents inherited database URLs, tokens and Node hooks from escaping. */
export function buildLocalEnvironment(parentEnv = {}, port = 3000) {
  validPort(port);
  const environment = {};
  for (const key of systemEnvironmentKeys) {
    if (typeof parentEnv[key] === 'string') environment[key] = parentEnv[key];
  }
  Object.assign(environment, {
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
    VERCEL: '',
    PORT: String(port),
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    NEXT_TELEMETRY_DISABLED: '1',
    HZENSE_LOCAL_PREVIEW: '1',
    HZENSE_SIGNAL_READ_MODE: 'legacy',
    HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: 'seed',
    HZENSE_SEARCH_MODE: 'in-process',
  });
  for (const key of disabledFeatures) environment[key] = '0';
  for (const key of authSecrets) environment[key] = '';
  return environment;
}

/** Next loads these files independently of the inherited environment. Never read their content. */
export async function assertNoLocalDotenv(root = repositoryRoot, inspect = lstat) {
  const conflicts = [];
  for (const directory of ['', 'apps/web']) {
    for (const name of dotenvNames) {
      const relativePath = directory ? `${directory}/${name}` : name;
      try {
        await inspect(resolve(root, relativePath));
        conflicts.push(relativePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw new LocalSiteError(`无法安全检查 ${relativePath}，本地启动已停止。`);
        }
      }
    }
  }
  if (conflicts.length) {
    throw new LocalSiteError(
      `为避免 Next.js 自动加载云端配置，本地启动已停止。请自行将以下环境文件移出加载目录后重试（不会读取或删除其内容）：${conflicts.join('、')}。`,
    );
  }
}

export function buildLocalCommand(parentEnv = {}, port = 3000) {
  validPort(port);
  const args = [
    '--filter',
    '@hzense/web',
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ];
  const pnpmPath = parentEnv.npm_execpath;
  if (typeof pnpmPath === 'string' && /^pnpm\.(?:c?js|mjs)$/.test(basename(pnpmPath))) {
    return { command: process.execPath, args: [pnpmPath, ...args] };
  }
  return { command: 'pnpm', args };
}

/** Keep pnpm and the Next child in a separate process group so both stop together. */
export function runLocalProcess(command, args, options, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const signals = dependencies.signals ?? process;
  const platform = dependencies.platform ?? process.platform;
  const killProcess = dependencies.killProcess ?? process.kill.bind(process);
  return new Promise((resolveExit, reject) => {
    let child;
    try {
      child = spawnProcess(command, args, {
        ...options,
        stdio: 'inherit',
        shell: false,
        detached: platform !== 'win32',
      });
    } catch {
      reject(new LocalSiteError('无法启动本地服务，请先确认 Node.js 24 和 pnpm 已安装。'));
      return;
    }
    let stoppedBy;
    let forceStop;
    const stop = (signal) => {
      try {
        if (platform !== 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0) {
          killProcess(-child.pid, signal);
        } else child.kill(signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') child.kill(signal);
      }
    };
    const forward = (signal) => {
      if (stoppedBy) return;
      stoppedBy = signal;
      stop(signal);
      forceStop = setTimeout(() => stop('SIGKILL'), 5000);
      forceStop.unref();
    };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    const cleanup = () => {
      signals.removeListener('SIGINT', interrupt);
      signals.removeListener('SIGTERM', terminate);
      if (forceStop) clearTimeout(forceStop);
    };
    signals.on('SIGINT', interrupt);
    signals.on('SIGTERM', terminate);
    child.once('error', () => {
      cleanup();
      reject(new LocalSiteError('无法启动本地服务，请先确认 Node.js 24 和 pnpm 已安装。'));
    });
    child.once('close', (code, signal) => {
      cleanup();
      const finalSignal = stoppedBy ?? signal;
      resolveExit(finalSignal === 'SIGINT' ? 130 : finalSignal === 'SIGTERM' ? 143 : (code ?? 1));
    });
  });
}

export async function main(args = process.argv.slice(2), options = {}) {
  const { port, check } = parseLocalArguments(args);
  const parentEnv = options.environment ?? process.env;
  const root = options.repositoryRoot ?? repositoryRoot;
  const log = options.log ?? console.log;
  assertLocalExecution(parentEnv);
  await assertNoLocalDotenv(root, options.inspect);
  const env = buildLocalEnvironment(parentEnv, port);
  log(
    '本地公开浏览版：使用仓库数据快照，不连接 Neon，不执行 AI、导入或发布；不包含生产数据库的实时新增数据。',
  );
  if (check) {
    log(`隔离检查通过；未启动服务。访问地址将是 http://127.0.0.1:${port}。`);
    return 0;
  }
  const { command, args: commandArgs } = buildLocalCommand(parentEnv, port);
  log(`正在启动 http://127.0.0.1:${port}；按 Ctrl+C 停止。`);
  return (options.runProcess ?? runLocalProcess)(command, commandArgs, { cwd: root, env });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(
        error instanceof LocalSiteError ? error.message : '本地启动检查失败，未启动服务。',
      );
      process.exitCode = 1;
    },
  );
}
