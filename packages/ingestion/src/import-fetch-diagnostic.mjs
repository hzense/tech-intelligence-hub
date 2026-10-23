/** Bounded, public-safe projection. Never retain messages, URLs, headers or bodies. */
export function readImportFetchDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (value.reason === 'http_status') {
    if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599)
      return { reason: 'http_status', status: value.status };
    return undefined;
  }
  if (['dns', 'timeout', 'encoding', 'network'].includes(value.reason))
    return { reason: value.reason };
  return undefined;
}
