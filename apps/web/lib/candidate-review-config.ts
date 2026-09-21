import { readRuntimeReaderConfig } from './runtime-reader-core.ts';

export class ReviewConfigurationError extends Error {
  readonly code = 'not_configured';
  constructor() {
    super('not_configured');
  }
}
export function readReviewDatabaseConfiguration(env: Readonly<Record<string, string | undefined>>) {
  return readCandidateRoleConfiguration(
    env,
    'HZENSE_REVIEW_DATABASE_URL',
    'hzense_candidate_reviewer',
  );
}
export function readCandidateRoleConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  role: string,
) {
  try {
    const value = env[variable];
    if (
      !value ||
      /\s/.test(value) ||
      [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      !/^postgres(?:ql)?:\/\//.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (decodeURIComponent(url.username) !== role) throw new Error();
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
    return value;
  } catch {
    throw new ReviewConfigurationError();
  }
}
