import { readRuntimeReaderConfig } from './runtime-reader-core.ts';
import { GenerationError } from './signal-generation-core.ts';

/** No default activation or budget. Production must explicitly approve a new AI spend scope. */
export function readGenerationConfiguration(env: Readonly<Record<string, string | undefined>>) {
  try {
    if (env.HZENSE_SIGNAL_GENERATION_ENABLED !== '1') throw new Error();
    const connectionString = env.HZENSE_GENERATION_DATABASE_URL;
    if (
      !connectionString ||
      /\s/.test(connectionString) ||
      !/^postgres(?:ql)?:\/\//.test(connectionString)
    )
      throw new Error();
    const url = new URL(connectionString);
    if (decodeURIComponent(url.username) !== 'hzense_generation_admin') throw new Error();
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
    const money = (raw: string | undefined) => {
      if (!raw || !/^[1-9][0-9]*$/.test(raw)) throw new Error();
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value > 50000000) throw new Error();
      return value;
    };
    const batch = money(env.HZENSE_GENERATION_BATCH_LIMIT_MICROUSD);
    const daily = money(env.HZENSE_GENERATION_DAILY_LIMIT_MICROUSD);
    if (batch > 10000000 || batch > daily) throw new Error();
    return { connectionString, batch, daily };
  } catch {
    throw new GenerationError('not_configured');
  }
}
