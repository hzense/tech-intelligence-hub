import { readCandidateRoleConfiguration } from './candidate-review-config';

export type MaterialRole = 'registrar' | 'verifier';
export function materialDatabaseConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  role: MaterialRole,
) {
  return readCandidateRoleConfiguration(
    env,
    role === 'registrar'
      ? 'HZENSE_MATERIAL_REGISTRAR_DATABASE_URL'
      : 'HZENSE_MATERIAL_VERIFIER_DATABASE_URL',
    `hzense_material_${role}`,
  );
}
export function materialKeyring(env: Readonly<Record<string, string | undefined>>) {
  try {
    const value = JSON.parse(env.HZENSE_MATERIAL_TRUSTED_VERIFIERS ?? 'null');
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      !Object.keys(value).length ||
      Object.keys(value).length > 10
    )
      throw new Error();
    return value as Record<string, { publicKey: string; verifierId: string }>;
  } catch {
    throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
  }
}
export function requireMaterialWrites(env: Readonly<Record<string, string | undefined>>) {
  if (env.HZENSE_MATERIAL_REGISTRATION_ENABLED !== '1')
    throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
}
