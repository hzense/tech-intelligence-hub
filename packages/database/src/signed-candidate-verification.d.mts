export class SignedVerificationError extends Error {
  code: string;
}
export function verifySignedCandidateReport(input: {
  envelope: unknown;
  keyring: Record<string, { publicKey: string; verifierId: string }>;
  identity: {
    runId: string;
    candidateIndex: number;
    expectedReviewRevision: number;
    materialHash: string;
  };
  now?: Date;
}): { record: Record<string, unknown>; rationale: Record<string, string> };
