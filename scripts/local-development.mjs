import console from 'node:console';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertLocalExecution,
  assertNoLocalDotenv,
  buildLocalCommand,
  buildLocalEnvironment,
  LocalSiteError,
  parseLocalArguments,
  runLocalProcess,
} from './local-site.mjs';
import {
  loadLocalDatabaseCredentials,
  localDatabaseServiceEnvironment,
  main as databaseMain,
} from './local-database.mjs';
import { isLocalDevelopment } from '../apps/web/lib/local-development.ts';
import { startLocalAutomationScheduler } from './local-automation-scheduler.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseLocalDevelopmentArguments(args = []) {
  const autoArgs = args.filter((argument) => argument === '--auto-publish');
  if (autoArgs.length > 1) throw new LocalSiteError('--auto-publish 只能指定一次。');
  const aiArgs = args.filter(
    (argument) => typeof argument === 'string' && argument.startsWith('--ai='),
  );
  if (aiArgs.length > 1 || (aiArgs.length === 1 && !['--ai=mock', '--ai=real'].includes(aiArgs[0])))
    throw new LocalSiteError('AI 模式仅支持一次 --ai=mock 或 --ai=real；默认 mock 不调用供应商。');
  return {
    ...parseLocalArguments(
      args.filter((argument) => !aiArgs.includes(argument) && argument !== '--auto-publish'),
    ),
    aiMode: aiArgs[0] === '--ai=real' ? 'real' : 'mock',
    automaticPublication: autoArgs.length === 1,
  };
}

export function assertLocalDevelopmentLaunchEnvironment(environment) {
  assertLocalExecution(environment);
  for (const [key, value] of Object.entries(environment)) {
    if (!value) continue;
    if (
      (key.startsWith('VERCEL_') && key !== 'VERCEL_ENV') ||
      key.startsWith('AWS_') ||
      [
        'CI',
        'GITHUB_ACTIONS',
        'NETLIFY',
        'CF_PAGES',
        'RENDER',
        'NODE_TLS_REJECT_UNAUTHORIZED',
      ].includes(key)
    ) {
      throw new LocalSiteError('本地开发入口禁止在部署、CI 或不安全 TLS 环境中启动。');
    }
  }
}

export function buildLocalDevelopmentEnvironment(
  parent,
  credentials,
  { root = repositoryRoot, port = 3000, aiMode = 'mock', automaticPublication = false } = {},
) {
  if (!['mock', 'real'].includes(aiMode)) throw new LocalSiteError('AI 模式必须为 mock 或 real。');
  if (automaticPublication && aiMode !== 'real')
    throw new LocalSiteError('自动发布仅用于 --ai=real 的公开网页资料，模拟任务不会自动发布。');
  if (credentials.version !== 4)
    throw new LocalSiteError('本地后台凭据尚未初始化，请先执行 pnpm local:db:init。');
  const env = {
    ...buildLocalEnvironment(parent, port),
    ...localDatabaseServiceEnvironment(credentials),
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_PREVIEW: '0',
    HZENSE_LOCAL_AI_MODE: aiMode,
    HZENSE_AI_ALLOWED_HOSTS: 'openrouter.ai,ai-gateway.vercel.sh',
    HZENSE_AUTOMATION_ENABLED: aiMode === 'real' ? '1' : '0',
    HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: aiMode === 'real' ? '1' : '0',
    HZENSE_TOPIC_INSIGHTS_ENABLED: '1',
    HZENSE_LOCAL_STATE_DIR: resolve(root, '.hzense-local'),
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_SIGNAL_READ_MODE: 'database',
    HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: 'seed',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
    HZENSE_IMPORT_ENABLED: '1',
    HZENSE_SIGNAL_GENERATION_ENABLED: '1',
    HZENSE_GENERATION_WORKFLOW_ENABLED: '1',
    HZENSE_REVIEW_ENABLED: '1',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: automaticPublication ? '1' : '0',
    HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '5000000',
    HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '10000000',
    // Source discovery and topic insights share this ledger; generation has its own budget.
    HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD: '5000000',
    HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD: '10000000',
    HZENSE_AUTOMATION_RESERVE_MICROUSD: '5000000',
    WORKFLOW_TARGET_WORLD: 'local',
    WORKFLOW_LOCAL_DATA_DIR: resolve(root, '.hzense-local', 'workflow'),
    WORKFLOW_LOCAL_BASE_URL: `http://127.0.0.1:${port}`,
    WORKFLOW_LOCAL_QUEUE_CONCURRENCY: '1',
  };
  if (!isLocalDevelopment(env)) throw new LocalSiteError('本地数据库隔离配置检查失败。');
  return env;
}

async function requirePrivateDirectory(path) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== path
  )
    throw new LocalSiteError('本地状态目录必须为当前用户拥有的非符号链接 0700 目录。');
}

export async function main(args = process.argv.slice(2), options = {}) {
  const { port, check, aiMode, automaticPublication } = parseLocalDevelopmentArguments(args);
  const parent = options.environment ?? process.env;
  const root = options.repositoryRoot ?? repositoryRoot;
  const log = options.log ?? console.log;
  assertLocalDevelopmentLaunchEnvironment(parent);
  await assertNoLocalDotenv(root, options.inspect);
  // Read-only identity/schema/role checks must succeed before enabling loopback-only local identity.
  await (options.verifyDatabase ?? databaseMain)({
    args: ['verify'],
    environment: parent,
    root,
    log,
  });
  const credentials = await (options.loadCredentials ?? loadLocalDatabaseCredentials)({
    root,
    create: false,
  });
  const env = buildLocalDevelopmentEnvironment(parent, credentials, {
    root,
    port,
    aiMode,
    automaticPublication,
  });
  log(
    aiMode === 'real'
      ? '本地真实 AI 模式：仅连接本机 PostgreSQL；模型测试、手动及已启用的定时采集、专题分析与生成会使用本地保存的 API Key 联网并产生供应商费用，所选资料会发送给供应商；采集和专题分析共享每次 5 美元／UTC 每日 10 美元额度，生成另计。定时任务须在页面逐项启用，服务停止或电脑休眠时暂停；专题报告须人工确认公开，发布只写本地，不会同步生产。'
      : '本地完整开发模式：仅连接本机 PostgreSQL；不调用付费 AI，本地模拟记账不是真实费用；可读取已公开专题报告，专题 AI 执行关闭；发布只写本地，不会同步生产。使用 --ai=real 可显式开启真实 AI。',
  );
  if (check) {
    log('本地数据库与开发配置检查通过；未启动服务，不需要登录令牌。');
    return 0;
  }
  await requirePrivateDirectory(env.HZENSE_LOCAL_STATE_DIR);
  await mkdir(env.WORKFLOW_LOCAL_DATA_DIR, { recursive: true, mode: 0o700 });
  await requirePrivateDirectory(env.WORKFLOW_LOCAL_DATA_DIR);
  log(
    `管理后台：http://127.0.0.1:${port}/admin；本机开发模式直接进入，无需令牌或 Google 登录。仅供可信本机使用，不要代理或暴露到局域网、公网。`,
  );
  const { command, args: commandArgs } = buildLocalCommand(parent, port);
  const scheduler =
    aiMode === 'real'
      ? (options.startScheduler ?? startLocalAutomationScheduler)({ port, log })
      : undefined;
  try {
    return await (options.runProcess ?? runLocalProcess)(command, commandArgs, { cwd: root, env });
  } finally {
    scheduler?.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(
        error instanceof LocalSiteError
          ? error.message
          : '本地开发检查失败，未启动服务；未输出凭据。请先运行 local:db:verify。',
      );
      process.exitCode = 1;
    },
  );
}
