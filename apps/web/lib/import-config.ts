import { readRuntimeReaderConfig, RuntimeReaderError } from './runtime-reader-core.ts';
import { assertImportStore } from '../../../packages/ingestion/src/import-retention.mjs';

type Environment = Readonly<Record<string, string | undefined>>;

// These static messages are the only diagnostic content allowed across the RSC boundary.
export const importConfigurationMessages = {
  environment: '仅支持 Vercel Production 环境。',
  enabled: 'HZENSE_IMPORT_ENABLED 只能为 0 或 1。',
  database_url: 'HZENSE_IMPORT_DATABASE_URL 缺失或格式错误；请核对完整连接串及密码编码。',
  database_role: '数据库连接必须使用 hzense_import_admin 角色。',
  database_target:
    '数据库主机、显式端口和库名必须与 HZENSE_RUNTIME_EXPECTED_HOST/PORT/NAME 一致，并使用 Neon pooled 地址。',
  database_tls:
    '连接串必须包含 sslmode=verify-full 和 channel_binding=prefer，且不得禁用证书验证。',
  database_parameters: '数据库连接参数不合法；只允许单个 sslmode 和 channel_binding 参数。',
  blob_binding: 'HZENSE_IMPORT_BLOB_TOKEN 与 HZENSE_IMPORT_BLOB_STORE_ID 缺失或不匹配。',
  parser_snapshot: 'HZENSE_IMPORT_PARSER_SNAPSHOT_ID 缺失。',
  retention: 'HZENSE_IMPORT_RETENTION_DAYS 必须为 7。',
  reserve: 'HZENSE_IMPORT_RESERVE_MICROUSD 必须为正安全整数。',
  daily: 'HZENSE_IMPORT_DAILY_LIMIT_MICROUSD 必须为正安全整数。',
  batch: 'HZENSE_IMPORT_BATCH_LIMIT_MICROUSD 必须为正安全整数。',
} as const;
type Issue = keyof typeof importConfigurationMessages;
export type ImportConfigurationDiagnostics = {
  enabled: boolean;
  valid: boolean;
  ready: boolean;
  issues: Issue[];
};

// Pure, no I/O: safe to run while the import gate is closed. Never returns input values/errors.
export function diagnoseImportConfiguration(env: Environment): ImportConfigurationDiagnostics {
  const issues: Issue[] = [];
  if (env.VERCEL_ENV !== 'production') issues.push('environment');
  if (!['0', '1'].includes(env.HZENSE_IMPORT_ENABLED ?? '')) issues.push('enabled');
  try {
    assertImportStore(env.HZENSE_IMPORT_BLOB_TOKEN, env.HZENSE_IMPORT_BLOB_STORE_ID);
  } catch {
    issues.push('blob_binding');
  }
  if (!env.HZENSE_IMPORT_PARSER_SNAPSHOT_ID?.trim()) issues.push('parser_snapshot');
  if (env.HZENSE_IMPORT_RETENTION_DAYS !== '7') issues.push('retention');
  for (const [field, code] of [
    ['HZENSE_IMPORT_RESERVE_MICROUSD', 'reserve'],
    ['HZENSE_IMPORT_DAILY_LIMIT_MICROUSD', 'daily'],
    ['HZENSE_IMPORT_BATCH_LIMIT_MICROUSD', 'batch'],
  ] as const) {
    const value = Number(env[field]);
    if (!Number.isSafeInteger(value) || value <= 0) issues.push(code);
  }
  const raw = env.HZENSE_IMPORT_DATABASE_URL;
  try {
    if (
      !raw ||
      raw !== raw.trim() ||
      [...raw].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ) {
      issues.push('database_url');
    } else {
      const url = new URL(raw);
      if (decodeURIComponent(url.username) !== 'hzense_import_admin') issues.push('database_role');
      url.username = 'hzense_runtime';
      readRuntimeReaderConfig({
        ...env,
        HZENSE_RUNTIME_DATABASE_URL: url.href,
        HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
      });
    }
  } catch (error) {
    // Explicit allowlist mapping: never reflect an exception message, URL or arbitrary code.
    const code = error instanceof RuntimeReaderError ? error.code : undefined;
    if (code === 'tls_required') issues.push('database_tls');
    else if (code === 'target_mismatch' || code === 'pooled_endpoint_required')
      issues.push('database_target');
    else if (code === 'invalid_configuration') issues.push('database_parameters');
    else if (code !== 'not_production') issues.push('database_url');
  }
  const enabled = env.HZENSE_IMPORT_ENABLED === '1';
  return { enabled, valid: issues.length === 0, ready: enabled && issues.length === 0, issues };
}
