import type { AiKeyring } from './ai-config-store.mjs';
export function readAiKeyring(raw: unknown): AiKeyring;
export function encryptAiKey(
  apiKey: string,
  connectionId: string,
  keyring: AiKeyring,
): Record<string, unknown>;
export function decryptAiKey(envelope: unknown, connectionId: string, keyring: AiKeyring): string;
