export interface AiConnectionSettings {
  timeout_ms: number;
  max_concurrency: number;
  daily_budget_microusd: number;
  input_price_microusd_per_million: number;
  output_price_microusd_per_million: number;
}
export interface AiConnection {
  id: string;
  revision: number;
  name: string;
  protocol: 'openai-compatible';
  base_url: string;
  enabled: boolean;
  settings: AiConnectionSettings;
  has_key: boolean;
  key_mask: '••••••••' | null;
  created_at: string;
  updated_at: string;
}
export interface AiConnectionCreateRequest {
  id?: string;
  name: string;
  protocol: 'openai-compatible';
  base_url: string;
  enabled: boolean;
  settings: AiConnectionSettings;
  api_key: string;
}
export interface AiConnectionUpdateRequest {
  id: string;
  expected_revision: number;
  name?: string;
  protocol?: 'openai-compatible';
  base_url?: string;
  enabled?: boolean;
  settings?: AiConnectionSettings;
  api_key?: string;
  revoke_key?: true;
}
export type AiProbeKind = 'models' | 'connection' | 'structured_output' | 'tool_calling';
export interface AiProbeRequest {
  id: string;
  connection_id: string;
  connection_revision: number;
  kind: AiProbeKind;
  model_id?: string;
}
export interface AiProbe {
  id: string;
  connection_id: string;
  connection_revision: number;
  kind: AiProbeKind;
  model_id: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'stale';
  reserved_microusd: string;
  charged_microusd: string;
  input_tokens: number | null;
  output_tokens: number | null;
  result: Record<string, unknown>;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface AiProfileStage {
  connection_id: string;
  connection_revision: number;
  model_id: string;
  prompt: string;
  temperature: number;
  max_output_tokens: number;
  require_tools: boolean;
}
interface AiProfileFields {
  name: string;
  stages: { extract: AiProfileStage; verify: AiProfileStage; analyze: AiProfileStage };
}
export interface AiProfileCreateRequest extends AiProfileFields {
  id?: string;
  expected_revision?: never;
}
export interface AiProfileUpdateRequest extends AiProfileFields {
  id: string;
  expected_revision: number;
}
export type AiProfileSaveRequest = AiProfileCreateRequest | AiProfileUpdateRequest;
export interface AiProfile {
  id: string;
  revision: number;
  name: string;
  stages: AiProfileSaveRequest['stages'];
  created_at: string;
  updated_at: string;
  readiness: { ready: boolean; reasons: string[]; warnings?: string[] };
}
export interface AiConfigHistory<T> {
  revision: number;
  snapshot: T;
  created_at: string;
}
export interface AiKeyring {
  active: string;
  keys: Readonly<Record<string, string>>;
}
export function resolveAiGenerationAccess(args: {
  pool: unknown;
  id: string;
  revision: number;
  allowedHosts: AiAllowedHosts;
  keyring?: AiKeyring;
}): Promise<{
  profile: AiProfile;
  connection: Pick<AiConnection, 'id' | 'revision' | 'protocol' | 'base_url' | 'settings'>;
  apiKey?: string;
}>;
export type AiAllowedHosts = readonly string[] | ReadonlySet<string>;
export type AiProbeInvoker = (input: {
  connection: Pick<AiConnection, 'id' | 'revision' | 'protocol' | 'base_url' | 'settings'>;
  apiKey: string;
  kind: AiProbeKind;
  modelId?: string;
  allowedHosts: AiAllowedHosts;
}) => Promise<{
  success: boolean;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  result: Record<string, unknown>;
  error_code?: string;
}>;
export function createAiConnection(input: {
  pool: unknown;
  request: unknown;
  keyring: AiKeyring;
  allowedHosts: AiAllowedHosts;
}): Promise<AiConnection>;
export function updateAiConnection(input: {
  pool: unknown;
  request: unknown;
  keyring: AiKeyring;
  allowedHosts: AiAllowedHosts;
}): Promise<AiConnection>;
export function listAiConnections(input: { pool: unknown }): Promise<AiConnection[]>;
export function getAiConnectionHistory(input: {
  pool: unknown;
  id: string;
}): Promise<AiConfigHistory<AiConnection>[]>;
export function saveAiProfile(input: { pool: unknown; request: unknown }): Promise<AiProfile>;
export function listAiProfiles(input: { pool: unknown }): Promise<AiProfile[]>;
export function getAiProfileHistory(input: {
  pool: unknown;
  id: string;
}): Promise<AiConfigHistory<Omit<AiProfile, 'readiness'>>[]>;
export function resolveAiProfileForExecution(input: {
  pool: unknown;
  id: string;
}): Promise<AiProfile>;
export function getAiProbe(input: { pool: unknown; id: string }): Promise<AiProbe>;
export function listAiProbes(input: { pool: unknown }): Promise<AiProbe[]>;
export function runAiProbe(input: {
  pool: unknown;
  request: unknown;
  keyring: AiKeyring;
  allowedHosts: AiAllowedHosts;
  invoke: AiProbeInvoker;
}): Promise<AiProbe>;
