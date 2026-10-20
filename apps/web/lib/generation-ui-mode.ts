export type GenerationUiMode = {
  ai_mode?: 'local-mock' | 'local-real' | 'production';
  profile_id?: string;
};

/** Read-only presentation fallback for records saved before the mode receipt. */
export function isLocalSimulationRecord(
  record: GenerationUiMode | undefined,
  localMode: boolean,
  localRealAi: boolean,
): boolean {
  if (!localMode) return false;
  if (record?.ai_mode) return record.ai_mode === 'local-mock';
  if (record?.profile_id) return record.profile_id === '1389674e-ea29-4a37-a563-073f498fb7f2';
  return !localRealAi;
}
