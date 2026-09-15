import type {
  SignalWorkbenchListRequest,
  SignalWorkbenchDetailRequest,
} from './signal-workbench-store.mjs';
export class SignalWorkbenchError extends Error {
  constructor(code?: string);
  readonly code:
    | 'invalid_request'
    | 'not_found'
    | 'database_unavailable'
    | 'access_denied'
    | 'incompatible_data';
}
export const signalWorkbenchReadColumns: Readonly<Record<string, readonly string[]>>;
export function parseSignalWorkbenchListRequest(
  input: unknown,
): Required<SignalWorkbenchListRequest>;
export function parseSignalWorkbenchDetailRequest(input: unknown): SignalWorkbenchDetailRequest;
export function verifySignalWorkbenchAccess(client: unknown): Promise<void>;
export function safeWorkbenchSourceUrl(value: unknown): string | null;
