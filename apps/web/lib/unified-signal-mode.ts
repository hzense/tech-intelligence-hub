/** One explicit switch for business writes and all public Signal consumers. */
export function unifiedSignalEnabled(env: Readonly<Record<string, string | undefined>>) {
  const value = env.HZENSE_UNIFIED_SIGNAL_ENABLED;
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error('Invalid unified Signal configuration');
}
