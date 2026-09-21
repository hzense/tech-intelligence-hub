export function reviewRequestIdentity(
  previous: { fingerprint: string; requestId: string } | null,
  fingerprint: string,
  createId: () => string,
) {
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: createId() };
}
