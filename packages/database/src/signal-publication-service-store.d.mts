export class PublicPublicationError extends Error {
  readonly code: string;
}
export interface PublicPublicationReceipt {
  scope: string;
  outcome: 'apply' | 'replay';
  signal_id: string;
  publication_revision: number;
  content_version: number;
  status: 'published' | 'withdrawn';
  event_id: string;
  current_public: boolean;
}
// Kept internal to this repository; only the authenticated server adapter imports it.
export function publishVerifiedSignal(input: {
  pool: unknown;
  request: unknown;
}): Promise<PublicPublicationReceipt>;
export function withdrawPublicSignal(input: {
  pool: unknown;
  request: unknown;
}): Promise<PublicPublicationReceipt>;
