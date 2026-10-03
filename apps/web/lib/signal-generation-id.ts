/**
 * Import/generation records use PostgreSQL UUIDs, including deterministic hash IDs
 * created by automation. Those persisted IDs need not encode an RFC UUID version
 * or variant. Never rewrite them: they are also the workflow's idempotency keys.
 * AI profile/connection IDs deliberately retain their separate aiUuid contract.
 */
export function isGenerationRecordId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  );
}

export class GenerationRecordIdError extends Error {
  readonly code = 'invalid_request';
  constructor() {
    super('invalid_request');
    this.name = 'GenerationRecordIdError';
  }
}

export function generationRecordId(value: unknown): string {
  if (!isGenerationRecordId(value)) throw new GenerationRecordIdError();
  return value.toLowerCase();
}
