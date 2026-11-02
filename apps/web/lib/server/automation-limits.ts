import { AutomationError } from '../../../../packages/database/src/automation-contract.mjs';

export function automationLimits(kind?: 'source_collection' | 'topic_insight') {
  const limits = {
    batch: Number(process.env.HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD),
    daily: Number(process.env.HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD),
    reserve:
      kind === 'source_collection' ? 0 : Number(process.env.HZENSE_AUTOMATION_RESERVE_MICROUSD),
  };
  if (
    [limits.batch, limits.daily, ...(kind === 'source_collection' ? [] : [limits.reserve])].some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 50000000,
    ) ||
    limits.batch > limits.daily ||
    limits.reserve > limits.batch
  )
    throw new AutomationError('not_configured');
  return limits;
}
