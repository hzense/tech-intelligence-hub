/** Compare the stored object's ETag, not a negotiated compressed representation. */
export function importBlobReadOptions(token: string) {
  return {
    access: 'private' as const,
    token,
    useCache: false,
    headers: { 'Accept-Encoding': 'identity' },
    abortSignal: AbortSignal.timeout(15000),
  };
}
