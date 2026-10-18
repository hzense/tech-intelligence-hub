import console from 'node:console';
import { lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  LocalSiteError,
  assertLocalExecution,
  assertNoLocalDotenv,
  buildLocalEnvironment,
  runLocalProcess,
} from './local-site.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verifyTasks = [
  'workflow:validate',
  'content:validate',
  'seed:validate',
  'lint',
  'typecheck',
  'test',
];
const additionalDotenvNames = [
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.env.test.local',
];

export class LocalVerifyError extends LocalSiteError {}

export function parseVerifyArguments(args = []) {
  if (args.length === 0) return { build: false };
  if (args.length === 1 && args[0] === '--build') return { build: true };
  throw new LocalVerifyError(
    '本地验证仅支持一次 --build；默认执行工作流、内容、Seed、Lint、类型和单元测试检查。',
  );
}

/** Keep tests and optional builds isolated without forcing Next's NODE_ENV. */
export function buildVerifyEnvironment(parentEnv = {}) {
  const environment = buildLocalEnvironment(parentEnv);
  delete environment.NODE_ENV;
  return {
    ...environment,
    TURBO_TELEMETRY_DISABLED: '1',
    COREPACK_ENABLE_NETWORK: '0',
    // pnpm 11 must fail on a version mismatch rather than download another CLI.
    npm_config_pm_on_fail: 'error',
  };
}

export async function assertVerifyFiles(root = repositoryRoot, inspect = lstat, build = false) {
  await assertNoLocalDotenv(root, inspect);
  const conflicts = [];
  for (const directory of ['', 'apps/web']) {
    for (const name of additionalDotenvNames) {
      const relativePath = directory ? `${directory}/${name}` : name;
      try {
        await inspect(resolve(root, relativePath));
        conflicts.push(relativePath);
      } catch (error) {
        if (error?.code !== 'ENOENT')
          throw new LocalVerifyError(`无法安全检查 ${relativePath}，本地验证已停止。`);
      }
    }
  }
  if (conflicts.length)
    throw new LocalVerifyError(
      `为避免测试或构建自动加载云端配置，本地验证已停止。请自行将以下环境文件移出加载目录后重试（不会读取或删除其内容）：${conflicts.join('、')}。`,
    );
  if (build) {
    try {
      await inspect(resolve(root, 'apps/web/.next/dev/lock'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw new LocalVerifyError('无法安全检查 Next.js 开发锁，本地构建已停止。');
    }
    throw new LocalVerifyError(
      '检测到 apps/web/.next/dev/lock，请先停止 Next.js 开发服务再运行 --build；不会删除锁或终止服务。',
    );
  }
}

export function buildPnpmCommand(task, parentEnv = {}) {
  if (!verifyTasks.includes(task) && task !== 'build')
    throw new LocalVerifyError('本地验证不允许执行未列入检查范围的命令。');
  const args = ['--pm-on-fail=error', 'run', task];
  const pnpmPath = parentEnv.npm_execpath;
  if (typeof pnpmPath === 'string' && /^pnpm\.(?:c?js|mjs)$/.test(basename(pnpmPath)))
    return { command: process.execPath, args: [pnpmPath, ...args] };
  return { command: 'pnpm', args };
}

export async function main(args = process.argv.slice(2), options = {}) {
  const { build } = parseVerifyArguments(args);
  const environment = options.environment ?? process.env;
  const root = options.repositoryRoot ?? repositoryRoot;
  const log = options.log ?? console.log;
  assertLocalExecution(environment);
  await assertVerifyFiles(root, options.inspect, build);
  const env = buildVerifyEnvironment(environment);
  const tasks = build ? [...verifyTasks, 'build'] : verifyTasks;
  log(
    '本地验证：仅检查仓库工作流、内容、Seed、Lint、类型与单元测试；不包含 PostgreSQL 集成、浏览器、真实 AI 或部署验收。',
  );
  log('使用已安装的锁定 pnpm 和依赖；不安装依赖、不执行联网 audit，也不调用云服务。');
  for (const task of tasks) {
    log(`开始：${task}`);
    const { command, args: commandArgs } = buildPnpmCommand(task, environment);
    let code;
    try {
      code = await (options.runProcess ?? runLocalProcess)(command, commandArgs, {
        cwd: root,
        env,
      });
    } catch {
      throw new LocalVerifyError(
        `无法执行 ${task}，本地验证已停止；请检查已安装的 Node.js、pnpm 和依赖。`,
      );
    }
    if (code !== 0) {
      const exitCode = Number.isInteger(code) && code > 0 && code <= 255 ? code : 1;
      log(`未通过：${task}（退出码 ${exitCode}）；后续检查未执行。`);
      return exitCode;
    }
    log(`通过：${task}`);
  }
  log(
    build
      ? '本地基础验证及构建通过；不代表数据库、浏览器或线上部署验收通过。'
      : '本地基础验证通过；未执行生产构建、数据库、浏览器或线上部署验收。',
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(
        error instanceof LocalSiteError ? error.message : '本地验证检查失败，未继续执行。',
      );
      process.exitCode = 1;
    },
  );
}
