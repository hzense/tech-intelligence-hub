import 'server-only';
import {
  makeNeonUsageDashboard,
  neonUsageProjectId,
  NeonUsageError,
  type NeonUsageHistory,
} from '../neon-usage-core';
import { createNeonUsageBlobStore } from '../neon-usage-blob';
import { createNeonUsageLocalStore } from '../neon-usage-local';
import { sampleNeonUsage } from '../neon-usage-service';
import { isLocalDevelopment } from '../local-development';

function configuration() {
  const env = process.env;
  const missing: string[] = [];
  const projectId = neonUsageProjectId(env.HZENSE_NEON_PROJECT_ID)
    ? env.HZENSE_NEON_PROJECT_ID
    : null;
  if (!projectId) missing.push('HZENSE_NEON_PROJECT_ID');
  const apiKey = env.HZENSE_NEON_API_KEY;
  if (!apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey))
    missing.push('HZENSE_NEON_API_KEY');
  const local = isLocalDevelopment(env);
  if (env.HZENSE_LOCAL_DEVELOPMENT === '1' && !local) missing.push('HZENSE_LOCAL_DEVELOPMENT');
  if (env.HZENSE_LOCAL_PREVIEW === '1') missing.push('HZENSE_LOCAL_DEVELOPMENT');
  if (local && !env.HZENSE_LOCAL_STATE_DIR) missing.push('HZENSE_LOCAL_STATE_DIR');
  const token = env.HZENSE_NEON_USAGE_BLOB_TOKEN;
  if (!local && (!token || token.length > 2048 || /[^\x21-\x7e]/.test(token)))
    missing.push('HZENSE_NEON_USAGE_BLOB_TOKEN');
  const quota = env.HZENSE_NEON_USAGE_QUOTA_BYTES;
  const quotaBytes =
    quota && /^\d+$/.test(quota) && Number.isSafeInteger(Number(quota)) && Number(quota) > 0
      ? Number(quota)
      : null;
  if (quota && quotaBytes === null) missing.push('HZENSE_NEON_USAGE_QUOTA_BYTES');
  return {
    projectId,
    apiKey,
    token,
    local,
    quotaBytes,
    missing,
    state: env.HZENSE_LOCAL_STATE_DIR,
  };
}
function createStore(config: ReturnType<typeof configuration>) {
  if (
    !config.projectId ||
    config.missing.some(
      (key) => key !== 'HZENSE_NEON_API_KEY' && key !== 'HZENSE_NEON_USAGE_QUOTA_BYTES',
    )
  )
    throw new NeonUsageError('not_configured');
  return config.local
    ? createNeonUsageLocalStore(config.projectId, config.state!)
    : createNeonUsageBlobStore(config.projectId, config.token!);
}
export async function getNeonUsageDashboard() {
  const config = configuration();
  let history: NeonUsageHistory | null = null;
  let error: string | null = null;
  try {
    history = (await createStore(config).read())?.history ?? null;
  } catch (cause) {
    error = cause instanceof NeonUsageError ? cause.code : 'storage_unavailable';
  }
  return makeNeonUsageDashboard({
    history,
    now: new Date(),
    missing: config.missing,
    error,
    projectId: config.projectId,
    quotaBytes: config.quotaBytes,
  });
}
export async function collectNeonUsage() {
  const config = configuration();
  if (config.missing.length || !config.projectId || !config.apiKey)
    throw new NeonUsageError('not_configured');
  return sampleNeonUsage({
    projectId: config.projectId,
    apiKey: config.apiKey,
    store: createStore(config),
  });
}
