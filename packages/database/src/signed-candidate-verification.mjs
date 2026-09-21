import { createPublicKey, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { parseVerificationRecordRequest } from './candidate-verification.mjs';

export class SignedVerificationError extends Error {
  constructor(code = 'verification_invalid') {
    super(code);
    this.code = code;
  }
}
const deny = () => {
  throw new SignedVerificationError();
};
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    deny();
};
const decode = (value, max) => {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    deny();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) deny();
  return bytes;
};

/** Trust is held by an independently operated verifier, NEVER by the web UI.
 * The web application has public keys only and cannot mint an approval.
 * Sign exact UTF-8 JSON bytes; issuedAt/ingestBefore bound replay admission.
 * This verifies an attestation, not truth of journalism or permission to publish.
 */
export function verifySignedCandidateReport({ envelope, keyring, identity, now = new Date() }) {
  try {
    exact(envelope, ['keyId', 'payload', 'signature']);
    if (typeof envelope.keyId !== 'string' || !Object.hasOwn(keyring, envelope.keyId)) deny();
    const trusted = keyring[envelope.keyId];
    exact(trusted, ['publicKey', 'verifierId']);
    const key = createPublicKey(trusted.publicKey);
    if (key.asymmetricKeyType !== 'ed25519') deny();
    const bytes = decode(envelope.payload, 24000);
    const signature = decode(envelope.signature, 100);
    if (signature.length !== 64 || !verify(null, bytes, key, signature)) deny();
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    exact(payload, [
      'version',
      'runId',
      'candidateIndex',
      'reviewRevision',
      'materialHash',
      'issuedAt',
      'ingestBefore',
      'verification',
      'rationale',
    ]);
    if (
      payload.version !== 'signed-candidate-verification-v1' ||
      payload.runId !== identity.runId ||
      payload.candidateIndex !== identity.candidateIndex ||
      payload.reviewRevision !== identity.expectedReviewRevision ||
      payload.materialHash !== identity.materialHash
    )
      deny();
    const issued = Date.parse(payload.issuedAt),
      until = Date.parse(payload.ingestBefore),
      time = now.getTime();
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(until) ||
      !Number.isFinite(time) ||
      new Date(issued).toISOString() !== payload.issuedAt ||
      new Date(until).toISOString() !== payload.ingestBefore ||
      issued > time ||
      until <= issued ||
      until - issued > 60000
    )
      deny();
    if (time >= until) throw new SignedVerificationError('verification_expired');
    const record = parseVerificationRecordRequest(payload.verification);
    if (record.verifier_id !== trusted.verifierId) deny();
    exact(payload.rationale, Object.keys(record.checks));
    for (const note of Object.values(payload.rationale))
      if (typeof note !== 'string' || !note.trim() || [...note].length > 2000) deny();
    return { record, rationale: payload.rationale };
  } catch (error) {
    if (error instanceof SignedVerificationError) throw error;
    throw new SignedVerificationError();
  }
}
