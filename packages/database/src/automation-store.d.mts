import type { AutomationConfig } from './automation-contract.mjs';
export { AutomationError } from './automation-contract.mjs';
export interface AutomationConfigRecord {
  id: string;
  owner_id: string;
  revision: number;
  config: AutomationConfig;
  enabled: boolean;
  next_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at?: Date | string | null;
}
export interface AutomationRun {
  id: string;
  config_id: string;
  owner_id: string;
  config_revision: number;
  snapshot: AutomationConfig;
  config_snapshot: AutomationConfig;
  slot: string;
  trigger: 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  phase: string;
  result: Record<string, unknown> | null;
  error_code: string | null;
  lease_token: string | null;
  lease_until: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  budget_day: string | null;
  reserved_microusd: number;
  charged_microusd: number;
  cost_source: 'provider' | 'estimate' | 'reserve' | null;
  publication_status: 'private' | 'published' | 'withdrawn';
  published_at: Date | string | null;
}
export interface AutomationLimits {
  batch: number;
  daily: number;
  reserve: number;
}
export interface SaveAutomationRequest {
  id: string;
  expectedRevision: number;
  config: AutomationConfig;
  consent: boolean;
}
export interface TriggerAutomationRequest {
  configId: string;
  expectedRevision: number;
  requestId: string;
  consent: boolean;
}
export interface DeleteAutomationRequest {
  id: string;
  expectedRevision: number;
  consent: boolean;
}
export interface DeletedAutomationConfig {
  id: string;
  revision: number;
  deleted_at: Date | string;
}
export function saveAutomationConfig(input: {
  pool: unknown;
  owner: string;
  request: SaveAutomationRequest;
}): Promise<AutomationConfigRecord>;
export function deleteAutomationConfig(input: {
  pool: unknown;
  owner: string;
  request: DeleteAutomationRequest;
}): Promise<DeletedAutomationConfig>;
export function readAutomationDashboard(input: { pool: unknown; owner: string }): Promise<{
  configs: AutomationConfigRecord[];
  runs: AutomationRun[];
  configDeletionAvailable: boolean;
}>;
export function enqueueAutomation(input: {
  pool: unknown;
  owner: string;
  request: TriggerAutomationRequest;
}): Promise<{ run: AutomationRun; created: boolean }>;
export function enqueueDueAutomations(input: {
  pool: unknown;
  limit?: number;
}): Promise<{ run: AutomationRun; created: boolean }[]>;
export function claimAutomationRun(input: {
  pool: unknown;
  owner: string;
  id: string;
  limits?: AutomationLimits;
}): Promise<AutomationRun | null>;
export function readAutomationRun(input: {
  pool: unknown;
  owner: string;
  id: string;
}): Promise<AutomationRun>;
export function beginSourceDiscovery(input: {
  pool: unknown;
  owner: string;
  id: string;
  token: string;
}): Promise<void>;
export function readCollectedSourceUrls(input: { pool: unknown; owner: string }): Promise<string[]>;
export function updateAutomationRun(input: {
  pool: unknown;
  owner: string;
  id: string;
  token: string;
  phase: string;
  result: Record<string, unknown>;
  status?: AutomationRun['status'];
  errorCode?: string | null;
  costMicrousd?: number;
  costSource?: 'provider' | 'estimate' | 'reserve';
}): Promise<AutomationRun>;
export function failAutomationDispatch(input: {
  pool: unknown;
  owner: string;
  id: string;
}): Promise<unknown>;
export function freezeAutomationInputs(input: {
  pool: unknown;
  owner: string;
  id: string;
  token: string;
  snapshot: { inputs: unknown[]; [key: string]: unknown };
}): Promise<void>;
export function publishAutomationInsight(input: {
  pool: unknown;
  owner: string;
  id: string;
  confirm: boolean;
}): Promise<AutomationRun>;
