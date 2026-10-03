import type { GenerationSignalType } from '../../ingestion/src/signal-types.mjs';
export interface EditorialResourceDraft {
  type: 'person' | 'company' | 'institution';
  name: string;
  introduction: string | null;
  event_role: string | null;
  evidence: { fragment_id: string; quote: string }[];
}
export interface EditorialResource extends EditorialResourceDraft {
  entity_id: string | null;
  source_urls?: string[];
}
export interface EditorialResourceCatalogEntry {
  id: string;
  type: string;
  name: string;
  status: string;
  aliases?: string[];
}
export interface EditorialContent {
  title: string;
  summary: string;
  eventDate: string | null;
  organizations: string[];
  persons: string[];
  topics: { id: string; title: string }[];
  sourceUrls: string[];
  signalType?: GenerationSignalType | null;
  resources?: EditorialResource[];
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
  resources?: EditorialResourceDraft[];
  resourceCatalog?: EditorialResourceCatalogEntry[];
  resourceSourceOptions?: {
    name: string;
    type: EditorialResourceDraft['type'];
    sourceUrls: string[];
  }[];
}
export class EditorialSignalError extends Error {
  code: string;
  constructor(code?: string);
}
export function normalizeEditorialContent(value: unknown): EditorialContent;
export function editorialResourceName(name: string): string;
export function normalizeEditorialResources(
  value: unknown,
  options?: { generated?: false },
): EditorialResource[];
export function normalizeEditorialResources(
  value: unknown,
  options: { generated: true },
): EditorialResourceDraft[];
export function contentReadiness(content: EditorialContent): { ready: boolean; missing: string[] };
export function normalizeEditorialRequest(
  request: unknown,
  material: EditorialMaterial,
  options?: { checkPublication?: boolean },
): EditorialRequest;
