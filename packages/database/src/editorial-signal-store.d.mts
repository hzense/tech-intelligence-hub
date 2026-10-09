import type {
  EditorialContent,
  EditorialRequest,
  EditorialMaterial,
  EditorialResourceDraft,
  EditorialResourceCatalogEntry,
} from './editorial-signal-contract.mjs';
export { EditorialSignalError } from './editorial-signal-contract.mjs';
export interface EditorialResourcePreview {
  name: string;
  type: EditorialResourceDraft['type'];
  matches: { id: string; name: string; type: EditorialResourceDraft['type'] }[];
  status: 'new' | 'reuse' | 'ambiguous';
}
export function previewEditorialResources(input: {
  pool: unknown;
  resources: EditorialResourceDraft[];
  catalog?: EditorialResourceCatalogEntry[];
}): Promise<EditorialResourcePreview[]>;
export interface EditorialSignalRecord {
  request_id: string;
  run_id: string;
  owner_id: string;
  candidate_index: number;
  revision: number;
  material_hash: string;
  action: 'draft' | 'publish' | 'withdraw';
  content: EditorialContent;
  created_at: Date | string;
}
export function saveEditorialSignal(input: {
  pool: unknown;
  owner: string;
  request: EditorialRequest;
  material: EditorialMaterial;
  unified?: boolean;
}): Promise<EditorialSignalRecord>;
export function readEditorialSignal(input: {
  pool: unknown;
  owner: string;
  runId: string;
  candidateIndex: number;
}): Promise<EditorialSignalRecord | null>;
export interface EditorialSignalStatus {
  run_id: string;
  candidates: Array<{
    candidate_index: number;
    revision: number;
    action: 'draft' | 'publish' | 'withdraw';
    public_id: string | null;
  }>;
}
export function readEditorialSignalStatuses(input: {
  pool: unknown;
  owner: string;
  runIds: string[];
}): Promise<EditorialSignalStatus[]>;
