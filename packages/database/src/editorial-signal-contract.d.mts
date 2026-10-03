import type { GenerationSignalType } from '../../ingestion/src/signal-types.mjs';
export interface EditorialContent {
  title: string;
  summary: string;
  eventDate: string | null;
  organizations: string[];
  persons: string[];
  topics: { id: string; title: string }[];
  sourceUrls: string[];
  signalType?: GenerationSignalType | null;
}
export interface EditorialRequest {
  requestId: string;
  runId: string;
  candidateIndex: number;
  expectedRevision: number;
  materialHash: string;
  action: 'draft' | 'publish' | 'withdraw';
  content: EditorialContent;
  consent: boolean;
}
export interface EditorialMaterial {
  materialHash: string;
  title: string;
  summary: string;
  sourceUrls: string[];
  sourceOptions?: string[];
}
export class EditorialSignalError extends Error {
  code: string;
  constructor(code?: string);
}
export function normalizeEditorialContent(value: unknown): EditorialContent;
export function contentReadiness(content: EditorialContent): { ready: boolean; missing: string[] };
export function normalizeEditorialRequest(
  request: unknown,
  material: EditorialMaterial,
  options?: { checkPublication?: boolean },
): EditorialRequest;
