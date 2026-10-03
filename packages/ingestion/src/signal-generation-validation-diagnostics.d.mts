export type GenerationValidationReason =
  | 'invalid_type'
  | 'invalid_shape'
  | 'missing_items'
  | 'too_many_items'
  | 'missing_evidence'
  | 'missing_value'
  | 'text_too_long'
  | 'invalid_characters'
  | 'unknown_fragment'
  | 'quote_mismatch'
  | 'duplicate_reference'
  | 'duplicate_item'
  | 'invalid_date'
  | 'unknown_topic'
  | 'unknown_date_has_evidence';
export interface GenerationValidationDetail {
  path: string;
  reason: GenerationValidationReason;
}
export function isGenerationValidationDetail(
  field: unknown,
  path: unknown,
  reason: unknown,
): boolean;
