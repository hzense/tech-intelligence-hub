// Diagnostics are a bounded, server-owned vocabulary, never model text or keys.
const item = '(?:[0-9]|1[01])';
const reference = '(?:\\[[0-7]\\](?:\\.(?:fragment_id|quote))?)?';
const paths = {
  candidate: /^candidate$/,
  title: /^title$/,
  summary: /^summary$/,
  event_date: /^event_date$/,
  event_date_evidence: new RegExp(`^event_date_evidence${reference}$`),
  persons: new RegExp(
    `^persons(?:\\[${item}\\](?:\\.(?:name|role|organization|evidence${reference}))?)?$`,
  ),
  organizations: new RegExp(`^organizations(?:\\[${item}\\])?$`),
  claims: new RegExp(`^claims(?:\\[${item}\\](?:\\.(?:text|evidence${reference}))?)?$`),
};
const reasons = new Set([
  'invalid_type',
  'invalid_shape',
  'missing_items',
  'too_many_items',
  'missing_evidence',
  'missing_value',
  'text_too_long',
  'invalid_characters',
  'unknown_fragment',
  'quote_mismatch',
  'duplicate_reference',
  'duplicate_item',
  'invalid_date',
  'unknown_date_has_evidence',
]);

export function isGenerationValidationDetail(field, path, reason) {
  return (
    typeof field === 'string' &&
    typeof path === 'string' &&
    path === path.trim() &&
    typeof reason === 'string' &&
    Object.hasOwn(paths, field) &&
    paths[field].test(path) &&
    reasons.has(reason)
  );
}
