import type { NeonUsageCosts } from './neon-usage-costs';

export const neonComputeRate = (plan: NeonUsageCosts['plan']) =>
  plan === 'launch' ? 0.106 : plan === 'scale' ? 0.222 : null;
export const neonTransferAllowance = (plan: NeonUsageCosts['plan']) =>
  plan === 'free' ? 5e9 : plan === 'launch' || plan === 'scale' ? 500e9 : null;

/** Run rate, not a bill or cap. At least 24 hours avoids extrapolating a new account's first minutes. */
export function neonComputeProjection(costs: NeonUsageCosts | null) {
  const rate = neonComputeRate(costs?.plan ?? null);
  if (
    costs?.status !== 'estimated' ||
    rate === null ||
    costs.computeUnitSeconds === undefined ||
    !Number.isFinite(costs.computeUnitSeconds) ||
    costs.computeUnitSeconds < 0 ||
    !costs.from ||
    !costs.through
  )
    return null;
  const elapsed = (Date.parse(costs.through) - Date.parse(costs.from)) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 86400) return null;
  const averageCu = costs.computeUnitSeconds / elapsed;
  const monthlyMicrousd = Math.round(averageCu * 24 * 30 * rate * 1e6);
  if (!Number.isSafeInteger(monthlyMicrousd)) return null;
  return { averageCu, monthlyMicrousd };
}
