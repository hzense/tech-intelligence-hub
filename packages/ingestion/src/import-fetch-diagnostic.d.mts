export type ImportFetchDiagnostic =
  | { reason: 'http_status'; status: number }
  | { reason: 'dns' | 'timeout' | 'encoding' | 'network' };
export function readImportFetchDiagnostic(value: unknown): ImportFetchDiagnostic | undefined;
