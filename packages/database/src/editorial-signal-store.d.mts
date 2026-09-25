import type {
  EditorialContent,
  EditorialRequest,
  EditorialMaterial,
} from './editorial-signal-contract.mjs';
export { EditorialSignalError } from './editorial-signal-contract.mjs';
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
}): Promise<EditorialSignalRecord>;
export function readEditorialSignal(input: {
  pool: unknown;
  owner: string;
  runId: string;
  candidateIndex: number;
}): Promise<EditorialSignalRecord | null>;
