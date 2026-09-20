/** Only OpenRouter documents usage.cost as account charges in USD credits.
 * Unknown providers/invalid values fall back to existing local estimates.
 * Read at the transport boundary so SDK output validation cannot discard costs.
 */
export async function readApiCostMicrousd(
  response: Response,
  baseUrl: string,
): Promise<number | null> {
  try {
    if (new URL(baseUrl).hostname !== 'openrouter.ai') return null;
    const body = await response.clone().json();
    const cost = body?.usage?.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
    // Decimal arithmetic avoids an extra micro-dollar from floating point multiplication.
    const [coefficient, exponent = '0'] = cost.toString().split('e');
    const [whole = '0', fraction = ''] = coefficient!.split('.');
    const digits = BigInt(whole + fraction);
    const shift = Number(exponent) + 6 - fraction.length;
    const divisor = 10n ** BigInt(Math.abs(shift));
    const micros = shift >= 0 ? digits * divisor : (digits + divisor - 1n) / divisor;
    return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
  } catch {
    return null;
  }
}
